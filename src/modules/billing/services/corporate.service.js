import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { recordAudit } from '../../../core/audit/audit.service.js';
import { Patient } from '../../patients/index.js';
import { Payer } from '../../setup/index.js';
import { Bill, CorporateInvoice, LetterOfCredit } from '../models/billing.models.js';
import { creditUsed, patientSnapshot } from './bills.service.js';
import { istDate } from './pricing.js';

/**
 * Corporate and credit desk (design board "Corporate and credit"): corporates and government
 * payers billed on credit, their monthly invoices, receipts against them, receivables by age,
 * letters of credit. Money in paise; request amounts arrive in rupees and are converted by routes.
 */
const DAY = 86_400_000;
const CREDIT_KINDS = ['CORPORATE', 'GOVT_SCHEME'];
const OWED = ['FINAL', 'PARTLY_PAID'];

const monthEnd = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1) - 330 * 60_000 - 1); // last instant of the month in IST
};

export const invoiceDto = (i) => ({
  id: String(i._id),
  invoiceNo: i.invoiceNo,
  payerId: String(i.payerId),
  payer: i.payer,
  month: i.month,
  bills: (i.bills ?? []).map((b) => ({ ...b, billId: String(b.billId) })),
  total: i.total,
  taxable: i.taxable,
  paid: i.paid,
  balance: i.balance,
  status: i.status,
  issuedAt: i.issuedAt,
  dueAt: i.dueAt,
  overdueDays:
    i.balance > 0 && i.dueAt && new Date(i.dueAt) < new Date()
      ? Math.floor((Date.now() - new Date(i.dueAt)) / DAY)
      : 0,
  einvoice: i.einvoice ?? { status: 'NOT_NEEDED' },
  payments: i.payments ?? [],
  version: i.version ?? 0,
});

const letterDto = (l, today = istDate()) => ({
  id: String(l._id),
  payerId: String(l.payerId),
  payerName: l.payerName,
  patient: { ...l.patient, id: String(l.patient.id) },
  letterNo: l.letterNo,
  validTill: l.validTill,
  covers: l.covers,
  limit: l.limit,
  status: l.status === 'CANCELLED' ? 'CANCELLED' : l.validTill < today ? 'EXPIRED' : 'VALID',
  version: l.version ?? 0,
});

async function loadPayer(id) {
  const p = await Payer.findById(id).lean();
  if (!p || !CREDIT_KINDS.includes(p.kind)) throw errors.notFound('Corporate');
  return p;
}

/** Credit bills of a payer not yet on an invoice (they make the next invoice's draft). */
const uninvoiced = (payerId, until) =>
  Bill.find({
    'payer.payerId': payerId,
    status: { $in: OWED },
    corporateInvoiceId: null,
    'totals.balance': { $gt: 0 },
    ...(until ? { finalizedAt: { $lte: until } } : {}),
  })
    .sort({ finalizedAt: 1 })
    .lean();

const draftLine = (b) => ({
  billId: b._id,
  billNo: b.billNo,
  patient: b.patient?.name,
  uhid: b.patient?.uhid,
  date: b.finalizedAt,
  amount: b.totals.balance,
  taxable: (b.lines ?? []).filter((l) => l.taxRate > 0).reduce((t, l) => t + (l.taxable ?? 0), 0),
});

async function summary(p) {
  const [used, overdue, drafts] = await Promise.all([
    creditUsed(p._id),
    CorporateInvoice.find({ payerId: p._id, balance: { $gt: 0 }, dueAt: { $lt: new Date() } })
      .select('balance dueAt')
      .lean(),
    uninvoiced(p._id),
  ]);
  const overdueAmount = overdue.reduce((t, i) => t + i.balance, 0);
  const percent = p.creditLimit > 0 ? Math.round((used * 100) / p.creditLimit) : 0;
  return {
    id: String(p._id),
    code: p.code,
    name: p.name,
    kind: p.kind,
    gstin: p.gstin,
    contactName: p.contactName,
    email: p.email,
    priceListId: p.priceListId ? String(p.priceListId) : null,
    creditLimit: p.creditLimit ?? 0,
    creditDays: p.creditDays ?? 30,
    used,
    percent,
    overdue: overdueAmount,
    overdueDays: overdue.reduce(
      (m, i) => Math.max(m, Math.floor((Date.now() - new Date(i.dueAt)) / DAY)),
      0,
    ),
    draft: { bills: drafts.length, amount: drafts.reduce((t, b) => t + b.totals.balance, 0) },
    hold: p.creditHold?.on
      ? { reason: p.creditHold.reason, at: p.creditHold.at, by: p.creditHold.by }
      : null,
    status: p.creditHold?.on
      ? 'ON_HOLD'
      : !p.isActive
        ? 'INACTIVE'
        : p.creditLimit > 0 && percent >= 90
          ? 'NEAR_LIMIT'
          : 'ACTIVE',
  };
}

/** Payers a cashier may bill on credit now (active, not on hold), for the new-bill form. */
export async function creditPayers() {
  const rows = await Payer.find({
    kind: { $in: CREDIT_KINDS },
    isActive: true,
    'creditHold.on': { $ne: true },
  })
    .select('code name kind priceListId')
    .sort({ name: 1 })
    .lean();
  return {
    items: rows.map((p) => ({
      id: String(p._id),
      code: p.code,
      name: p.name,
      kind: p.kind,
      priceListId: p.priceListId ? String(p.priceListId) : null,
    })),
  };
}

export async function listCorporates() {
  const payers = await Payer.find({ kind: { $in: CREDIT_KINDS } })
    .sort({ name: 1 })
    .lean();
  const items = await Promise.all(payers.map(summary));
  return {
    items,
    totals: {
      active: items.filter((c) => c.status !== 'INACTIVE').length,
      used: items.reduce((t, c) => t + c.used, 0),
      overdue: items.reduce((t, c) => t + c.overdue, 0),
      drafts: items.reduce((t, c) => t + c.draft.amount, 0),
    },
  };
}

export async function getCorporate(id) {
  const p = await loadPayer(id);
  const [s, drafts, invoices] = await Promise.all([
    summary(p),
    uninvoiced(p._id),
    CorporateInvoice.find({ payerId: p._id }).sort({ issuedAt: -1 }).limit(24).lean(),
  ]);
  return { ...s, draftBills: drafts.map(draftLine), invoices: invoices.map(invoiceDto) };
}

export async function setHold(id, { on, reason }) {
  const p = await loadPayer(id);
  const by = current().userName ?? 'user';
  await Payer.updateOne(
    { _id: p._id },
    { $set: { creditHold: on ? { on: true, reason, at: new Date(), by } : { on: false } } },
  );
  await recordAudit({
    action: 'UPDATE',
    entity: 'Payer',
    entityId: String(p._id),
    summary: on ? `${p.name} put on credit hold: ${reason}` : `${p.name} taken off credit hold`,
  });
  return summary(await Payer.findById(p._id).lean());
}

/** Issues the month's invoice: every uninvoiced credit bill finalised up to the month's end. */
export async function issueInvoice({ payerId, month }) {
  const p = await loadPayer(payerId);
  return withTransaction(async () => {
    const bills = await uninvoiced(p._id, monthEnd(month));
    if (!bills.length)
      throw new AppError(409, 'NOTHING_TO_INVOICE', `No credit bills for ${p.name} up to ${month}`);
    const lines = bills.map(draftLine);
    const total = lines.reduce((t, l) => t + l.amount, 0);
    const taxable = lines.reduce((t, l) => t + l.taxable, 0);
    const issuedAt = new Date();
    const [inv] = await CorporateInvoice.create([
      {
        invoiceNo: await documentNumber('CI', { perBranch: false }),
        payerId: p._id,
        payer: { code: p.code, name: p.name, gstin: p.gstin },
        month,
        bills: lines,
        total,
        taxable,
        paid: 0,
        balance: total,
        issuedAt,
        dueAt: new Date(issuedAt.getTime() + (p.creditDays ?? 30) * DAY),
        einvoice: { status: taxable > 0 && p.gstin ? 'PENDING' : 'NOT_NEEDED' },
      },
    ]);
    const updated = await Bill.updateMany(
      { _id: { $in: bills.map((b) => b._id) }, corporateInvoiceId: null },
      { $set: { corporateInvoiceId: inv._id } },
    );
    if (updated.modifiedCount !== bills.length)
      throw new AppError(409, 'VERSION_CONFLICT', 'Bills changed while invoicing; try again');
    return invoiceDto(inv);
  });
}

export async function listInvoices({ payerId, status, page = 1, limit = 25 }) {
  const filter = {
    ...(payerId ? { payerId } : {}),
    ...(status === 'OVERDUE'
      ? { balance: { $gt: 0 }, dueAt: { $lt: new Date() } }
      : status
        ? { status }
        : {}),
  };
  const [items, total] = await Promise.all([
    CorporateInvoice.find(filter)
      .sort({ issuedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CorporateInvoice.countDocuments(filter),
  ]);
  return { items: items.map(invoiceDto), total, page, limit };
}

/**
 * A payment from the company: settles the invoice's bills oldest first and posts to the books
 * (Dr bank, Cr corporate receivables). Amount in paise.
 */
export async function receivePayment(id, { version, amount, mode, reference }) {
  return withTransaction(async () => {
    const inv = await CorporateInvoice.findById(id);
    if (!inv) throw errors.notFound('Invoice');
    if (inv.version !== version) throw errors.versionConflict();
    if (!['ISSUED', 'PARTLY_PAID'].includes(inv.status))
      throw new AppError(409, 'INVALID_STATE', 'This invoice is not open for payment');
    if (amount > inv.balance)
      throw errors.validation([{ path: 'amount', message: 'More than the invoice balance' }]);
    let left = amount;
    for (const line of inv.bills) {
      if (!left) break;
      const bill = await Bill.findById(line.billId);
      if (!bill || bill.status === 'CANCELLED') continue;
      const take = Math.min(left, bill.totals.balance);
      if (take <= 0) continue;
      bill.totals.paid += take;
      bill.totals.balance -= take;
      bill.corporatePaid = (bill.corporatePaid ?? 0) + take;
      bill.status = bill.totals.balance <= 0 ? 'PAID' : 'PARTLY_PAID';
      await bill.save();
      left -= take;
    }
    const applied = amount - left;
    if (!applied)
      throw new AppError(409, 'NOTHING_OWED', 'The bills on this invoice are already settled');
    inv.paid += applied;
    inv.balance -= applied;
    inv.status = inv.balance <= 0 ? 'PAID' : 'PARTLY_PAID';
    inv.payments.push({ at: new Date(), amount: applied, mode, reference, by: current().userName });
    await inv.save();
    await publish('billing.corporateReceived', {
      invoiceId: String(inv._id),
      invoiceNo: inv.invoiceNo,
      payer: inv.payer?.name,
      amount: applied,
      mode,
      reference,
    });
    return invoiceDto(inv);
  });
}

/** Corporate receivables by invoice age on today's date. */
export async function ageing() {
  const open = await CorporateInvoice.find({ balance: { $gt: 0 } })
    .select('payerId payer balance issuedAt')
    .lean();
  const by = new Map();
  for (const i of open) {
    const days = Math.floor((Date.now() - new Date(i.issuedAt)) / DAY);
    const key = days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90';
    const row = by.get(String(i.payerId)) ?? {
      payerId: String(i.payerId),
      name: i.payer?.name,
      d0_30: 0,
      d31_60: 0,
      d61_90: 0,
      d90: 0,
      total: 0,
    };
    row[key] += i.balance;
    row.total += i.balance;
    by.set(String(i.payerId), row);
  }
  const items = [...by.values()].sort((a, b) => b.total - a.total);
  const totals = ['d0_30', 'd31_60', 'd61_90', 'd90', 'total'].reduce(
    (o, k) => ({ ...o, [k]: items.reduce((t, r) => t + r[k], 0) }),
    {},
  );
  return { items, totals };
}

/** Statement of account: invoices and receipts in date order with the running balance. */
export async function statement(id) {
  const p = await loadPayer(id);
  const invoices = await CorporateInvoice.find({ payerId: p._id }).sort({ issuedAt: 1 }).lean();
  const entries = [];
  for (const i of invoices) {
    entries.push({ at: i.issuedAt, kind: 'INVOICE', ref: i.invoiceNo, debit: i.total, credit: 0 });
    for (const pay of i.payments ?? [])
      entries.push({
        at: pay.at,
        kind: 'RECEIPT',
        ref: pay.reference ?? i.invoiceNo,
        debit: 0,
        credit: pay.amount,
      });
  }
  entries.sort((a, b) => new Date(a.at) - new Date(b.at));
  let balance = 0;
  for (const e of entries) {
    balance += e.debit - e.credit;
    e.balance = balance;
  }
  return { payer: { id: String(p._id), name: p.name, gstin: p.gstin }, entries, balance };
}

// ---------------------------------------------------------------- letters of credit

export async function listLetters({ payerId } = {}) {
  const rows = await LetterOfCredit.find(payerId ? { payerId } : {})
    .sort({ validTill: -1 })
    .limit(200)
    .lean();
  return { items: rows.map((l) => letterDto(l)) };
}

export async function addLetter({ payerId, patientId, letterNo, validTill, covers, limit }) {
  const p = await loadPayer(payerId);
  const patient = await Patient.findById(patientId).lean();
  if (!patient) throw errors.validation([{ path: 'patientId', message: 'Patient not found' }]);
  const [l] = await LetterOfCredit.create([
    {
      payerId: p._id,
      payerName: p.name,
      patient: patientSnapshot(patient),
      letterNo,
      validTill,
      covers,
      limit,
    },
  ]);
  return letterDto(l);
}

export async function cancelLetter(id, { version }) {
  const l = await LetterOfCredit.findById(id);
  if (!l) throw errors.notFound('Letter of credit');
  if (l.version !== version) throw errors.versionConflict();
  l.status = 'CANCELLED';
  await l.save();
  return letterDto(l);
}
