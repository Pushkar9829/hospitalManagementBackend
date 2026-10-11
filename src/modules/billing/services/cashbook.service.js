import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { publish } from '../../../core/events/events.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { PaymentMode } from '../../setup/index.js';
import {
  BankDeposit,
  CashierShift,
  DayLock,
  DeviceSettlement,
  Payment,
} from '../models/billing.models.js';

/**
 * Day-end money (board "Shift and day-end"): card and UPI settlements matched against the
 * devices' receipts, bank deposit slips for cash and cheques, and the day lock once every shift
 * is verified. Money in paise.
 */
const DEVICE_KINDS = ['CARD', 'UPI', 'PAYMENT_LINK'];
const MDR_LIMIT_PERCENT = 3; // a card shortfall up to this is the bank's fee, not a gap
const who = () => current().userName ?? 'user';

function matchState(kind, receipts, settled) {
  if (settled == null) return 'PENDING';
  const gap = receipts - settled;
  if (gap === 0) return 'MATCHED';
  if (gap > 0 && kind === 'CARD' && gap * 100 <= receipts * MDR_LIMIT_PERCENT) return 'MATCHED_MDR';
  return gap > 0 ? 'SHORT' : 'OVER';
}

/** One row per device-like mode and counter that took money on the day, with its settlement. */
export async function settlements({ date }) {
  const branchId = current().branchId;
  const modes = await PaymentMode.find({ kind: { $in: DEVICE_KINDS } })
    .select('code name kind')
    .lean();
  const kindOf = new Map(modes.map((m) => [m.code, m.kind]));
  const nameOf = new Map(modes.map((m) => [m.code, m.name]));
  const payments = await Payment.find({
    branchId,
    istDate: date,
    status: 'CAPTURED',
    mode: { $in: modes.map((m) => m.code) },
  })
    .select('mode amount shiftId')
    .lean();
  const shifts = new Map(
    (
      await CashierShift.find({
        _id: { $in: [...new Set(payments.map((p) => String(p.shiftId)))] },
      })
        .select('counter')
        .lean()
    ).map((s) => [String(s._id), s.counter]),
  );
  const rows = new Map();
  for (const p of payments) {
    const counter = shifts.get(String(p.shiftId)) ?? '-';
    const key = `${p.mode}|${counter}`;
    const r = rows.get(key) ?? { mode: p.mode, counter, receipts: 0, count: 0 };
    r.receipts += p.amount;
    r.count += 1;
    rows.set(key, r);
  }
  const saved = await DeviceSettlement.find({ branchId, date }).lean();
  for (const s of saved) {
    const key = `${s.mode}|${s.counter}`;
    if (!rows.has(key)) rows.set(key, { mode: s.mode, counter: s.counter, receipts: 0, count: 0 });
  }
  const savedBy = new Map(saved.map((s) => [`${s.mode}|${s.counter}`, s]));
  return {
    date,
    mdrLimitPercent: MDR_LIMIT_PERCENT,
    items: [...rows.values()]
      .sort((a, b) => a.counter.localeCompare(b.counter) || a.mode.localeCompare(b.mode))
      .map((r) => {
        const s = savedBy.get(`${r.mode}|${r.counter}`);
        return {
          ...r,
          modeName: nameOf.get(r.mode) ?? r.mode,
          kind: kindOf.get(r.mode),
          settled: s?.settled ?? null,
          reference: s?.reference ?? null,
          note: s?.note ?? null,
          difference: s ? r.receipts - s.settled : null,
          state: matchState(kindOf.get(r.mode), r.receipts, s?.settled ?? null),
        };
      }),
  };
}

/** Records what the bank settled for one device and day (again to correct it). */
export async function recordSettlement({ date, mode, counter, settled, reference, note }) {
  const branchId = current().branchId;
  const day = await settlements({ date });
  const row = day.items.find((r) => r.mode === mode && r.counter === counter);
  if (!row)
    throw errors.validation([{ path: 'mode', message: 'No receipts by this device that day' }]);
  const fields = { receipts: row.receipts, settled, reference, note, matchedBy: who() };
  const existing = await DeviceSettlement.findOne({ branchId, date, mode, counter });
  if (existing) {
    existing.set(fields);
    await existing.save();
  } else await DeviceSettlement.create([{ branchId, date, mode, counter, ...fields }]);
  return settlements({ date });
}

// ---------------------------------------------------------------- bank deposits

const depositOut = (d) => ({
  id: String(d._id),
  slipNo: d.slipNo,
  date: d.date,
  bank: d.bank,
  cash: d.cash,
  cheques: d.cheques ?? [],
  chequeTotal: (d.cheques ?? []).reduce((t, c) => t + c.amount, 0),
  status: d.status,
  reference: d.reference,
  note: d.note,
  depositedBy: d.depositedBy,
  version: d.version ?? 0,
});

export async function listDeposits() {
  const rows = await BankDeposit.find({ branchId: current().branchId })
    .sort({ date: -1, createdAt: -1 })
    .limit(100)
    .lean();
  return { items: rows.map(depositOut) };
}

/** A deposit slip. Cash leaves the cash book for the bank (Dr bank, Cr cash). */
export async function createDeposit({ date, bank, cash = 0, cheques = [], reference }) {
  if (!cash && !cheques.length)
    throw errors.validation([{ path: 'cash', message: 'Enter the cash or at least one cheque' }]);
  const [d] = await BankDeposit.create([
    {
      slipNo: await documentNumber('DS'),
      branchId: current().branchId,
      date,
      bank,
      cash,
      cheques,
      reference,
      depositedBy: who(),
    },
  ]);
  if (cash > 0)
    await publish('billing.cashBanked', {
      depositId: String(d._id),
      slipNo: d.slipNo,
      amount: cash,
      bank,
    });
  return depositOut(d);
}

export async function updateDeposit(id, { version, status, reference, note }) {
  const d = await BankDeposit.findOne({ _id: id, branchId: current().branchId });
  if (!d) throw errors.notFound('Deposit slip');
  if (d.version !== version) throw errors.versionConflict();
  if (d.status !== 'DEPOSITED')
    throw new AppError(409, 'INVALID_STATE', 'This slip is already settled');
  if (status === 'CHEQUE_RETURNED' && !d.cheques.length)
    throw errors.validation([{ path: 'status', message: 'This slip has no cheque' }]);
  d.set({ status, reference: reference ?? d.reference, note });
  await d.save();
  return depositOut(d);
}

// ---------------------------------------------------------------- day lock

export async function dayState(date) {
  const branchId = current().branchId;
  const start = new Date(`${date}T00:00:00+05:30`);
  const end = new Date(`${date}T23:59:59.999+05:30`);
  const [lock, shifts] = await Promise.all([
    DayLock.findOne({ branchId, date }).lean(),
    CashierShift.find({ branchId, openedAt: { $gte: start, $lte: end } })
      .select('status')
      .lean(),
  ]);
  const count = (s) => shifts.filter((x) => x.status === s).length;
  return {
    date,
    locked: Boolean(lock),
    lockedAt: lock?.lockedAt ?? null,
    lockedBy: lock?.lockedBy ?? null,
    shifts: { open: count('OPEN'), toVerify: count('COUNTED'), verified: count('VERIFIED') },
  };
}

export async function lockDay(date) {
  const state = await dayState(date);
  if (state.locked) throw new AppError(409, 'DAY_LOCKED', 'This day is already locked');
  if (state.shifts.open || state.shifts.toVerify)
    throw new AppError(
      409,
      'SHIFTS_PENDING',
      `Close and verify every shift first: ${state.shifts.open} open, ${state.shifts.toVerify} to verify`,
    );
  await DayLock.create([{ branchId: current().branchId, date, lockedBy: who() }]);
  return dayState(date);
}
