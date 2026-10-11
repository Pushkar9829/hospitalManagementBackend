import { CASH_LIMIT_PAISE } from '@hms/shared/schemas';
import { formatINR } from '@hms/shared';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { recordAudit } from '../../../core/audit/audit.service.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { paginate } from '../../../core/http/paginate.js';
import { numbering, PaymentMode } from '../../setup/index.js';
import { Patient } from '../../patients/index.js';
import { Bill, CashLock, Deposit, Payment, Refund } from '../models/billing.models.js';
import { billTotals, istDate } from './pricing.js';
import { patientSnapshot } from './bills.service.js';
import { requireOpenShift } from './shift.service.js';

export const paymentDto = (p) => ({
  id: String(p._id),
  receiptNo: p.receiptNo,
  patient: { ...p.patient, id: String(p.patient.id) },
  mode: p.mode,
  modeKind: p.modeKind,
  amount: p.amount,
  reference: p.reference,
  allocations: p.allocations.map((a) => ({
    billId: String(a.billId),
    billNo: a.billNo,
    amount: a.amount,
  })),
  status: p.status,
  createdAt: p.createdAt,
  printCount: p.printCount,
  version: p.version,
});
export const depositDto = (d) => ({
  id: String(d._id),
  depositNo: d.depositNo,
  patient: { ...d.patient, id: String(d.patient.id) },
  mode: d.mode,
  modeKind: d.modeKind,
  reference: d.reference,
  purpose: d.purpose,
  amount: d.amount,
  used: d.used,
  refunded: d.refunded,
  balance: d.amount - d.used - d.refunded,
  status: d.status,
  createdAt: d.createdAt,
  version: d.version,
});
export const refundDto = (r) => ({
  id: String(r._id),
  refundNo: r.refundNo,
  patientId: String(r.patientId),
  billId: r.billId && String(r.billId),
  amount: r.amount,
  modes: r.modes,
  reason: r.reason,
  status: r.status,
  paidAt: r.paidAt,
  reference: r.reference,
  createdAt: r.createdAt,
  version: r.version,
});

async function modeOf(code) {
  const mode = await PaymentMode.findOne({ code, isActive: true }).lean();
  if (!mode)
    throw errors.validation([{ path: 'mode', message: `Payment mode ${code} is not active` }]);
  return mode;
}

/**
 * Section 269ST of the Income-tax Act (rule R7): no cash of ₹2,00,000 or more from one person in
 * a day. Counts receipts and deposits already taken today; the attempt is logged.
 */
async function checkCashLimit(patientId, amount, { audit = true } = {}) {
  const day = istDate();
  const [p, d] = await Promise.all([
    Payment.aggregate([
      { $match: { patientId, istDate: day, modeKind: 'CASH', status: 'CAPTURED' } },
      { $group: { _id: null, s: { $sum: '$amount' } } },
    ]),
    Deposit.aggregate([
      { $match: { patientId, istDate: day, modeKind: 'CASH' } },
      { $group: { _id: null, s: { $sum: '$amount' } } },
    ]),
  ]);
  const today = (p[0]?.s ?? 0) + (d[0]?.s ?? 0);
  if (today + amount >= CASH_LIMIT_PAISE) {
    if (audit)
      await recordAudit({
        action: 'ACCESS_DENIED',
        entity: 'Patient',
        entityId: patientId,
        summary: `Cash ${formatINR(amount)} refused: ${formatINR(today)} already received in cash today (section 269ST)`,
      });
    throw new AppError(
      422,
      'CASH_LIMIT',
      `Cash of ₹2,00,000 or more from one person in a day is not allowed (section 269ST). Already received today: ${formatINR(today)}. Take UPI, card or bank transfer.`,
    );
  }
}

/** Re-checks the cash limit inside the receipt's transaction, serialised per patient and day. */
async function lockCashDay(patientId, amount) {
  await CashLock.updateOne({ patientId, istDate: istDate() }, { $inc: { n: 1 } }, { upsert: true });
  await checkCashLimit(patientId, amount, { audit: false });
}

async function loadPatient(id) {
  const p = await Patient.findById(id).lean();
  if (!p) throw errors.validation([{ path: 'patientId', message: 'Patient not found' }]);
  return p;
}

let walletHandler = null;
/**
 * A payment by a WALLET mode (e.g. a membership card) is debited by the module that owns the
 * wallet (CRM), inside the receipt's transaction: `handler({ patientId, amount, reference })`
 * throws when the card is not valid for the patient or the balance is short.
 */
export function registerWalletHandler(handler) {
  walletHandler = handler;
}

/**
 * Takes one payment and allocates it to one or more bills. Payment links and app payments that
 * have not confirmed stay PENDING and do not count until confirmed, so nobody is charged twice
 * (rule R17).
 */
export async function receivePayment({
  patientId,
  mode: code,
  amount,
  reference,
  allocations,
  depositId,
}) {
  const shift = await requireOpenShift();
  const mode = await modeOf(code);
  if (mode.requiresReference && !reference)
    throw errors.validation([{ path: 'reference', message: `Enter the ${mode.name} reference` }]);
  const patient = await loadPatient(patientId);
  if (mode.kind === 'CASH') await checkCashLimit(patient._id, amount);
  const pending = mode.kind === 'PAYMENT_LINK';
  return withTransaction(async () => {
    if (mode.kind === 'CASH') await lockCashDay(patient._id, amount);
    const bills = await Bill.find({
      _id: { $in: allocations.map((a) => a.billId) },
      ...scopeFilter({ branch: 'branchId' }),
    });
    for (const a of allocations) {
      const bill = bills.find((b) => String(b._id) === String(a.billId));
      if (!bill) throw errors.validation([{ path: 'allocations', message: 'Bill not found' }]);
      if (!OPEN_FOR_PAYMENT.includes(bill.status))
        throw new AppError(
          409,
          'INVALID_STATE',
          `${bill.billNo ?? 'The draft'} is not open for payment`,
        );
      if (bill.hold)
        throw new AppError(
          409,
          'BILL_ON_HOLD',
          `${bill.billNo} is waiting for an approval; take payment after it is decided`,
        );
      if (a.amount > bill.totals.balance)
        throw errors.validation([
          {
            path: 'allocations',
            message: `${bill.billNo}: at most ${formatINR(bill.totals.balance)} is due`,
          },
        ]);
    }
    if (mode.kind === 'WALLET') {
      if (!walletHandler)
        throw new AppError(409, 'WALLET_UNAVAILABLE', 'Wallet payments are not set up.');
      await walletHandler({ patientId: String(patient._id), amount, reference });
    }
    let deposit;
    if (mode.kind === 'ADVANCE') {
      deposit = await Deposit.findOne({ _id: depositId, patientId: patient._id, status: 'OPEN' });
      if (!deposit)
        throw errors.validation([
          { path: 'depositId', message: 'Choose an open deposit of this patient' },
        ]);
      if (deposit.amount - deposit.used - deposit.refunded < amount)
        throw errors.validation([{ path: 'amount', message: 'More than the deposit balance' }]);
      deposit.used += amount;
      if (deposit.amount - deposit.used - deposit.refunded === 0) deposit.status = 'CLOSED';
      await deposit.save();
    }
    const receiptNo = await numbering.next('RECEIPT');
    const [payment] = await Payment.create([
      {
        receiptNo,
        patientId: patient._id,
        patient: patientSnapshot(patient),
        branchId: current().branchId,
        mode: mode.code,
        modeKind: mode.kind,
        amount,
        reference,
        allocations: allocations.map((a) => ({
          billId: a.billId,
          billNo: bills.find((b) => String(b._id) === String(a.billId)).billNo,
          amount: a.amount,
        })),
        depositId: deposit?._id,
        status: pending ? 'PENDING' : 'CAPTURED',
        shiftId: shift._id,
        collectedBy: current().userId,
        istDate: istDate(),
      },
    ]);
    if (!pending) await applyToBills(payment, bills);
    await publish(pending ? 'billing.paymentPending' : 'billing.paymentReceived', {
      paymentId: String(payment._id),
      receiptNo,
      amount,
      mode: mode.code,
      patientId: String(patient._id),
    });
    return paymentDto(payment);
  });
}

const OPEN_FOR_PAYMENT = ['FINAL', 'PARTLY_PAID'];

async function applyToBills(payment, bills) {
  for (const a of payment.allocations) {
    const bill =
      bills?.find((b) => String(b._id) === String(a.billId)) ?? (await Bill.findById(a.billId));
    // Never reopen a cancelled or settled bill (callers check first; this is the last guard).
    if (!OPEN_FOR_PAYMENT.includes(bill.status))
      throw new AppError(409, 'INVALID_STATE', `${bill.billNo} is not open for payment`);
    const paid = bill.totals.paid + a.amount;
    bill.totals = billTotals(bill.lines, { paid, refunded: bill.totals.refunded });
    bill.status = bill.totals.balance === 0 ? 'PAID' : 'PARTLY_PAID';
    await bill.save();
  }
}

/** Confirms or fails a pending payment (cashier now; the gateway webhook in production). */
export async function settlePending(id, { outcome, reference, version }) {
  return withTransaction(async () => {
    const payment = await Payment.findOne({ _id: id, ...scopeFilter({ branch: 'branchId' }) });
    if (!payment) throw errors.notFound('Payment');
    if (payment.version !== version) throw errors.versionConflict();
    if (payment.status !== 'PENDING')
      throw new AppError(409, 'INVALID_STATE', 'This payment is not pending');
    if (outcome === 'FAILED') {
      payment.status = 'FAILED';
      await payment.save();
      return paymentDto(payment);
    }
    const bills = await Bill.find({ _id: { $in: payment.allocations.map((a) => a.billId) } });
    for (const a of payment.allocations) {
      const bill = bills.find((b) => String(b._id) === String(a.billId));
      if (!OPEN_FOR_PAYMENT.includes(bill.status) || bill.hold)
        throw new AppError(
          409,
          'BILL_NOT_OPEN',
          `${bill.billNo} was ${bill.status === 'CANCELLED' ? 'cancelled' : 'changed'} meanwhile; mark this payment failed and refund it`,
        );
      if (a.amount > bill.totals.balance)
        throw new AppError(
          409,
          'ALREADY_PAID',
          `${bill.billNo} was paid another way meanwhile; refund this payment instead`,
        );
    }
    payment.set({ status: 'CAPTURED', ...(reference ? { reference } : {}) });
    await payment.save();
    await applyToBills(payment, bills);
    await publish('billing.paymentReceived', {
      paymentId: String(payment._id),
      receiptNo: payment.receiptNo,
      amount: payment.amount,
      mode: payment.mode,
      patientId: String(payment.patientId),
    });
    return paymentDto(payment);
  });
}

export async function takeDeposit({ patientId, mode: code, amount, reference, purpose }) {
  const shift = await requireOpenShift();
  const mode = await modeOf(code);
  if (mode.kind === 'ADVANCE' || mode.kind === 'PAYMENT_LINK')
    throw errors.validation([
      { path: 'mode', message: 'Take deposits by cash, card, UPI, cheque or bank transfer' },
    ]);
  if (mode.requiresReference && !reference)
    throw errors.validation([{ path: 'reference', message: `Enter the ${mode.name} reference` }]);
  const patient = await loadPatient(patientId);
  if (mode.kind === 'CASH') await checkCashLimit(patient._id, amount);
  return withTransaction(async () => {
    if (mode.kind === 'CASH') await lockCashDay(patient._id, amount);
    const depositNo = await numbering.next('DEPOSIT');
    const [d] = await Deposit.create([
      {
        depositNo,
        patientId: patient._id,
        patient: patientSnapshot(patient),
        branchId: current().branchId,
        mode: mode.code,
        modeKind: mode.kind,
        reference,
        purpose,
        amount,
        shiftId: shift._id,
        istDate: istDate(),
      },
    ]);
    await publish('billing.depositReceived', {
      depositId: String(d._id),
      depositNo,
      amount,
      mode: mode.code,
      patientId: String(patient._id),
    });
    return depositDto(d);
  });
}

/** Pays out an approved refund through its original modes from the cashier's open shift. */
export async function payRefund(id, { version, reference }) {
  const shift = await requireOpenShift();
  return withTransaction(async () => {
    const refund = await Refund.findOne({ _id: id, ...scopeFilter({ branch: 'branchId' }) });
    if (!refund) throw errors.notFound('Refund');
    if (refund.version !== version) throw errors.versionConflict();
    if (refund.status !== 'APPROVED')
      throw new AppError(409, 'INVALID_STATE', 'This refund is already paid');
    refund.set({
      status: 'PAID',
      paidAt: new Date(),
      paidBy: current().userId,
      shiftId: shift._id,
      reference,
    });
    await refund.save();
    if (refund.billId) {
      const bill = await Bill.findById(refund.billId);
      bill.totals = { ...bill.totals.toObject(), refunded: bill.totals.refunded + refund.amount };
      await bill.save();
    }
    await publish('billing.refundPaid', {
      refundId: String(refund._id),
      refundNo: refund.refundNo,
      amount: refund.amount,
      modes: refund.modes,
    });
    return refundDto(refund);
  });
}

export const listPayments = (query) => list(Payment, query, paymentDto, 'patientId');
export const listDeposits = (query) => list(Deposit, query, depositDto, 'patientId');
export const listRefunds = (query) => list(Refund, query, refundDto, 'patientId');

function list(Model, { patientId, status, shiftId, ...page }, map, patientField) {
  const filter = { ...scopeFilter({ branch: 'branchId' }) };
  if (patientId) filter[patientField] = patientId;
  if (status) filter.status = status;
  if (shiftId) filter.shiftId = shiftId;
  return paginate(Model, filter, page, { map });
}
