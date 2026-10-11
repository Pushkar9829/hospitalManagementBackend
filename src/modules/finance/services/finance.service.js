import { z } from 'zod';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { current } from '../../../core/tenancy/context.js';
import { Bill } from '../../billing/index.js';
import { PaymentMode } from '../../setup/index.js';
import { CHART, MONEY_BY_MODE, REVENUE_BY_CATEGORY } from '../data/chart.js';
import { Account, FinanceSettings, Journal } from '../models/finance.models.js';

const PREFIX = {
  SALES: 'SJ',
  RECEIPT: 'RV',
  PAYMENT: 'PV',
  JOURNAL: 'JV',
  CONTRA: 'CV',
  PURCHASE: 'PJ',
  PAYROLL: 'PR',
  REVERSAL: 'RJ',
};
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

// ---------------------------------------------------------------- chart

/** Seeds the hospital chart on first use (idempotent). */
const SYSTEM_KEYS = CHART.filter((r) => r[4]).map((r) => r[4]);

/** The pre-loaded chart; system accounts added in later releases are created on first use. */
export async function ensureChart() {
  if ((await Account.countDocuments({ key: { $in: SYSTEM_KEYS } })) === SYSTEM_KEYS.length) return;
  const fresh = !(await Account.exists({ key: 'CASH' }));
  for (const [code, name, type, group, key] of CHART) {
    if (!fresh && !key) continue; // a hospital's own ledgers are its business
    if (await Account.exists(key ? { $or: [{ code }, { key }] } : { code })) continue;
    try {
      await Account.create([{ code, name, type, group, ...(key ? { key } : {}) }]);
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
}

const accountOut = (a) => ({
  id: String(a._id),
  code: a.code,
  name: a.name,
  type: a.type,
  group: a.group ?? null,
  key: a.key ?? null,
  isActive: a.isActive !== false,
});

export async function listAccounts() {
  await ensureChart();
  const rows = await Account.find({}).sort({ code: 1 }).lean();
  return { items: rows.map(accountOut) };
}

export const accountInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,6}$/, 'Use 4 to 6 digits'),
  name: z.string().trim().min(2).max(80),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  group: z.string().trim().max(60).optional(),
});

export async function createAccount(input) {
  await ensureChart();
  try {
    return accountOut((await Account.create([input]))[0].toObject());
  } catch (e) {
    if (e?.code === 11000)
      throw errors.conflict('ACCOUNT_CODE_TAKEN', 'An account with this code exists');
    throw e;
  }
}

async function byKey(key) {
  await ensureChart();
  const a = await Account.findOne({ key }).lean();
  if (!a) throw new Error(`System account ${key} missing`);
  return a;
}

// ---------------------------------------------------------------- posting

export async function settingsDoc() {
  const found = await FinanceSettings.findOne();
  if (found) return found;
  try {
    return (await FinanceSettings.create([{}]))[0];
  } catch (e) {
    if (e?.code === 11000) return FinanceSettings.findOne();
    throw e;
  }
}

export async function assertOpen(date) {
  const s = await settingsDoc();
  if (s.lockedThrough && date.slice(0, 7) <= s.lockedThrough)
    throw new AppError(409, 'PERIOD_LOCKED', `Accounts are locked through ${s.lockedThrough}.`);
}

/**
 * Posts a balanced journal. Lines are [{ key | accountId, debit, credit, costCentre }] in paise;
 * zero lines are dropped. A journal for an event already posted is skipped (returns null).
 */
export async function post({
  type,
  date = todayIST(),
  narration,
  lines,
  source,
  status = 'POSTED',
}) {
  if (source?.eventId && (await Journal.exists({ 'source.eventId': source.eventId }))) return null;
  // An auto-posting dated in a locked month moves to today (the original month stays closed).
  const s = await settingsDoc();
  let day = date;
  if (s.lockedThrough && day.slice(0, 7) <= s.lockedThrough) {
    if (!source) await assertOpen(day);
    day = todayIST();
  }
  const resolved = [];
  for (const l of lines) {
    const debit = Math.round(l.debit ?? 0);
    const credit = Math.round(l.credit ?? 0);
    if (!debit && !credit) continue;
    if (debit < 0 || credit < 0 || (debit && credit))
      throw errors.validation([
        { path: 'lines', message: 'Each line is a debit or a credit, not both' },
      ]);
    const a = l.key ? await byKey(l.key) : await Account.findById(l.accountId).lean();
    if (!a || a.isActive === false)
      throw errors.validation([{ path: 'lines', message: 'Pick active accounts' }]);
    resolved.push({
      accountId: a._id,
      code: a.code,
      name: a.name,
      debit,
      credit,
      costCentre: l.costCentre,
    });
  }
  const dr = resolved.reduce((t, l) => t + l.debit, 0);
  const cr = resolved.reduce((t, l) => t + l.credit, 0);
  if (dr !== cr)
    throw new AppError(422, 'JOURNAL_NOT_BALANCED', `Debits ${dr} and credits ${cr} do not match.`);
  if (resolved.length < 2)
    throw errors.validation([{ path: 'lines', message: 'A journal needs two lines or more' }]);
  const [j] = await Journal.create([
    {
      voucherNo: await documentNumber(PREFIX[type]),
      type,
      date: day,
      narration,
      lines: resolved,
      total: dr,
      source,
      status,
      createdByName: await userName(),
    },
  ]);
  return j;
}

const moneyKey = async (modeCode) => {
  const m = await PaymentMode.findOne({ code: modeCode }).select('kind').lean();
  return MONEY_BY_MODE[m?.kind ?? modeCode] ?? 'BANK';
};

/** billing.billFinalized: revenue by department, GST output, rounding, receivable. */
export async function onBillFinalized({ billId }, meta = {}) {
  const b = await Bill.findById(billId).lean();
  if (!b) return null;
  const rev = new Map();
  for (const l of b.lines) {
    const key = REVENUE_BY_CATEGORY[l.category] ?? 'REV_OTHER';
    rev.set(key, (rev.get(key) ?? 0) + (l.taxable ?? 0));
  }
  const ar = ['CASH', undefined, null].includes(b.payer?.kind) ? 'AR_PATIENT' : 'AR_CORPORATE';
  return post({
    type: 'SALES',
    narration: `Bill ${b.billNo} · ${b.patient?.name ?? ''}`,
    source: { kind: 'BILL', ref: String(b._id), eventId: meta.eventId },
    lines: [
      { key: ar, debit: b.totals.total },
      ...[...rev].map(([key, amount]) => ({
        key,
        credit: amount,
        costCentre: key.replace('REV_', ''),
      })),
      { key: 'CGST_OUTPUT', credit: b.totals.cgst },
      { key: 'SGST_OUTPUT', credit: b.totals.sgst },
      b.totals.roundOff >= 0
        ? { key: 'ROUND_OFF', credit: b.totals.roundOff }
        : { key: 'ROUND_OFF', debit: -b.totals.roundOff },
    ],
  });
}

/** billing.billCancelled: the bill's journal reversed. */
export async function onBillCancelled({ billId }, meta = {}) {
  const orig = await Journal.findOne({
    'source.kind': 'BILL',
    'source.ref': String(billId),
    type: 'SALES',
  }).lean();
  if (!orig) return null;
  return post({
    type: 'REVERSAL',
    narration: `Cancelled: ${orig.narration}`,
    source: { kind: 'BILL_CANCEL', ref: String(billId), eventId: meta.eventId },
    lines: orig.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
      costCentre: l.costCentre,
    })),
  });
}

/** billing.paymentReceived: money in (or an advance adjusted) against the receivable. */
export async function onPayment({ paymentId, receiptNo, amount, mode }, meta = {}) {
  return post({
    type: 'RECEIPT',
    narration: `Receipt ${receiptNo ?? ''} (${mode})`,
    source: { kind: 'PAYMENT', ref: paymentId, eventId: meta.eventId },
    lines: [
      { key: await moneyKey(mode), debit: amount },
      { key: 'AR_PATIENT', credit: amount },
    ],
  });
}

/** billing.cashBanked: drawer cash taken to the bank on a deposit slip. */
export async function onCashBanked({ depositId, slipNo, amount, bank }, meta = {}) {
  return post({
    type: 'CONTRA',
    narration: `Cash deposited ${slipNo ?? ''} to ${bank ?? 'bank'}`,
    source: { kind: 'CASH_BANKED', ref: depositId, eventId: meta.eventId },
    lines: [
      { key: 'BANK', debit: amount },
      { key: 'CASH', credit: amount },
    ],
  });
}

/** billing.corporateReceived: a company pays its invoice (bank or cheque). */
export async function onCorporateReceipt({ invoiceId, invoiceNo, payer, amount, mode }, meta = {}) {
  return post({
    type: 'RECEIPT',
    narration: `Corporate receipt ${invoiceNo ?? ''} from ${payer ?? 'company'} (${mode})`,
    source: { kind: 'CORPORATE_RECEIPT', ref: invoiceId, eventId: meta.eventId },
    lines: [
      { key: MONEY_BY_MODE[mode] ?? 'BANK', debit: amount },
      { key: 'AR_CORPORATE', credit: amount },
    ],
  });
}

/** billing.depositReceived: advance held for the patient. */
export async function onDeposit({ depositId, depositNo, amount, mode }, meta = {}) {
  return post({
    type: 'RECEIPT',
    narration: `Deposit ${depositNo ?? ''} (${mode})`,
    source: { kind: 'DEPOSIT', ref: depositId, eventId: meta.eventId },
    lines: [
      { key: await moneyKey(mode), debit: amount },
      { key: 'PATIENT_ADVANCE', credit: amount },
    ],
  });
}

/** billing.refundPaid: money out through the original modes. */
export async function onRefund({ refundId, refundNo, amount, modes = [] }, meta = {}) {
  const out = [];
  for (const m of modes.length ? modes : [{ mode: 'CASH', amount }])
    out.push({ key: MONEY_BY_MODE[m.modeKind] ?? (await moneyKey(m.mode)), credit: m.amount });
  return post({
    type: 'PAYMENT',
    narration: `Refund ${refundNo ?? ''}`,
    source: { kind: 'REFUND', ref: refundId, eventId: meta.eventId },
    lines: [{ key: 'AR_PATIENT', debit: amount }, ...out],
  });
}

/** inventory.grn.posted: stock and GST input against the vendor. */
export async function onGrn({ grnId, grnNo, total, tax }, meta = {}) {
  return post({
    type: 'PURCHASE',
    narration: `Goods receipt ${grnNo}`,
    source: { kind: 'GRN', ref: grnId, eventId: meta.eventId },
    lines: [
      { key: 'INVENTORY', debit: total },
      { key: 'GST_INPUT', debit: tax },
      { key: 'AP_VENDOR', credit: total + tax },
    ],
  });
}

/** payroll.loan.disbursed: a staff loan or salary advance paid out from the bank. */
export async function onLoanDisbursed({ loanId, kind, amount }, meta = {}) {
  return post({
    type: 'PAYMENT',
    narration: kind === 'ADVANCE' ? 'Salary advance paid' : 'Staff loan paid',
    source: { kind: 'LOAN', ref: loanId, eventId: meta.eventId },
    lines: [
      { key: 'STAFF_LOANS', debit: amount },
      { key: 'BANK', credit: amount },
    ],
  });
}

/** payroll.locked: salary cost and the statutory payables. */
export async function onPayroll({ runId, month, totals: t }, meta = {}) {
  return post({
    type: 'PAYROLL',
    narration: `Payroll ${month}`,
    source: { kind: 'PAYROLL', ref: runId, eventId: meta.eventId },
    lines: [
      { key: 'SALARIES', debit: t.gross },
      { key: 'EMPLOYER_STATUTORY', debit: (t.pfEmployer ?? 0) + (t.esiEmployer ?? 0) },
      { key: 'SALARY_PAYABLE', credit: t.net },
      { key: 'PF_PAYABLE', credit: (t.pfEmployee ?? 0) + (t.pfEmployer ?? 0) },
      { key: 'ESI_PAYABLE', credit: (t.esiEmployee ?? 0) + (t.esiEmployer ?? 0) },
      { key: 'PT_PAYABLE', credit: t.pt ?? 0 },
      { key: 'TDS_PAYABLE', credit: t.tds ?? 0 },
      { key: 'STAFF_LOANS', credit: t.loans ?? 0 },
      { key: 'REV_OTHER', credit: t.other ?? 0 },
    ],
  });
}

// ---------------------------------------------------------------- vouchers

export const voucherInput = z.object({
  type: z.enum(['JOURNAL', 'PAYMENT', 'RECEIPT', 'CONTRA']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  narration: z.string().trim().min(3).max(300),
  lines: z
    .array(
      z.object({
        accountId: z.string(),
        debit: z.number().int().min(0).max(1_00_00_000_00).default(0),
        credit: z.number().int().min(0).max(1_00_00_000_00).default(0),
        costCentre: z.string().trim().max(30).optional(),
      }),
    )
    .min(2)
    .max(30),
});

const journalOut = (j) => ({
  id: String(j._id),
  voucherNo: j.voucherNo,
  type: j.type,
  date: j.date,
  narration: j.narration ?? null,
  lines: j.lines.map((l) => ({ ...l, accountId: String(l.accountId) })),
  total: j.total,
  source: j.source?.kind ? { kind: j.source.kind, ref: j.source.ref } : null,
  status: j.status,
  createdByName: j.createdByName ?? null,
  approvalId: j.approvalId ? String(j.approvalId) : null,
  createdAt: j.createdAt,
});

/**
 * Payment, receipt and contra vouchers post at once; a manual journal waits for the Finance
 * Controller (finance.manualJournal). Locked months refuse new vouchers.
 */
export async function createVoucher(input, res) {
  await assertOpen(input.date);
  const manual = input.type === 'JOURNAL';
  return withTransaction(async () => {
    const j = await post({ ...input, status: manual ? 'PENDING_APPROVAL' : 'POSTED' });
    if (manual) {
      const approval = await requestApproval({
        action: 'finance.manualJournal',
        module: 'FIN',
        entity: 'Journal',
        entityId: j._id,
        title: `Manual journal ${j.voucherNo} · ${input.narration}`,
        before: {},
        after: { total: j.total },
        payload: { journalId: String(j._id) },
        metrics: { amount: j.total },
        reason: input.narration,
      });
      if (approval) {
        j.approvalId = approval._id;
        await j.save();
        if (res) res.locals.status = 202;
      } else {
        j.status = 'POSTED';
        await j.save();
      }
    }
    return journalOut(j.toObject());
  });
}

onApprovalDecided('finance.manualJournal', async (req, outcome) => {
  const j = await Journal.findById(req.payload.journalId);
  if (!j || j.status !== 'PENDING_APPROVAL') return;
  j.status = outcome === 'APPROVED' ? 'POSTED' : 'REJECTED';
  await j.save();
});

export async function listJournals({ from, to, type, accountId, limit = 200 } = {}) {
  const filter = {};
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (type) filter.type = type;
  if (accountId) filter['lines.accountId'] = accountId;
  const rows = await Journal.find(filter).sort({ date: -1, createdAt: -1 }).limit(limit).lean();
  return { items: rows.map(journalOut) };
}

// ---------------------------------------------------------------- statements

const POSTED = { status: { $in: ['POSTED', 'REVERSED'] } };

async function balances({ from, to }) {
  const match = { ...POSTED };
  if (from || to) match.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rows = await Journal.aggregate([
    { $match: match },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.accountId',
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

/** Trial balance as of a date: every account's debit or credit balance; the totals agree. */
export async function trialBalance({ asOf = todayIST() } = {}) {
  await ensureChart();
  const [accounts, sums] = await Promise.all([
    Account.find({}).sort({ code: 1 }).lean(),
    balances({ to: asOf }),
  ]);
  const items = accounts
    .map((a) => {
      const s = sums.get(String(a._id)) ?? { debit: 0, credit: 0 };
      const net = s.debit - s.credit;
      return { ...accountOut(a), debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((r) => r.debit || r.credit);
  const debit = items.reduce((t, r) => t + r.debit, 0);
  const credit = items.reduce((t, r) => t + r.credit, 0);
  return { asOf, items, debit, credit, balanced: debit === credit };
}

/** Profit and loss for a period: income less expenses, by group. */
export async function profitLoss({ from, to = todayIST() }) {
  await ensureChart();
  const [accounts, sums] = await Promise.all([
    Account.find({ type: { $in: ['INCOME', 'EXPENSE'] } })
      .sort({ code: 1 })
      .lean(),
    balances({ from, to }),
  ]);
  const line = (a) => {
    const s = sums.get(String(a._id)) ?? { debit: 0, credit: 0 };
    return {
      ...accountOut(a),
      amount: a.type === 'INCOME' ? s.credit - s.debit : s.debit - s.credit,
    };
  };
  const income = accounts
    .filter((a) => a.type === 'INCOME')
    .map(line)
    .filter((r) => r.amount);
  const expenses = accounts
    .filter((a) => a.type === 'EXPENSE')
    .map(line)
    .filter((r) => r.amount);
  const totalIncome = income.reduce((t, r) => t + r.amount, 0);
  const totalExpenses = expenses.reduce((t, r) => t + r.amount, 0);
  return {
    from: from ?? null,
    to,
    income,
    expenses,
    totalIncome,
    totalExpenses,
    profit: totalIncome - totalExpenses,
  };
}

/** Balance sheet as of a date; profit to date sits in equity, so the two sides agree. */
export async function balanceSheet({ asOf = todayIST() } = {}) {
  await ensureChart();
  const [accounts, sums, pl] = await Promise.all([
    Account.find({ type: { $in: ['ASSET', 'LIABILITY', 'EQUITY'] } })
      .sort({ code: 1 })
      .lean(),
    balances({ to: asOf }),
    profitLoss({ to: asOf }),
  ]);
  const amt = (a) => {
    const s = sums.get(String(a._id)) ?? { debit: 0, credit: 0 };
    return a.type === 'ASSET' ? s.debit - s.credit : s.credit - s.debit;
  };
  const side = (type) =>
    accounts
      .filter((a) => a.type === type)
      .map((a) => ({ ...accountOut(a), amount: amt(a) }))
      .filter((r) => r.amount);
  const assets = side('ASSET');
  const liabilities = side('LIABILITY');
  const equity = [
    ...side('EQUITY'),
    { id: 'PL', code: '-', name: 'Profit to date', type: 'EQUITY', amount: pl.profit },
  ];
  const total = (rows) => rows.reduce((t, r) => t + r.amount, 0);
  return {
    asOf,
    assets,
    liabilities,
    equity,
    totalAssets: total(assets),
    totalLiabilitiesEquity: total(liabilities) + total(equity),
    balanced: total(assets) === total(liabilities) + total(equity),
  };
}

/** An account's ledger: opening balance, the period's lines with a running balance. */
export async function ledger({ accountId, from, to = todayIST() }) {
  const a = await Account.findById(accountId).lean();
  if (!a) throw errors.notFound('Account');
  const debitNormal = ['ASSET', 'EXPENSE'].includes(a.type);
  const before = from ? (await balances({ to: prevDay(from) })).get(String(a._id)) : null;
  let running = before
    ? debitNormal
      ? before.debit - before.credit
      : before.credit - before.debit
    : 0;
  const opening = running;
  const rows = await Journal.find({
    ...POSTED,
    'lines.accountId': a._id,
    date: { ...(from ? { $gte: from } : {}), $lte: to },
  })
    .sort({ date: 1, createdAt: 1 })
    .lean();
  const items = [];
  for (const j of rows)
    for (const l of j.lines.filter((x) => String(x.accountId) === String(a._id))) {
      running += debitNormal ? l.debit - l.credit : l.credit - l.debit;
      items.push({
        date: j.date,
        voucherNo: j.voucherNo,
        type: j.type,
        narration: j.narration,
        debit: l.debit,
        credit: l.credit,
        balance: running,
      });
    }
  return { account: accountOut(a), from: from ?? null, to, opening, closing: running, items };
}

const prevDay = (d) =>
  new Date(new Date(`${d}T12:00:00+05:30`).getTime() - 86_400_000 + 330 * 60_000)
    .toISOString()
    .slice(0, 10);

/** GST for a month: output on bills by rate (GSTR-1 style) and input from purchases. */
export async function gstSummary({ month }) {
  const from = new Date(`${month}-01T00:00:00+05:30`);
  const to = new Date(from);
  to.setMonth(to.getMonth() + 1);
  const bills = await Bill.find({
    status: { $in: ['FINAL', 'PAID', 'PARTLY_PAID'] },
    finalizedAt: { $gte: from, $lt: to },
  })
    .select('lines')
    .lean();
  const byRate = new Map();
  for (const b of bills)
    for (const l of b.lines) {
      const r = byRate.get(l.taxRate) ?? { rate: l.taxRate, taxable: 0, cgst: 0, sgst: 0 };
      r.taxable += l.taxable ?? 0;
      r.cgst += l.cgst ?? 0;
      r.sgst += l.sgst ?? 0;
      byRate.set(l.taxRate, r);
    }
  const input = await Journal.aggregate([
    { $match: { ...POSTED, date: { $gte: `${month}-01`, $lte: `${month}-31` }, type: 'PURCHASE' } },
    { $unwind: '$lines' },
    { $match: { 'lines.code': '1210' } },
    { $group: { _id: null, amount: { $sum: '$lines.debit' } } },
  ]);
  const output = [...byRate.values()].sort((a, b) => a.rate - b.rate);
  const outputTax = output.reduce((t, r) => t + r.cgst + r.sgst, 0);
  const inputTax = input[0]?.amount ?? 0;
  return { month, output, outputTax, inputTax, payable: outputTax - inputTax };
}

// ---------------------------------------------------------------- period lock

export async function getPeriod() {
  const s = await settingsDoc();
  return { lockedThrough: s.lockedThrough ?? null, history: s.lockHistory ?? [] };
}

/** Month close: no voucher can be posted in or before it. */
export async function lockPeriod({ month }) {
  const s = await settingsDoc();
  if (s.lockedThrough && month <= s.lockedThrough)
    throw new AppError(409, 'INVALID_STATE', `Already locked through ${s.lockedThrough}.`);
  if (await Journal.exists({ status: 'PENDING_APPROVAL', date: { $lte: `${month}-31` } }))
    throw new AppError(
      409,
      'JOURNALS_PENDING',
      'Manual journals in this period still wait for approval.',
    );
  s.lockedThrough = month;
  s.lockHistory.push({ month, action: 'LOCK', by: await userName(), at: new Date() });
  await s.save();
  return getPeriod();
}

/** Reopening is for the Super Admin only (audited). */
export async function reopenPeriod({ month, reason }) {
  const s = await settingsDoc();
  if (!s.lockedThrough || month > s.lockedThrough)
    throw new AppError(409, 'INVALID_STATE', 'That month is open.');
  const [y, m] = month.split('-').map(Number);
  s.lockedThrough = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  s.lockHistory.push({ month, action: 'REOPEN', by: await userName(), at: new Date(), reason });
  await s.save();
  return getPeriod();
}
