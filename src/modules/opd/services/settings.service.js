import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { withTransaction } from '../../../core/db/model.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { DRUG_ROWS } from '../data/clinical.js';
import {
  DEFAULT_MESSAGES,
  DEFAULT_TOKEN_SERIES,
  DEFAULT_VISIT_TYPES,
  TEMPLATES,
} from '../data/defaults.js';
import { OpdSettings, OpdTemplate } from '../models/opd.models.js';
import { listOf } from './common.js';

/** The hospital's OPD settings, created with the defaults on first use. */
export async function settingsDoc() {
  const found = await OpdSettings.findOne();
  if (found) return found;
  try {
    const [doc] = await OpdSettings.create([
      {
        tokenSeries: DEFAULT_TOKEN_SERIES,
        messages: DEFAULT_MESSAGES,
        visitTypes: DEFAULT_VISIT_TYPES,
      },
    ]);
    return doc;
  } catch (e) {
    // Two first requests at once: the unique index lets one win.
    if (e?.code === 11000) return OpdSettings.findOne();
    throw e;
  }
}

const settingsOut = (s) => ({
  booking: s.booking,
  cancellation: s.cancellation,
  pending: s.pending?.section
    ? {
        section: s.pending.section,
        values: s.pending.values,
        approvalId: String(s.pending.approvalId),
      }
    : null,
});

export async function getSettings() {
  return settingsOut(await settingsDoc());
}

/**
 * Booking rules apply at once. Cancellation and refund rules change what patients get back, so
 * they are saved as a request (opd.cancellationPolicy) and apply after Super Admin approval.
 */
export async function saveSettings({ booking, cancellation }, res) {
  const s = await settingsDoc();
  if (booking) {
    s.booking = { ...(s.booking.toObject?.() ?? s.booking), ...booking };
    await s.save();
  }
  if (cancellation) {
    const approval = await withTransaction(async () => {
      const a = await requestApproval({
        action: 'opd.cancellationPolicy',
        module: 'OPD',
        entity: 'OpdSettings',
        entityId: s._id,
        title: 'OPD cancellation and no-show rules',
        before: s.cancellation.toObject?.() ?? s.cancellation,
        after: cancellation,
        payload: { values: cancellation },
        reason: 'OPD cancellation and refund rules changed',
      });
      if (!a) {
        s.cancellation = cancellation;
      } else {
        s.pending = { section: 'cancellation', values: cancellation, approvalId: a._id };
      }
      await s.save();
      return a;
    });
    if (approval) {
      res.locals.status = 202;
      return { ...settingsOut(s), approvalId: String(approval._id) };
    }
  }
  return settingsOut(s);
}

onApprovalDecided('opd.cancellationPolicy', async (req, outcome) => {
  const s = await OpdSettings.findOne();
  if (!s) return;
  if (outcome === 'APPROVED') s.cancellation = req.payload.values;
  s.pending = undefined;
  await s.save();
});

// ---------------------------------------------------------------- token series, messages, visit types

const seriesOut = (t) => ({
  id: String(t._id),
  prefix: t.prefix,
  usedFor: t.usedFor,
  example: `${t.prefix}01`,
  resets: t.resets,
  display: t.display,
});

export async function listTokenSeries() {
  return listOf((await settingsDoc()).tokenSeries.map(seriesOut));
}

export async function addTokenSeries(input) {
  const s = await settingsDoc();
  if (s.tokenSeries.some((t) => t.prefix === input.prefix))
    throw errors.validation([{ path: 'prefix', message: 'This series already exists' }]);
  s.tokenSeries.push(input);
  await s.save();
  return seriesOut(s.tokenSeries.at(-1));
}

const messageOut = (m) => ({
  id: m.code,
  code: m.code,
  when: m.when,
  channels: m.channels,
  languages: m.languages,
  on: m.on,
});

export async function listMessages() {
  return listOf((await settingsDoc()).messages.map(messageOut));
}

export async function saveMessage(code, input) {
  const s = await settingsDoc();
  const m = s.messages.find((x) => x.code === code);
  if (!m) throw errors.notFound('Message');
  Object.assign(m, input);
  await s.save();
  return messageOut(m);
}

const visitTypeOut = (v) => ({
  id: v.code,
  code: v.code,
  name: v.name,
  slotMin: v.slotMin,
  fee: v.fee,
  freeFollowUp: v.freeFollowUp,
  online: v.online,
  tele: v.tele,
});

export async function listVisitTypes() {
  return listOf((await settingsDoc()).visitTypes.map(visitTypeOut));
}

export async function addVisitType(input) {
  const s = await settingsDoc();
  if (s.visitTypes.some((v) => v.code === input.code))
    throw errors.validation([{ path: 'code', message: 'This code is already used' }]);
  s.visitTypes.push(input);
  await s.save();
  return visitTypeOut(s.visitTypes.at(-1));
}

/** Department and doctor triage rule (R12): is triage required for this department? */
export async function triageRequired(department) {
  const s = await settingsDoc();
  return Boolean(department && s.booking.triageRequired.includes(department));
}

// ---------------------------------------------------------------- templates

const DRUGS = new Map(DRUG_ROWS.map(([id, brand, generic]) => [id, { brand, generic }]));

/** Seeds the starter department templates once (doctors add their own from the consultation). */
async function seedTemplates() {
  if (await OpdTemplate.exists({})) return;
  await OpdTemplate.create(
    TEMPLATES.map((t) => ({
      name: t.name,
      kind: t.kind,
      department: t.department,
      owner: 'Department',
      specialty: t.specialty,
      advice: t.advice,
      rx: (t.rx ?? []).map(([drugId, dose, frequency, days, route, instructions]) => ({
        drugId,
        ...(DRUGS.get(drugId) ?? { brand: drugId, generic: '' }),
        dose,
        frequency,
        days,
        route,
        instructions,
      })),
      orders: (t.orders ?? []).map((code) => ({ code })),
    })),
  );
}

/** Templates with order sets resolved to orderable services (unknown codes are left out). */
export async function listTemplates({ kind, q } = {}, resolveOrders) {
  await seedTemplates();
  const filter = {};
  if (kind) filter.kind = kind;
  if (q) filter.name = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const docs = await OpdTemplate.find(filter).sort({ name: 1 }).lean();
  const out = [];
  for (const t of docs) out.push(await templateOut(t, resolveOrders));
  return listOf(out);
}

async function templateOut(t, resolveOrders) {
  return {
    id: String(t._id),
    name: t.name,
    kind: t.kind,
    department: t.department,
    owner: t.owner,
    usedThisMonth: t.usedThisMonth,
    specialty: t.specialty ?? null,
    advice: t.advice ?? null,
    rx: (t.rx ?? []).map((r) => ({ ...r })),
    orders: resolveOrders ? await resolveOrders((t.orders ?? []).map((o) => o.code)) : [],
  };
}

export async function createTemplate(input, resolveOrders) {
  if (!input.name?.trim())
    throw errors.validation([{ path: 'name', message: 'Give the template a name' }]);
  const [t] = await OpdTemplate.create([
    {
      ...input,
      owner: input.owner ?? 'You',
      ownerUserId: current().userId,
      orders: (input.orders ?? []).map((o) => ({ code: typeof o === 'string' ? o : o.code })),
    },
  ]);
  return templateOut(t.toObject(), resolveOrders);
}

export function assertNotPending(s) {
  if (s.pending?.section)
    throw new AppError(409, 'APPROVAL_ALREADY_PENDING', 'A change is already waiting for approval');
}
