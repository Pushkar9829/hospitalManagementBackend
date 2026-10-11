import { z } from 'zod';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { Bill, CorporateInvoice } from '../../billing/index.js';
import { Grn, Vendor } from '../../inventory/index.js';
import { Doctor } from '../../setup/index.js';
import { Account, Journal } from '../models/finance.models.js';
import {
  Budget,
  DoctorPayout,
  DoctorShare,
  PettyCash,
  VendorPayment,
} from '../models/ledgers.models.js';
import {
  assertOpen,
  ensureChart,
  post,
  settingsDoc,
  todayIST,
  userName,
} from './finance.service.js';

const paise = z.number().int().min(1).max(1_00_00_000_00);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DAY = 86_400_000;
const MONEY_KEY = { BANK_TRANSFER: 'BANK', CHEQUE: 'BANK', CASH: 'CASH' };

const notFound = (what) => errors.notFound(what);

/** Ageing buckets by days outstanding. */
function bucket(days) {
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'over90';
}
const emptyBuckets = () => ({ d30: 0, d60: 0, d90: 0, over90: 0 });
const daysSince = (at, asOf) =>
  Math.max(0, Math.floor((new Date(`${asOf}T23:59:59+05:30`) - new Date(at)) / DAY));

// ---------------------------------------------------------------- payables

async function paidByGrn(grnIds) {
  const rows = await VendorPayment.aggregate([
    { $match: { 'allocations.grnId': { $in: grnIds } } },
    { $unwind: '$allocations' },
    { $match: { 'allocations.grnId': { $in: grnIds } } },
    { $group: { _id: '$allocations.grnId', paid: { $sum: '$allocations.amount' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.paid]));
}

async function openGrns(vendorId) {
  const filter = { status: 'POSTED', ...(vendorId ? { vendorId } : {}) };
  const grns = await Grn.find(filter)
    .select('grnNo vendorId vendorName invoiceNo invoiceDate total tax postedAt createdAt')
    .sort({ postedAt: 1, createdAt: 1 })
    .lean();
  const paid = await paidByGrn(grns.map((g) => g._id));
  return grns
    .map((g) => {
      const amount = (g.total ?? 0) + (g.tax ?? 0);
      const p = paid.get(String(g._id)) ?? 0;
      return { g, amount, paid: p, due: amount - p };
    })
    .filter((r) => r.due > 0);
}

/** What is owed to each vendor from posted goods receipts, aged by receipt date. */
export async function payables({ asOf = todayIST() } = {}) {
  const open = await openGrns();
  const byVendor = new Map();
  for (const { g, amount, paid, due } of open) {
    const key = String(g.vendorId);
    const v = byVendor.get(key) ?? {
      vendorId: key,
      vendorName: g.vendorName ?? '',
      outstanding: 0,
      buckets: emptyBuckets(),
      grns: [],
    };
    const at = g.postedAt ?? g.createdAt;
    const days = daysSince(at, asOf);
    v.outstanding += due;
    v.buckets[bucket(days)] += due;
    v.grns.push({
      grnId: String(g._id),
      grnNo: g.grnNo,
      invoiceNo: g.invoiceNo ?? null,
      date: at,
      amount,
      paid,
      due,
      days,
    });
    byVendor.set(key, v);
  }
  const items = [...byVendor.values()].sort((a, b) => b.outstanding - a.outstanding);
  const buckets = emptyBuckets();
  for (const v of items) for (const k of Object.keys(buckets)) buckets[k] += v.buckets[k];
  return { asOf, items, total: items.reduce((t, v) => t + v.outstanding, 0), buckets };
}

export const vendorPaymentInput = z.object({
  vendorId: z.string(),
  date: ymd.optional(),
  amount: paise,
  tds: z.number().int().min(0).default(0),
  mode: z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH']),
  reference: z.string().trim().max(60).optional(),
});

/**
 * Pays a vendor: clears its oldest receipts first, posts Dr creditors, Cr bank (or cash) and
 * Cr TDS payable for the tax withheld.
 */
export async function payVendor(input) {
  const date = input.date ?? todayIST();
  await assertOpen(date);
  if (input.tds >= input.amount)
    throw errors.validation([{ path: 'tds', message: 'TDS must be less than the amount' }]);
  const vendor = await Vendor.findById(input.vendorId).select('name').lean();
  if (!vendor) throw notFound('Vendor');
  return withTransaction(async () => {
    const open = await openGrns(input.vendorId);
    const due = open.reduce((t, r) => t + r.due, 0);
    if (input.amount > due)
      throw new AppError(422, 'OVERPAYMENT', `Only ${due} is outstanding to this vendor.`);
    let left = input.amount;
    const allocations = [];
    for (const r of open) {
      if (!left) break;
      const take = Math.min(left, r.due);
      allocations.push({ grnId: r.g._id, grnNo: r.g.grnNo, amount: take });
      left -= take;
    }
    const paymentNo = await documentNumber('VP');
    const j = await post({
      type: 'PAYMENT',
      date,
      narration: `Payment ${paymentNo} to ${vendor.name}${input.reference ? ` · ${input.reference}` : ''}`,
      source: { kind: 'VENDOR_PAYMENT', ref: paymentNo },
      lines: [
        { key: 'AP_VENDOR', debit: input.amount },
        { key: MONEY_KEY[input.mode], credit: input.amount - input.tds },
        { key: 'TDS_PAYABLE', credit: input.tds },
      ],
    });
    const [p] = await VendorPayment.create([
      {
        paymentNo,
        vendorId: input.vendorId,
        vendorName: vendor.name,
        date,
        amount: input.amount,
        tds: input.tds,
        mode: input.mode,
        reference: input.reference,
        allocations,
        journalId: j._id,
        by: await userName(),
      },
    ]);
    return vendorPaymentOut(p.toObject());
  });
}

const vendorPaymentOut = (p) => ({
  id: String(p._id),
  paymentNo: p.paymentNo,
  vendorId: String(p.vendorId),
  vendorName: p.vendorName,
  date: p.date,
  amount: p.amount,
  tds: p.tds ?? 0,
  mode: p.mode,
  reference: p.reference ?? null,
  allocations: (p.allocations ?? []).map((a) => ({ ...a, grnId: String(a.grnId) })),
  by: p.by ?? null,
});

export async function listVendorPayments({ vendorId } = {}) {
  const rows = await VendorPayment.find(vendorId ? { vendorId } : {})
    .sort({ date: -1, createdAt: -1 })
    .limit(200)
    .lean();
  return { items: rows.map(vendorPaymentOut) };
}

// ---------------------------------------------------------------- receivables

/**
 * What patients and payers owe: unpaid patient bills, corporate invoices not yet settled and
 * credit bills not yet invoiced, aged from the bill (or invoice) date.
 */
export async function receivables({ asOf = todayIST() } = {}) {
  const [bills, invoices] = await Promise.all([
    Bill.find({ status: { $in: ['FINAL', 'PARTLY_PAID'] }, 'totals.balance': { $gt: 0 } })
      .select('billNo patient payer corporateInvoiceId totals.balance finalizedAt createdAt')
      .lean(),
    CorporateInvoice.find({ status: { $in: ['ISSUED', 'PARTLY_PAID'] }, balance: { $gt: 0 } })
      .select('invoiceNo payerId payer.name balance issuedAt dueAt')
      .lean(),
  ]);
  const patients = { total: 0, buckets: emptyBuckets(), items: [] };
  const payers = new Map();
  const payer = (id, name) => {
    const key = String(id);
    const p = payers.get(key) ?? {
      payerId: key,
      name: name ?? '',
      invoiced: 0,
      uninvoiced: 0,
      total: 0,
      buckets: emptyBuckets(),
    };
    payers.set(key, p);
    return p;
  };
  for (const b of bills) {
    const at = b.finalizedAt ?? b.createdAt;
    const days = daysSince(at, asOf);
    const due = b.totals.balance;
    if (b.payer?.payerId) {
      if (b.corporateInvoiceId) continue; // counted on its invoice
      const p = payer(b.payer.payerId, b.payer.name);
      p.uninvoiced += due;
      p.total += due;
      p.buckets[bucket(days)] += due;
      continue;
    }
    patients.total += due;
    patients.buckets[bucket(days)] += due;
    patients.items.push({
      billId: String(b._id),
      billNo: b.billNo,
      patient: b.patient?.name ?? '',
      uhid: b.patient?.uhid ?? '',
      date: at,
      balance: due,
      days,
    });
  }
  for (const inv of invoices) {
    const p = payer(inv.payerId, inv.payer?.name);
    const days = daysSince(inv.issuedAt, asOf);
    p.invoiced += inv.balance;
    p.total += inv.balance;
    p.buckets[bucket(days)] += inv.balance;
  }
  patients.items.sort((a, b) => b.days - a.days);
  patients.items = patients.items.slice(0, 200);
  const corporate = [...payers.values()].sort((a, b) => b.total - a.total);
  return {
    asOf,
    patients,
    corporate: {
      total: corporate.reduce((t, p) => t + p.total, 0),
      buckets: corporate.reduce((acc, p) => {
        for (const k of Object.keys(acc)) acc[k] += p.buckets[k];
        return acc;
      }, emptyBuckets()),
      items: corporate,
    },
  };
}

// ---------------------------------------------------------------- budgets

/** Financial year "2026-27" for a date; months run April (index 0) to March (11). */
export const fyOf = (date = todayIST()) => {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const fyMonths = (fy) => {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    return `${i < 9 ? start : start + 1}-${String(m).padStart(2, '0')}`;
  });
};

/** Budget against actuals for every income and expense ledger in a financial year. */
export async function budgets({ fy = fyOf() } = {}) {
  await ensureChart();
  const months = fyMonths(fy);
  const [accounts, plans, actual] = await Promise.all([
    Account.find({ type: { $in: ['INCOME', 'EXPENSE'] }, isActive: { $ne: false } })
      .sort({ code: 1 })
      .lean(),
    Budget.find({ fy }).lean(),
    Journal.aggregate([
      {
        $match: {
          status: { $in: ['POSTED', 'REVERSED'] },
          date: { $gte: `${months[0]}-01`, $lte: `${months[11]}-31` },
        },
      },
      { $unwind: '$lines' },
      {
        $group: {
          _id: { a: '$lines.accountId', m: { $substrCP: ['$date', 0, 7] } },
          debit: { $sum: '$lines.debit' },
          credit: { $sum: '$lines.credit' },
        },
      },
    ]),
  ]);
  const plan = new Map(plans.map((b) => [String(b.accountId), b]));
  const act = new Map();
  for (const r of actual) act.set(`${r._id.a}|${r._id.m}`, r);
  const items = accounts.map((a) => {
    const sign = a.type === 'EXPENSE' ? 1 : -1;
    const b = plan.get(String(a._id));
    const budget = b?.months?.length === 12 ? b.months : Array(12).fill(0);
    const actuals = months.map((m) => {
      const r = act.get(`${a._id}|${m}`);
      return r ? sign * (r.debit - r.credit) : 0;
    });
    const budgetTotal = budget.reduce((t, x) => t + x, 0);
    const actualTotal = actuals.reduce((t, x) => t + x, 0);
    return {
      accountId: String(a._id),
      code: a.code,
      name: a.name,
      type: a.type,
      group: a.group ?? null,
      budgetId: b ? String(b._id) : null,
      version: b?.version ?? null,
      budget,
      actual: actuals,
      budgetTotal,
      actualTotal,
      variance: actualTotal - budgetTotal,
      usedPercent: budgetTotal ? Math.round((actualTotal * 100) / budgetTotal) : null,
    };
  });
  return { fy, months, items };
}

export const budgetInput = z
  .object({
    fy: z.string().regex(/^\d{4}-\d{2}$/, 'Use 2026-27'),
    accountId: z.string(),
    months: z.array(z.number().int().min(0).max(1_00_00_000_00)).length(12).optional(),
    annual: z.number().int().min(0).max(1_00_00_000_00_00).optional(),
  })
  .refine((v) => v.months || v.annual != null, { message: 'Give the months or an annual figure' });

/** Sets a ledger's budget; an annual figure is spread evenly (remainder in March). */
export async function setBudget(input) {
  const a = await Account.findById(input.accountId).lean();
  if (!a || !['INCOME', 'EXPENSE'].includes(a.type))
    throw errors.validation([{ path: 'accountId', message: 'Pick an income or expense ledger' }]);
  let months = input.months;
  if (!months) {
    const each = Math.floor(input.annual / 12);
    months = Array(12).fill(each);
    months[11] += input.annual - each * 12;
  }
  const found = await Budget.findOne({ fy: input.fy, accountId: input.accountId });
  if (found) {
    found.months = months;
    await found.save();
  } else {
    await Budget.create([{ fy: input.fy, accountId: input.accountId, months }]);
  }
  const all = await budgets({ fy: input.fy });
  return all.items.find((r) => r.accountId === input.accountId);
}

// ---------------------------------------------------------------- petty cash

async function pettyBalance() {
  const a = await Account.findOne({ key: 'PETTY_CASH' }).select('_id').lean();
  if (!a) return 0;
  const [r] = await Journal.aggregate([
    { $match: { status: { $in: ['POSTED', 'REVERSED'] }, 'lines.accountId': a._id } },
    { $unwind: '$lines' },
    { $match: { 'lines.accountId': a._id } },
    { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  return r ? r.debit - r.credit : 0;
}

const pettyOut = (e) => ({
  id: String(e._id),
  entryNo: e.entryNo,
  kind: e.kind,
  date: e.date,
  amount: e.amount,
  accountId: e.accountId ? String(e.accountId) : null,
  accountName: e.accountName ?? null,
  payee: e.payee ?? null,
  note: e.note ?? null,
  billRef: e.billRef ?? null,
  status: e.status,
  approvalId: e.approvalId ? String(e.approvalId) : null,
  by: e.by ?? null,
});

/** The petty cash book: balance, float, the approval limit and the entries in a period. */
export async function pettyCash({ from, to } = {}) {
  await ensureChart();
  const s = await settingsDoc();
  const filter = {};
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const [rows, balance, pending] = await Promise.all([
    PettyCash.find(filter).sort({ date: -1, createdAt: -1 }).limit(300).lean(),
    pettyBalance(),
    PettyCash.aggregate([
      { $match: { status: 'PENDING_APPROVAL' } },
      { $group: { _id: null, amount: { $sum: '$amount' } } },
    ]),
  ]);
  return {
    balance,
    pending: pending[0]?.amount ?? 0,
    float: s.pettyCash?.float ?? 20_000_00,
    approvalOver: s.pettyCash?.approvalOver ?? 2_000_00,
    version: s.version,
    items: rows.map(pettyOut),
  };
}

export const pettySettingsInput = z.object({
  version: z.number().int().min(0),
  float: z.number().int().min(0).max(10_00_000_00),
  approvalOver: z.number().int().min(0).max(10_00_000_00),
});

export async function setPettySettings(input) {
  const s = await settingsDoc();
  if (s.version !== input.version)
    throw errors.conflict('VERSION_CONFLICT', 'Changed by someone else; reload.');
  s.pettyCash = { float: input.float, approvalOver: input.approvalOver };
  await s.save();
  return pettyCash({ from: todayIST() });
}

export const pettyInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TOPUP'),
    date: ymd.optional(),
    amount: paise,
    note: z.string().trim().max(200).optional(),
  }),
  z.object({
    kind: z.literal('EXPENSE'),
    date: ymd.optional(),
    amount: paise,
    accountId: z.string(),
    payee: z.string().trim().min(2).max(120),
    note: z.string().trim().max(200).optional(),
    billRef: z.string().trim().max(60).optional(),
  }),
]);

async function postPetty(e) {
  const j =
    e.kind === 'TOPUP'
      ? await post({
          type: 'CONTRA',
          date: e.date,
          narration: `Petty cash top-up ${e.entryNo}`,
          source: { kind: 'PETTY_CASH', ref: e.entryNo },
          lines: [
            { key: 'PETTY_CASH', debit: e.amount },
            { key: 'BANK', credit: e.amount },
          ],
        })
      : await post({
          type: 'PAYMENT',
          date: e.date,
          narration: `Petty cash ${e.entryNo} · ${e.payee}${e.note ? ` · ${e.note}` : ''}`,
          source: { kind: 'PETTY_CASH', ref: e.entryNo },
          lines: [
            { accountId: e.accountId, debit: e.amount },
            { key: 'PETTY_CASH', credit: e.amount },
          ],
        });
  e.journalId = j._id;
  e.status = 'POSTED';
}

/**
 * A top-up posts Dr petty cash, Cr bank. An expense posts Dr the expense head, Cr petty cash, and
 * cannot exceed what is in the box; above the approval limit it waits for finance.expenseClaim.
 */
export async function addPettyCash(input, res) {
  await ensureChart();
  const date = input.date ?? todayIST();
  await assertOpen(date);
  let head;
  if (input.kind === 'EXPENSE') {
    head = await Account.findById(input.accountId).lean();
    if (!head || head.type !== 'EXPENSE' || head.isActive === false)
      throw errors.validation([{ path: 'accountId', message: 'Pick an expense ledger' }]);
    const box = await pettyCash({ from: date, to: date });
    if (input.amount > box.balance - box.pending)
      throw new AppError(
        422,
        'PETTY_CASH_SHORT',
        `Petty cash has ${box.balance - box.pending} available; top it up first.`,
      );
  }
  const s = await settingsDoc();
  const limit = s.pettyCash?.approvalOver ?? 2_000_00;
  return withTransaction(async () => {
    const [e] = await PettyCash.create([
      {
        ...input,
        date,
        entryNo: await documentNumber('PC'),
        accountName: head?.name,
        status: 'PENDING_APPROVAL',
        by: await userName(),
      },
    ]);
    const approval =
      input.kind === 'EXPENSE' && input.amount > limit
        ? await requestApproval({
            action: 'finance.expenseClaim',
            module: 'FIN',
            entity: 'PettyCash',
            entityId: e._id,
            title: `Petty cash ${e.entryNo} · ${input.payee}`,
            before: {},
            after: { amount: input.amount, head: head.name },
            payload: { entryId: String(e._id) },
            metrics: { amount: input.amount },
            reason: input.note ?? input.payee,
          })
        : null;
    if (approval) {
      e.approvalId = approval._id;
      if (res) res.locals.status = 202;
    } else {
      await postPetty(e);
    }
    await e.save();
    return pettyOut(e.toObject());
  });
}

onApprovalDecided('finance.expenseClaim', async (req, outcome) => {
  if (!req.payload?.entryId) return;
  const e = await PettyCash.findById(req.payload.entryId);
  if (!e || e.status !== 'PENDING_APPROVAL') return;
  if (outcome === 'APPROVED') await postPetty(e);
  else e.status = 'REJECTED';
  await e.save();
});

// ---------------------------------------------------------------- doctor payouts

const CATEGORIES = ['CONSULTATION', 'PROCEDURE', 'LAB', 'RAD', 'BED', 'NURSING', 'PACKAGE'];

const shareOut = (s) => ({
  id: String(s._id),
  userId: String(s.userId),
  name: s.name ?? '',
  shares: s.shares instanceof Map ? Object.fromEntries(s.shares) : (s.shares ?? {}),
  tdsPercent: s.tdsPercent ?? 10,
  isActive: s.isActive !== false,
  version: s.version,
});

export async function listShares() {
  const [rows, doctors] = await Promise.all([
    DoctorShare.find({}).sort({ name: 1 }).lean(),
    Doctor.find({ isActive: { $ne: false }, userId: { $exists: true } })
      .select('name userId')
      .sort({ name: 1 })
      .lean(),
  ]);
  return {
    items: rows.map(shareOut),
    categories: CATEGORIES,
    doctors: doctors.map((d) => ({ userId: String(d.userId), name: d.name })),
  };
}

export const shareInput = z.object({
  userId: z.string(),
  shares: z.partialRecord(z.enum(CATEGORIES), z.number().min(0).max(100)),
  tdsPercent: z.number().min(0).max(30).default(10),
  isActive: z.boolean().default(true),
});

/** Sets a doctor's share of their bills by category (one rule per doctor). */
export async function setShare(input) {
  const u = await User.findById(input.userId).select('name').lean();
  if (!u) throw notFound('Doctor');
  const found = await DoctorShare.findOne({ userId: input.userId });
  const doc = found ?? new DoctorShare({ userId: input.userId });
  doc.name = u.name;
  doc.shares = input.shares;
  doc.tdsPercent = input.tdsPercent;
  doc.isActive = input.isActive;
  await doc.save();
  return shareOut(doc.toObject({ flattenMaps: true }));
}

const payoutOut = (p) => ({
  id: String(p._id),
  month: p.month,
  userId: String(p.userId),
  name: p.name ?? '',
  bills: p.bills ?? 0,
  lines: p.lines ?? [],
  gross: p.gross ?? 0,
  tds: p.tds ?? 0,
  net: p.net ?? 0,
  status: p.status,
  paidAt: p.paidAt ?? null,
  mode: p.mode ?? null,
  reference: p.reference ?? null,
  version: p.version,
});

export async function listPayouts({ month }) {
  const rows = await DoctorPayout.find({ month }).sort({ name: 1 }).lean();
  return { month, items: rows.map(payoutOut) };
}

/**
 * Drafts the month's payouts from finalised bills of each doctor with a share rule: the share
 * percent of each category's net, less TDS. Paid payouts stay as they are.
 */
export async function draftPayouts({ month }) {
  const start = new Date(`${month}-01T00:00:00+05:30`);
  const [y, m] = month.split('-').map(Number);
  const end = new Date(
    `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}-01T00:00:00+05:30`,
  );
  const rules = await DoctorShare.find({ isActive: { $ne: false } }).lean();
  for (const r of rules) {
    const shares = r.shares instanceof Map ? Object.fromEntries(r.shares) : (r.shares ?? {});
    const bills = await Bill.find({
      doctorUserId: r.userId,
      status: { $in: ['FINAL', 'PARTLY_PAID', 'PAID'] },
      finalizedAt: { $gte: start, $lt: end },
    })
      .select('lines.category lines.net')
      .lean();
    const base = {};
    for (const b of bills)
      for (const l of b.lines ?? [])
        if (shares[l.category]) base[l.category] = (base[l.category] ?? 0) + (l.net ?? 0);
    const lines = Object.entries(base).map(([category, amt]) => ({
      category,
      base: amt,
      percent: shares[category],
      amount: Math.round((amt * shares[category]) / 100),
    }));
    const gross = lines.reduce((t, l) => t + l.amount, 0);
    const tds = Math.round((gross * (r.tdsPercent ?? 10)) / 100);
    const found = await DoctorPayout.findOne({ month, userId: r.userId });
    if (found?.status === 'PAID') continue;
    if (!gross && !found) continue;
    const doc = found ?? new DoctorPayout({ month, userId: r.userId });
    Object.assign(doc, { name: r.name, bills: bills.length, lines, gross, tds, net: gross - tds });
    await doc.save();
  }
  return listPayouts({ month });
}

export const payPayoutInput = z.object({
  version: z.number().int().min(0),
  mode: z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH']),
  reference: z.string().trim().max(60).optional(),
});

/** Pays a drafted payout: Dr doctor fees, Cr bank (net) and TDS payable. */
export async function payPayout(id, input) {
  const p = await DoctorPayout.findById(id);
  if (!p) throw notFound('Payout');
  if (p.version !== input.version)
    throw new AppError(409, 'VERSION_CONFLICT', 'Changed by someone else; reload.');
  if (p.status === 'PAID') throw new AppError(409, 'ALREADY_PAID', 'This payout is already paid.');
  if (!p.gross) throw new AppError(422, 'NOTHING_TO_PAY', 'This payout has nothing to pay.');
  await assertOpen(todayIST());
  return withTransaction(async () => {
    const j = await post({
      type: 'PAYMENT',
      narration: `Doctor payout ${p.month} · ${p.name}${input.reference ? ` · ${input.reference}` : ''}`,
      source: { kind: 'DOCTOR_PAYOUT', ref: String(p._id) },
      lines: [
        { key: 'DOCTOR_FEES', debit: p.gross },
        { key: MONEY_KEY[input.mode], credit: p.net },
        { key: 'TDS_PAYABLE', credit: p.tds },
      ],
    });
    Object.assign(p, {
      status: 'PAID',
      paidAt: new Date(),
      mode: input.mode,
      reference: input.reference,
      journalId: j._id,
    });
    await p.save();
    return payoutOut(p.toObject());
  });
}
