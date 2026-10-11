import { MODULES, prorate, quote, unmetDependencies, withGst } from '@hms/shared';
import { book, planOf, refreshBook } from './pricebook.service.js';
import { AppError, errors } from '../../core/errors/index.js';
import { withTransaction } from '../../core/db/model.js';
import { runAsSystem } from '../../core/tenancy/context.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { Branch } from '../../core/tenancy/branch.model.js';
import { tenantRegistry } from '../../core/tenancy/tenant.registry.js';
import { User } from '../../core/auth/models/user.model.js';
import { Bed } from '../../modules/setup/index.js';
import { recordAudit } from '../../core/audit/audit.service.js';
import { platformAudit } from '../audit.js';
import { PlatformInvoice, Subscription } from '../models/platform.models.js';
import { invoiceDto, issueInvoice, reactivateIfClear } from './invoices.service.js';

const DAY = 86_400_000;
const GRACE = { PAST_DUE: 7, READ_ONLY: 15, SUSPENDED: 90 }; // days before the next step (spec 2.4)
const TRIAL_IDLE_CLOSE_DAYS = 30;

/** Usage the limits are checked against (spec 3.7). */
export async function usage(tenantId) {
  return runAsSystem(tenantId, async () => ({
    users: await User.countDocuments({
      status: { $in: ['ACTIVE', 'INVITED', 'LOCKED', 'PENDING_APPROVAL'] },
    }),
    branches: await Branch.countDocuments({ status: { $in: ['ACTIVE', 'CLOSING'] } }),
    beds: await Bed.countDocuments({ isActive: true }),
  }));
}

/** The modules a subscription gives: its plan's (from the live book) plus its add-ons. */
export const tenantModulesFor = (sub) => targetModules(sub);
const targetModules = (sub) => [
  ...new Set(['CORE', ...(sub.plan ? (book().plans[sub.plan]?.modules ?? []) : []), ...sub.addOns]),
];

function limitsFor(sub) {
  const plan = sub.plan ? book().plans[sub.plan] : null;
  if (plan)
    return { users: plan.limits.users, branches: plan.limits.branches, beds: plan.limits.beds };
  return {
    users: sub.quantities.users,
    branches: sub.quantities.branches,
    beds: sub.quantities.beds,
  };
}

function periodQuote(sub) {
  if (sub.customMonthly) {
    const months = sub.cycle === 'ANNUAL' ? book().annualMonthsCharged : 1;
    return withGst([
      {
        item: `PLAN:${sub.plan ?? 'CUSTOM'}`,
        description: `${sub.plan ?? 'Custom'} plan (agreed price)`,
        qty: 1,
        unitAmount: sub.customMonthly * months,
        amount: sub.customMonthly * months,
      },
    ]);
  }
  return quote(
    { plan: sub.plan, addOns: sub.addOns, cycle: sub.cycle, quantities: sub.quantities },
    book(),
  );
}

const addPeriod = (start, cycle) => {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + (cycle === 'ANNUAL' ? 12 : 1));
  return new Date(end.getTime() - 1);
};

async function setTenantModules(tenantId, codes, limits) {
  const tenant = await Tenant.findById(tenantId);
  tenant.modules = codes.map((code) => ({ code, status: 'ACTIVE' }));
  if (limits) tenant.limits = { ...tenant.limits?.toObject?.(), ...limits };
  await tenant.save();
  await tenantRegistry.invalidate(tenant);
  return tenant;
}

export async function ensureSubscription(tenantId) {
  return (
    (await Subscription.findOne({ tenantId })) ??
    (await Subscription.create({ tenantId, plan: book().trialPlan ?? 'HOSPITAL' }))
  );
}

export async function getSubscription(tenantId) {
  await refreshBook();
  const [tenant, sub, use, invoices] = await Promise.all([
    Tenant.findById(tenantId).lean(),
    ensureSubscription(tenantId),
    usage(tenantId),
    PlatformInvoice.find({ tenantId }).sort({ issuedAt: -1 }).limit(24).lean(),
  ]);
  return {
    status: tenant.status,
    statusReason: tenant.statusReason,
    trialEndsAt: tenant.trialEndsAt,
    plan: sub.plan,
    planName: sub.plan ? (book().plans[sub.plan]?.name ?? sub.plan) : 'A-la-carte',
    cycle: sub.cycle,
    converted: sub.converted,
    addOns: sub.addOns,
    modules: tenant.modules.map((m) => ({
      code: m.code,
      name: MODULES[m.code]?.name,
      status: m.status,
    })),
    limits: tenant.limits,
    usage: use,
    currentPeriod: sub.currentPeriod,
    pending: sub.pending,
    invoices: invoices.map(invoiceDto),
    version: sub.version,
  };
}

/** Prices a module change (spec 3.15 example): additions now and prorated, removals at renewal. */
export async function previewChange(tenantId, { add = [], remove = [] }) {
  await refreshBook();
  const [tenant, sub] = await Promise.all([
    Tenant.findById(tenantId).lean(),
    ensureSubscription(tenantId),
  ]);
  // CORE is always on but is not stored on hospitals created at signup.
  const active = new Set(['CORE', ...tenant.modules.map((m) => m.code)]);
  const target = [...new Set([...active, ...add])].filter((c) => !remove.includes(c));
  const blockedBy = [];
  for (const d of unmetDependencies(target))
    blockedBy.push({
      module: d.module,
      message: `${MODULES[d.module].name} needs ${MODULES[d.needs].name}`,
    });
  for (const c of remove)
    if (c === 'CORE') blockedBy.push({ module: c, message: 'Core is always on' });
  for (const c of add) if (!MODULES[c]) blockedBy.push({ module: c, message: 'Unknown module' });
  const trial = tenant.status === 'TRIAL' || !sub.converted;
  const adds = add.filter((c) => !active.has(c) && MODULES[c]);
  let chargeNow = { subtotal: 0, gst: 0, total: 0, currency: 'INR', lines: [] };
  if (!trial && adds.length && sub.currentPeriod?.end) {
    const full = quote({ addOns: adds, cycle: sub.cycle, quantities: sub.quantities }, book());
    const lines = full.lines.map((l) => ({
      ...l,
      description: `${l.description}, prorated`,
      amount: prorate(l.amount, {
        periodStart: sub.currentPeriod.start,
        periodEnd: sub.currentPeriod.end,
      }),
    }));
    chargeNow = { ...withGst(lines), currency: 'INR' };
  }
  const next = {
    ...sub.toObject(),
    addOns: [...new Set([...sub.addOns, ...adds])].filter((c) => !remove.includes(c)),
  };
  return {
    effective: {
      add: trial ? 'IMMEDIATE (trial)' : 'ON_PAYMENT',
      remove: trial ? 'IMMEDIATE (trial)' : sub.currentPeriod?.end,
    },
    chargeNow,
    nextInvoiceEstimate: trial ? null : { total: periodQuote(next).total },
    blockedBy,
  };
}

/** Applies a module change requested by the Hospital Super Admin. */
export async function applyChange(tenantId, { add = [], remove = [] }, actorName) {
  const preview = await previewChange(tenantId, { add, remove });
  if (preview.blockedBy.length)
    throw new AppError(
      422,
      'DEPENDENCY_MISSING',
      'This change is blocked',
      preview.blockedBy.map((b) => ({ path: b.module, message: b.message })),
    );
  return withTransaction(async () => {
    const [tenant, sub] = await Promise.all([
      Tenant.findById(tenantId),
      Subscription.findOne({ tenantId }),
    ]);
    const active = ['CORE', ...tenant.modules.map((m) => m.code)];
    const adds = add.filter((c) => !active.includes(c));
    let invoice = null;
    if (tenant.status === 'TRIAL' || !sub.converted) {
      await setTenantModules(
        tenantId,
        [...new Set([...active, ...adds])].filter((c) => !remove.includes(c)),
      );
    } else {
      if (adds.length) {
        invoice = await issueInvoice({
          tenantId,
          kind: 'PRORATION',
          period: sub.currentPeriod,
          quote: preview.chargeNow,
          onPaid: { addModules: adds },
        });
      }
      for (const m of remove)
        if (!sub.pending.some((p) => p.module === m))
          sub.pending.push({ op: 'REMOVE', module: m, at: sub.currentPeriod.end, by: actorName });
      await sub.save();
    }
    await recordAudit({
      tenantId,
      action: 'UPDATE',
      entity: 'Subscription',
      entityId: sub._id,
      summary: `Module change: +${adds.join(',') || '-'} / -${remove.join(',') || '-'}`,
    });
    return {
      invoice: invoice && invoiceDto(invoice),
      subscription: await getSubscription(tenantId),
    };
  });
}

/** Ends the trial with a chosen plan: the first invoice; the plan starts when it is paid. */
export async function convert(tenantId, { plan, addOns = [], cycle, quantities, customMonthly }) {
  await refreshBook();
  if (plan) planOf(plan, { forNew: true });
  const sub = await ensureSubscription(tenantId);
  if (sub.converted)
    throw new AppError(
      409,
      'INVALID_STATE',
      'This hospital already has a paid plan; change modules instead',
    );
  if (plan && book().plans[plan].monthly == null && !customMonthly)
    throw errors.validation([
      { path: 'plan', message: 'Enterprise is priced by quote; Sales sets the agreed price' },
    ]);
  const draft = {
    plan: plan ?? null,
    addOns,
    cycle,
    quantities: { ...sub.quantities?.toObject?.(), ...quantities },
    customMonthly,
  };
  const missing = unmetDependencies(targetModules(draft));
  if (missing.length)
    throw new AppError(
      422,
      'DEPENDENCY_MISSING',
      'Required modules missing',
      missing.map((m) => ({ path: m.module, message: `needs ${m.needs}` })),
    );
  const use = await usage(tenantId);
  const limits = limitsFor(draft);
  const over = Object.entries(limits).filter(([k, v]) => (use[k] ?? 0) > v);
  if (over.length)
    throw new AppError(
      422,
      'USAGE_OVER_LIMIT',
      'Reduce usage first',
      over.map(([k, v]) => ({ path: k, message: `You use ${use[k]} ${k}; this plan allows ${v}` })),
    );
  const q = periodQuote(draft);
  const inv = await issueInvoice({
    tenantId,
    kind: 'CONVERSION',
    quote: q,
    onPaid: { convert: draft },
  });
  return invoiceDto(inv);
}

/** Runs what a paid invoice switches on (called inside the payment transaction). */
export async function applyOnPaid(inv) {
  await refreshBook();
  if (inv.onPaid?.addModules?.length) {
    const tenant = await Tenant.findById(inv.tenantId);
    await setTenantModules(inv.tenantId, [
      ...new Set([...tenant.modules.map((m) => m.code), ...inv.onPaid.addModules]),
    ]);
    await Subscription.updateOne(
      { tenantId: inv.tenantId },
      { $addToSet: { addOns: { $each: inv.onPaid.addModules } } },
    );
  }
  if (inv.onPaid?.convert) {
    const c = inv.onPaid.convert;
    const start = new Date();
    const sub = await Subscription.findOne({ tenantId: inv.tenantId });
    sub.set({ ...c, converted: true, currentPeriod: { start, end: addPeriod(start, c.cycle) } });
    await sub.save();
    await PlatformInvoice.updateOne({ _id: inv._id }, { $set: { period: sub.currentPeriod } });
    await setTenantModules(inv.tenantId, targetModules(sub), limitsFor(sub));
    await Tenant.updateOne(
      { _id: inv.tenantId },
      {
        $set: {
          plan: c.plan ?? 'ALACARTE',
          status: 'ACTIVE',
          statusChangedAt: new Date(),
          statusReason: 'Plan started',
        },
      },
    );
    await tenantRegistry.invalidate(await Tenant.findById(inv.tenantId).lean());
  }
}

/** Compare-and-set on the status, so a payment landing mid-run is never overwritten. */
async function moveTo(tenant, status, reason, now) {
  const res = await Tenant.updateOne(
    { _id: tenant._id, status: tenant.status },
    { $set: { status, statusChangedAt: now, statusReason: reason } },
  );
  if (!res.modifiedCount) return false;
  await tenantRegistry.invalidate(tenant);
  await platformAudit(tenant._id, {
    action: 'UPDATE',
    entity: 'Tenant',
    entityId: tenant._id,
    summary: `Subscription ${status}: ${reason}`,
    userName: 'platform',
  });
  return true;
}

/**
 * Daily lifecycle (spec 2.4): trial expiry, renewals with pending removals, and the grace steps
 * PAST_DUE (7 days full access) → READ_ONLY (15 days) → SUSPENDED (90 days) → CLOSED.
 * Clinical data is never deleted by this job.
 */
export async function runLifecycle(now = new Date()) {
  await refreshBook();
  const summary = { renewed: 0, moved: [] };
  const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } });
  for (const tenant of tenants) {
    const sub = await ensureSubscription(tenant._id);
    const days = (now - (tenant.statusChangedAt ?? now)) / DAY;

    if (tenant.status === 'TRIAL') {
      if (tenant.trialEndsAt && tenant.trialEndsAt <= now) {
        if (await moveTo(tenant, 'READ_ONLY', 'Trial ended: choose a plan to continue', now))
          summary.moved.push([tenant.subdomain, 'READ_ONLY']);
      }
      continue;
    }
    if (!sub.converted) {
      if (tenant.status === 'READ_ONLY' && days >= TRIAL_IDLE_CLOSE_DAYS) {
        if (await moveTo(tenant, 'CLOSED', 'Trial not converted in 30 days', now))
          summary.moved.push([tenant.subdomain, 'CLOSED']);
      }
      continue;
    }
    if (sub.currentPeriod?.end && sub.currentPeriod.end <= now) {
      await withTransaction(async () => {
        const removals = sub.pending.filter((p) => p.op === 'REMOVE').map((p) => p.module);
        sub.addOns = sub.addOns.filter((m) => !removals.includes(m));
        sub.pending = [];
        const start = new Date(sub.currentPeriod.end.getTime() + 1);
        sub.currentPeriod = { start, end: addPeriod(start, sub.cycle) };
        await sub.save();
        if (removals.length)
          await setTenantModules(
            tenant._id,
            targetModules(sub).filter((m) => !removals.includes(m)),
          );
        await issueInvoice({
          tenantId: tenant._id,
          kind: 'PERIOD',
          period: sub.currentPeriod,
          quote: periodQuote(sub),
          dueAt: start,
        });
      });
      summary.renewed += 1;
    }
    const overdue = await PlatformInvoice.exists({
      tenantId: tenant._id,
      status: 'ISSUED',
      dueAt: { $lte: now },
    });
    if (!overdue) continue;
    const step =
      tenant.status === 'ACTIVE'
        ? ['PAST_DUE', 'Invoice unpaid']
        : tenant.status === 'PAST_DUE' && days >= GRACE.PAST_DUE
          ? ['READ_ONLY', 'Unpaid for 7 days']
          : tenant.status === 'READ_ONLY' && days >= GRACE.READ_ONLY
            ? ['SUSPENDED', 'Unpaid for 22 days']
            : tenant.status === 'SUSPENDED' && days >= GRACE.SUSPENDED
              ? ['CLOSED', 'Suspended for 90 days']
              : null;
    if (step && (await moveTo(tenant, step[0], step[1], now)))
      summary.moved.push([tenant.subdomain, step[0]]);
  }
  return summary;
}

export { reactivateIfClear };

/** Moves a hospital to its plan's modules and limits (the console re-syncs a plan it edited). */
export async function applyPlanToTenant(tenantId, codes, sub) {
  await setTenantModules(tenantId, codes, limitsFor(sub));
}
