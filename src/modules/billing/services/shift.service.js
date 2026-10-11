import { DENOMINATIONS } from '@hms/shared/schemas';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { withTransaction } from '../../../core/db/model.js';
import { scopeFilter } from '../../../core/rbac/scope.js';
import { publish } from '../../../core/events/events.js';
import { CashierShift, DayLock, Deposit, Payment, Refund } from '../models/billing.models.js';
import { istDate } from './pricing.js';
import { billingSettings } from './settings.service.js';

export const shiftDto = (s) => ({
  id: String(s._id),
  userId: String(s.userId),
  userName: s.userName,
  counter: s.counter,
  branchId: String(s.branchId),
  openedAt: s.openedAt,
  openingCash: s.openingCash,
  status: s.status,
  closedAt: s.closedAt,
  expected: s.expected,
  counted: s.counted,
  cashVariance: s.cashVariance,
  varianceReason: s.varianceReason,
  verifiedAt: s.verifiedAt,
  verifyComment: s.verifyComment,
  version: s.version,
});

export async function myOpenShift() {
  const c = current();
  return CashierShift.findOne({ userId: c.userId, status: 'OPEN' });
}

/** Day-end: once the billing manager locks today, the branch takes no more bills or receipts. */
async function refuseLockedDay(branchId) {
  if (await DayLock.exists({ branchId, date: istDate() }))
    throw new AppError(
      409,
      'DAY_LOCKED',
      'Today is locked at day-end; bills and receipts go on tomorrow',
    );
}

/** Rule R10: a cashier cannot take money without an open shift at a counter in this branch. */
export async function requireOpenShift() {
  await refuseLockedDay(current().branchId);
  const shift = await myOpenShift();
  if (!shift)
    throw new AppError(409, 'SHIFT_REQUIRED', 'Open your counter shift before taking payments');
  if (String(shift.branchId) !== String(current().branchId))
    throw new AppError(409, 'SHIFT_OTHER_BRANCH', 'Your open shift is in another branch');
  return shift;
}

export async function openShift({ counter, openingCash }) {
  const c = current();
  if (!c.branchId) throw errors.validation([{ path: 'branch', message: 'Choose a branch first' }]);
  await refuseLockedDay(c.branchId);
  try {
    const [shift] = await CashierShift.create([
      {
        userId: c.userId,
        userName: c.userName,
        branchId: c.branchId,
        counter,
        openingCash,
        openedAt: new Date(),
      },
    ]);
    return shiftDto(shift);
  } catch (err) {
    if (err?.code !== 11000) throw err;
    if (await CashierShift.exists({ userId: c.userId, status: 'OPEN' }))
      throw new AppError(409, 'SHIFT_ALREADY_OPEN', 'You already have an open shift');
    throw new AppError(
      409,
      'COUNTER_IN_USE',
      `Counter ${counter} already has an open shift; each cashier has their own counter and drawer`,
    );
  }
}

/** What the drawer and devices should hold: opening cash plus receipts and deposits, minus refunds, by mode. */
export async function expectedTotals(shift) {
  const [pays, deps, refs] = await Promise.all([
    Payment.aggregate([
      { $match: { shiftId: shift._id, status: 'CAPTURED', modeKind: { $ne: 'ADVANCE' } } },
      { $group: { _id: '$modeKind', amount: { $sum: '$amount' } } },
    ]),
    Deposit.aggregate([
      { $match: { shiftId: shift._id } },
      { $group: { _id: '$modeKind', amount: { $sum: '$amount' } } },
    ]),
    Refund.aggregate([
      { $match: { shiftId: shift._id, status: 'PAID' } },
      { $unwind: '$modes' },
      { $group: { _id: '$modes.modeKind', amount: { $sum: '$modes.amount' } } },
    ]),
  ]);
  const byMode = { CASH: shift.openingCash };
  for (const r of pays) byMode[r._id] = (byMode[r._id] ?? 0) + r.amount;
  for (const r of deps) byMode[r._id] = (byMode[r._id] ?? 0) + r.amount;
  for (const r of refs) byMode[r._id] = (byMode[r._id] ?? 0) - r.amount;
  return byMode;
}

/**
 * Rule R11: cash counted note by note; card and UPI totals matched with the devices. A variance
 * above ₹100 needs a reason and Billing Manager verification; otherwise the shift verifies itself.
 */
export async function closeShift(id, { version, notes, nonCash, varianceReason }) {
  const c = current();
  return withTransaction(async () => {
    const shift = await CashierShift.findById(id);
    if (!shift || String(shift.userId) !== String(c.userId)) throw errors.notFound('Shift');
    if (shift.version !== version) throw errors.versionConflict();
    if (shift.status !== 'OPEN')
      throw new AppError(409, 'INVALID_STATE', 'This shift is already closed');
    const expected = await expectedTotals(shift);
    const cash = DENOMINATIONS.reduce((s, d) => s + d * 100 * (notes[String(d)] ?? 0), 0);
    const variances = { CASH: cash - (expected.CASH ?? 0) };
    for (const [mode, amount] of Object.entries(expected))
      if (mode !== 'CASH') variances[mode] = (nonCash[mode] ?? 0) - amount;
    for (const [mode, amount] of Object.entries(nonCash))
      if (!(mode in variances)) variances[mode] = amount;
    const limit = (await billingSettings()).shiftVarianceLimit;
    const big = Object.entries(variances).filter(([, v]) => Math.abs(v) > limit);
    if (big.length && !varianceReason?.trim()) {
      throw errors.validation([
        {
          path: 'varianceReason',
          message: `Explain the difference: ${big.map(([m, v]) => `${m} ${(v / 100).toFixed(2)}`).join(', ')}`,
        },
      ]);
    }
    shift.set({
      expected,
      counted: { notes, cash, nonCash },
      cashVariance: variances.CASH,
      varianceReason: varianceReason?.trim() || undefined,
      closedAt: new Date(),
      status: big.length ? 'COUNTED' : 'VERIFIED',
      ...(big.length ? {} : { verifiedAt: new Date(), verifyComment: 'Within tolerance' }),
    });
    shift.markModified('expected');
    shift.markModified('counted');
    await shift.save();
    if (big.length)
      await publish('billing.shiftVariance', {
        shiftId: String(shift._id),
        cashier: shift.userName,
        variances: Object.fromEntries(big),
        reason: shift.varianceReason,
      });
    return shiftDto(shift);
  });
}

/** Billing Manager verifies a shift with a variance; never their own (maker-checker). */
export async function verifyShift(id, { version, comment }) {
  const c = current();
  const shift = await CashierShift.findOne({ _id: id, ...scopeFilter({ branch: 'branchId' }) });
  if (!shift) throw errors.notFound('Shift');
  if (shift.version !== version) throw errors.versionConflict();
  if (shift.status !== 'COUNTED')
    throw new AppError(
      409,
      'INVALID_STATE',
      'Only a counted shift with a variance waits for verification',
    );
  if (String(shift.userId) === String(c.userId))
    throw new AppError(403, 'MAKER_CANNOT_CHECK', 'You cannot verify your own shift');
  shift.set({
    status: 'VERIFIED',
    verifiedBy: c.userId,
    verifiedAt: new Date(),
    verifyComment: comment,
  });
  await shift.save();
  return shiftDto(shift);
}
