import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/** A payment to a vendor against its goods receipts; TDS withheld goes to TDS payable. */
const vendorPaymentSchema = new Schema({
  paymentNo: String,
  vendorId: { type: id, ref: 'Vendor', required: true },
  vendorName: String,
  date: { type: String, required: true }, // YYYY-MM-DD (IST)
  amount: { type: Number, required: true }, // cleared from the payable, paise
  tds: { type: Number, default: 0 },
  mode: { type: String, enum: ['BANK_TRANSFER', 'CHEQUE', 'CASH'], required: true },
  reference: String,
  allocations: [{ _id: false, grnId: { type: id, ref: 'Grn' }, grnNo: String, amount: Number }],
  journalId: { type: id, ref: 'Journal' },
  by: String,
});
vendorPaymentSchema.index({ tenantId: 1, vendorId: 1, date: -1 });
vendorPaymentSchema.index({ tenantId: 1, 'allocations.grnId': 1 });
export const VendorPayment = defineModel('VendorPayment', vendorPaymentSchema);

/** Budget for one ledger in a financial year (April to March), month by month in paise. */
const budgetSchema = new Schema({
  fy: { type: String, required: true }, // 2026-27
  accountId: { type: id, ref: 'Account', required: true },
  months: { type: [Number], default: () => Array(12).fill(0) },
});
budgetSchema.index({ tenantId: 1, fy: 1, accountId: 1 }, { unique: true });
export const Budget = defineModel('Budget', budgetSchema);

/**
 * The petty cash book: top-ups from the bank and small expenses paid from the box. An expense
 * above the set limit waits for the finance.expenseClaim approval before it posts.
 */
const pettyCashSchema = new Schema({
  entryNo: String,
  kind: { type: String, enum: ['TOPUP', 'EXPENSE'], required: true },
  date: { type: String, required: true },
  amount: { type: Number, required: true },
  accountId: { type: id, ref: 'Account' }, // expense head
  accountName: String,
  payee: String,
  note: String,
  billRef: String,
  status: { type: String, enum: ['POSTED', 'PENDING_APPROVAL', 'REJECTED'], default: 'POSTED' },
  journalId: { type: id, ref: 'Journal' },
  approvalId: { type: id, ref: 'ApprovalRequest' },
  by: String,
});
pettyCashSchema.index({ tenantId: 1, date: -1 });
export const PettyCash = defineModel('PettyCash', pettyCashSchema);

/** A doctor's share of what their bills earn, by service category, and the TDS rate. */
const doctorShareSchema = new Schema({
  userId: { type: id, ref: 'User', required: true },
  name: String,
  shares: { type: Map, of: Number, default: () => ({}) }, // category -> percent
  tdsPercent: { type: Number, default: 10 },
  isActive: { type: Boolean, default: true },
});
doctorShareSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
export const DoctorShare = defineModel('DoctorShare', doctorShareSchema);

/** A month's payout to a doctor: drafted from the bills, then paid (posting the fee and TDS). */
const doctorPayoutSchema = new Schema({
  month: { type: String, required: true }, // YYYY-MM
  userId: { type: id, ref: 'User', required: true },
  name: String,
  bills: Number,
  lines: [{ _id: false, category: String, base: Number, percent: Number, amount: Number }],
  gross: Number,
  tds: Number,
  net: Number,
  status: { type: String, enum: ['DRAFT', 'PAID'], default: 'DRAFT' },
  paidAt: Date,
  mode: String,
  reference: String,
  journalId: { type: id, ref: 'Journal' },
});
doctorPayoutSchema.index({ tenantId: 1, month: 1, userId: 1 }, { unique: true });
export const DoctorPayout = defineModel('DoctorPayout', doctorPayoutSchema);
