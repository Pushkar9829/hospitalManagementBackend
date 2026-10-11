import { ageLabel, fullName } from '@hms/shared';
import { BILL_TYPES } from '@hms/shared/schemas';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { paginate } from '../../../core/http/paginate.js';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { numbering, Payer, PriceList, Service, TaxCode } from '../../setup/index.js';
import { Patient } from '../../patients/index.js';
import { Bill, CreditNote, Deposit, Payment, Refund } from '../models/billing.models.js';
import {
  CATEGORY_LIST_KIND,
  applyDiscount,
  billTotals,
  discountAmount,
  priceLine,
  taxLine,
} from './pricing.js';
import { requireOpenShift } from './shift.service.js';

export const billDto = (b) => ({
  id: String(b._id),
  billNo: b.billNo,
  type: b.type,
  patient: { ...b.patient, id: String(b.patient.id) },
  branchId: String(b.branchId),
  payer: {
    kind: b.payer?.kind,
    payerId: b.payer?.payerId ? String(b.payer.payerId) : undefined,
    name: b.payer?.name,
    priceListCode: b.payer?.priceListCode,
  },
  corporateInvoiceId: b.corporateInvoiceId ? String(b.corporateInvoiceId) : undefined,
  lines: b.lines.map((l) => ({
    id: String(l._id),
    serviceId: l.serviceId ? String(l.serviceId) : null,
    item: l.item?.itemId
      ? { itemId: String(l.item.itemId), batchNo: l.item.batchNo, expiry: l.item.expiry }
      : null,
    code: l.code,
    name: l.name,
    category: l.category,
    qty: l.qty,
    unitPrice: l.unitPrice,
    gross: l.gross,
    discount: l.discount,
    taxable: l.taxable,
    taxRate: l.taxRate,
    cgst: l.cgst,
    sgst: l.sgst,
    net: l.net,
  })),
  totals: b.totals,
  discount: b.discount?.status
    ? {
        kind: b.discount.kind,
        value: b.discount.value,
        amount: b.discount.amount,
        reason: b.discount.reason,
        status: b.discount.status,
        approvalId: b.discount.approvalId && String(b.discount.approvalId),
      }
    : undefined,
  status: b.status,
  hold: b.hold,
  cancellation: b.cancellation?.reason
    ? {
        ...b.cancellation,
        approvalId: b.cancellation.approvalId && String(b.cancellation.approvalId),
      }
    : undefined,
  finalizedAt: b.finalizedAt,
  createdAt: b.createdAt,
  printCount: b.printCount,
  version: b.version,
});

export const patientSnapshot = (p) => ({
  id: p._id,
  uhid: p.uhid,
  name: fullName(p.name),
  age: ageLabel(p.dob),
  gender: p.gender,
  mobile: p.mobile,
});

async function loadPatient(id) {
  const p = await Patient.findById(id).lean();
  if (!p) throw errors.validation([{ path: 'patientId', message: 'Patient not found' }]);
  if (p.status === 'MERGED')
    throw new AppError(409, 'PATIENT_MERGED', 'This UHID was merged; bill the surviving record');
  return p;
}

/**
 * Rule R1: price every line from the patient's price list (or a corporate payer's), falling back
 * to the default list.
 */
async function priceLines(patient, lines, payerListId = null) {
  const [lists, services] = await Promise.all([
    PriceList.find({ isActive: true }).lean(),
    Service.find({ _id: { $in: lines.map((l) => l.serviceId).filter(Boolean) } }).lean(),
  ]);
  const defaultList = lists.find((l) => l.isDefault) ?? lists.find((l) => l.kind === 'GENERAL');
  const kind = CATEGORY_LIST_KIND[patient.category] ?? 'GENERAL';
  const priceList =
    (payerListId && lists.find((l) => String(l._id) === String(payerListId))) ??
    lists.find((l) => l.kind === kind && l.isActive) ??
    defaultList;
  const taxes = new Map(
    (await TaxCode.find({ _id: { $in: services.map((s) => s.taxCodeId) } }).lean()).map((t) => [
      String(t._id),
      t,
    ]),
  );
  const out = [];
  const details = [];
  lines.forEach((l, i) => {
    // Item lines come priced from the pharmacy (batch MRP, GST inside); the API never accepts
    // them from a client (the bill routes take service lines only).
    if (l.item) {
      out.push({
        ...taxLine({
          item: l.item,
          code: l.code,
          name: l.name,
          category: 'PHARMACY',
          qty: l.qty,
          unitPrice: l.unitPrice,
          gross: l.unitPrice * l.qty,
          discount: 0,
          taxRate: l.taxRate ?? 0,
          hsnSac: l.hsnSac,
          taxInclusive: true,
        }),
        source: l.source ?? { type: 'PHARMACY' },
        addedBy: current().userId,
        addedAt: new Date(),
      });
      return;
    }
    const service = services.find((s) => String(s._id) === String(l.serviceId));
    if (!service || service.status !== 'ACTIVE')
      return details.push({
        path: `lines.${i}.serviceId`,
        message: 'Service not found or not approved',
      });
    const r = priceLine({
      service,
      qty: l.qty,
      priceList,
      defaultList,
      taxCode: taxes.get(String(service.taxCodeId)),
    });
    if (r.error) return details.push({ path: `lines.${i}.serviceId`, message: r.error });
    // Part of a day (IPD transfer day, rule R6): the daily tariff for the hours in that bed. Only
    // internal callers set `hours`; the bill routes accept service and quantity only.
    if (l.hours != null) {
      const unitPrice = Math.round((r.line.unitPrice * l.hours) / 24);
      Object.assign(r.line, {
        name: `${r.line.name} (${l.hours} h)`,
        qty: 1,
        unitPrice,
        gross: unitPrice,
      });
    }
    out.push({
      ...taxLine(r.line),
      source: { type: 'COUNTER' },
      addedBy: current().userId,
      addedAt: new Date(),
    });
  });
  if (details.length) throw errors.validation(details);
  return { lines: out, priceList };
}

const findBill = async (id) => {
  const b = await Bill.findOne({
    _id: id,
    ...scopeFilter({ own: 'createdBy', branch: 'branchId' }),
  });
  if (!b) throw errors.notFound('Bill');
  return b;
};

/** A corporate or scheme payer that may be billed on credit now. */
async function creditPayer(payerId) {
  const p = await Payer.findById(payerId).lean();
  if (!p || !p.isActive || !['CORPORATE', 'GOVT_SCHEME'].includes(p.kind))
    throw errors.validation([{ path: 'payerId', message: 'Pick a corporate or government payer' }]);
  if (p.creditHold?.on)
    throw new AppError(
      409,
      'PAYER_ON_HOLD',
      `${p.name} is on hold: ${p.creditHold.reason ?? 'payment overdue'}`,
    );
  return p;
}

/** Credit already used by a payer: what its final bills still owe. */
export async function creditUsed(payerId) {
  const [r] = await Bill.aggregate([
    { $match: { 'payer.payerId': payerId, status: { $in: ['FINAL', 'PARTLY_PAID'] } } },
    { $group: { _id: null, owed: { $sum: '$totals.balance' } } },
  ]);
  return r?.owed ?? 0;
}

export async function createBill({ patientId, type, lines, doctorUserId, notes, payerId }) {
  const c = current();
  if (!c.branchId) throw errors.validation([{ path: 'branch', message: 'Choose a branch first' }]);
  const patient = await loadPatient(patientId);
  const payer = payerId ? await creditPayer(payerId) : null;
  const priced = await priceLines(patient, lines, payer?.priceListId);
  const [bill] = await Bill.create([
    {
      type,
      patient: patientSnapshot(patient),
      branchId: c.branchId,
      doctorUserId,
      notes,
      payer: {
        kind: payer ? (payer.kind === 'GOVT_SCHEME' ? 'SCHEME' : 'CORPORATE') : 'CASH',
        payerId: payer?._id,
        name: payer?.name,
        priceListId: priced.priceList?._id,
        priceListCode: priced.priceList?.code,
      },
      lines: priced.lines,
      totals: billTotals(priced.lines),
    },
  ]);
  return billDto(bill);
}

export async function replaceLines(id, { version, lines }) {
  const bill = await findBill(id);
  if (bill.version !== version) throw errors.versionConflict();
  if (bill.status !== 'DRAFT')
    throw new AppError(
      409,
      'BILL_FINAL',
      'A final bill cannot change; cancel it with a reason instead',
    );
  const priced = await priceLines(
    await loadPatient(bill.patient.id),
    lines,
    bill.payer?.payerId ? bill.payer.priceListId : null,
  );
  bill.lines = priced.lines;
  bill.totals = billTotals(priced.lines);
  await bill.save();
  return billDto(bill);
}

/** Draft → Final: the number is taken inside the transaction, so the series never has gaps (rule R4). */
export async function finalizeBill(id, { version }) {
  const shift = await requireOpenShift();
  return withTransaction(async () => {
    const bill = await findBill(id);
    if (bill.version !== version) throw errors.versionConflict();
    if (bill.status !== 'DRAFT')
      throw new AppError(409, 'INVALID_STATE', 'Only a draft can be finalised');
    if (bill.payer?.payerId) {
      // A credit bill stays inside the payer's credit limit (0 = no limit).
      const payer = await creditPayer(bill.payer.payerId);
      const used = await creditUsed(payer._id);
      if (payer.creditLimit > 0 && used + bill.totals.total > payer.creditLimit)
        throw new AppError(
          409,
          'CREDIT_LIMIT',
          `${payer.name} would go over its credit limit: ${(used + bill.totals.total) / 100} of ${payer.creditLimit / 100} rupees`,
        );
    }
    bill.billNo = await numbering.next(BILL_TYPES[bill.type].series);
    bill.set({
      status: 'FINAL',
      finalizedAt: new Date(),
      finalizedBy: current().userId,
      shiftId: shift._id,
    });
    await bill.save();
    await publish('billing.billFinalized', {
      billId: String(bill._id),
      billNo: bill.billNo,
      patientId: String(bill.patient.id),
      total: bill.totals.total,
      tax: bill.totals.tax,
      branchId: String(bill.branchId),
    });
    return billDto(bill);
  });
}

export async function getBill(id) {
  return billDto(await findBill(id));
}

export async function listBills({ patientId, status, from, to, q, ...page }) {
  const filter = { ...scopeFilter({ own: 'createdBy', branch: 'branchId' }) };
  if (patientId) filter['patient.id'] = patientId;
  if (status) filter.status = status;
  if (from || to)
    filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (q) filter.$or = [{ billNo: q.toUpperCase() }, { 'patient.uhid': q.toUpperCase() }];
  return paginate(Bill, filter, page, { allowedSort: ['createdAt', 'finalizedAt'], map: billDto });
}

// ---------------------------------------------------------------- discount (rule R5)

/** Cashiers cannot give discounts: the request holds the bill until it is decided. */
export async function requestDiscount(id, { version, kind, value, reason }) {
  return withTransaction(async () => {
    const bill = await findBill(id);
    if (bill.version !== version) throw errors.versionConflict();
    if (bill.status !== 'FINAL' || bill.totals.paid > 0)
      throw new AppError(
        409,
        'INVALID_STATE',
        'A discount can be asked on a final bill before any payment',
      );
    if (bill.hold)
      throw new AppError(409, 'BILL_ON_HOLD', 'This bill is waiting for another approval');
    const amount = discountAmount({ kind, value }, bill.totals.gross);
    if (amount <= 0 || amount > bill.totals.gross)
      throw errors.validation([
        {
          path: 'value',
          message: 'The discount must be more than zero and at most the bill value',
        },
      ]);
    const percent = Math.round((amount * 10000) / bill.totals.gross) / 100;
    const preview = applyDiscount(
      bill.lines.map((l) => l.toObject()),
      amount,
    );
    bill.discount = { kind, value, amount, reason, status: 'PENDING' };
    bill.hold = 'DISCOUNT';
    const approval = await requestApproval({
      action: 'billing.discount',
      module: 'CORE',
      entity: 'Bill',
      entityId: bill._id,
      title: `${percent}% discount on ${bill.billNo} (${bill.patient.name})`,
      before: { total: bill.totals.total },
      after: { discount: amount, total: preview.totals.total },
      payload: { amount },
      metrics: { amount, percent },
      reason,
    });
    if (approval) bill.discount.approvalId = approval._id;
    else applyApprovedDiscount(bill);
    await bill.save();
    return { bill: billDto(bill), approvalId: approval ? String(approval._id) : null };
  });
}

function applyApprovedDiscount(bill) {
  const { lines, totals } = applyDiscount(
    bill.lines.map((l) => l.toObject()),
    bill.discount.amount,
    bill.totals.paid,
    bill.totals.refunded,
  );
  bill.lines = lines;
  bill.totals = totals;
  bill.discount.status = 'APPLIED';
  bill.hold = undefined;
}

onApprovalDecided('billing.discount', async (req, outcome) => {
  const bill = await Bill.findById(req.entityId);
  if (!bill || bill.hold !== 'DISCOUNT') return;
  if (outcome === 'APPROVED') applyApprovedDiscount(bill);
  else {
    bill.discount.status = 'REJECTED';
    bill.hold = undefined;
  }
  await bill.save();
  await publish('billing.discountDecided', {
    billId: String(bill._id),
    billNo: bill.billNo,
    outcome,
    amount: bill.discount.amount,
  });
});

// ---------------------------------------------------------------- cancellation (rules R4, R6)

/** Cancels a final bill: needs approval; afterwards a credit note and refunds to the original modes. */
export async function requestCancellation(id, { version, reason }) {
  return withTransaction(async () => {
    const bill = await findBill(id);
    if (bill.version !== version) throw errors.versionConflict();
    if (!['FINAL', 'PARTLY_PAID', 'PAID'].includes(bill.status))
      throw new AppError(409, 'INVALID_STATE', 'Only a final bill can be cancelled');
    if (bill.hold)
      throw new AppError(409, 'BILL_ON_HOLD', 'This bill is waiting for another approval');
    bill.hold = 'CANCELLATION';
    bill.cancellation = { reason };
    const approval = await requestApproval({
      action: 'billing.refund',
      module: 'CORE',
      entity: 'Bill',
      entityId: bill._id,
      title: `Cancel ${bill.billNo} (${bill.patient.name})${bill.totals.paid ? `, refund ₹${(bill.totals.paid / 100).toFixed(2)}` : ''}`,
      before: { status: bill.status, total: bill.totals.total, paid: bill.totals.paid },
      after: { status: 'CANCELLED', refund: bill.totals.paid },
      payload: { op: 'CANCEL_BILL' },
      metrics: { amount: bill.totals.paid || bill.totals.total },
      reason,
    });
    if (approval) bill.cancellation.approvalId = approval._id;
    else await applyCancellation(bill, null);
    await bill.save();
    return { bill: billDto(bill), approvalId: approval ? String(approval._id) : null };
  });
}

async function applyCancellation(bill, approvalId) {
  const creditNoteNo = await numbering.next('CREDIT_NOTE');
  await CreditNote.create([
    {
      creditNoteNo,
      billId: bill._id,
      billNo: bill.billNo,
      patient: bill.patient,
      amount: bill.totals.total,
      tax: bill.totals.tax,
      reason: bill.cancellation.reason,
      approvalId,
    },
  ]);
  // Money goes back the way it came: advance-adjusted amounts return to the deposit, the rest
  // becomes refunds per original mode that a cashier pays out.
  const payments = await Payment.find({ 'allocations.billId': bill._id, status: 'CAPTURED' });
  const modes = [];
  for (const p of payments) {
    const amount = p.allocations
      .filter((a) => String(a.billId) === String(bill._id))
      .reduce((s, a) => s + a.amount, 0);
    if (p.modeKind === 'ADVANCE')
      await Deposit.updateOne(
        { _id: p.depositId },
        { $inc: { used: -amount }, $set: { status: 'OPEN' } },
      );
    else modes.push({ mode: p.mode, modeKind: p.modeKind, amount, reference: p.reference });
  }
  const refundTotal = modes.reduce((s, m) => s + m.amount, 0);
  if (refundTotal) {
    const refundNo = await numbering.next('REFUND');
    await Refund.create([
      {
        refundNo,
        patientId: bill.patient.id,
        billId: bill._id,
        branchId: bill.branchId,
        amount: refundTotal,
        modes,
        reason: bill.cancellation.reason,
      },
    ]);
  }
  bill.set({
    status: 'CANCELLED',
    hold: undefined,
    'cancellation.creditNoteNo': creditNoteNo,
    'cancellation.at': new Date(),
  });
  await publish('billing.billCancelled', {
    billId: String(bill._id),
    billNo: bill.billNo,
    creditNoteNo,
    amount: bill.totals.total,
    refund: refundTotal,
  });
}

onApprovalDecided('billing.refund', async (req, outcome) => {
  if (req.payload.op !== 'CANCEL_BILL') return;
  const bill = await Bill.findById(req.entityId);
  if (!bill || bill.hold !== 'CANCELLATION') return;
  if (outcome === 'APPROVED') await applyCancellation(bill, req._id);
  else bill.set({ hold: undefined, cancellation: undefined });
  await bill.save();
});
