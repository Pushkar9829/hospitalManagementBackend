import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/** Chart of accounts: groups by type; system accounts carry a key the auto-posting uses. */
const accountSchema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  type: {
    type: String,
    enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'],
    required: true,
  },
  group: String,
  key: String, // system account key, e.g. AR_PATIENT
  isActive: { type: Boolean, default: true },
});
accountSchema.index({ tenantId: 1, code: 1 }, { unique: true });
accountSchema.index(
  { tenantId: 1, key: 1 },
  { unique: true, partialFilterExpression: { key: { $type: 'string' } } },
);
export const Account = defineModel('Account', accountSchema);

/**
 * A journal (voucher). Lines balance (debits = credits). Auto-posted journals carry their source
 * event, so an event delivered twice posts once. A manual journal waits for approval.
 */
const journalSchema = new Schema({
  voucherNo: String,
  type: {
    type: String,
    enum: ['SALES', 'RECEIPT', 'PAYMENT', 'JOURNAL', 'CONTRA', 'PURCHASE', 'PAYROLL', 'REVERSAL'],
    required: true,
  },
  date: { type: String, required: true }, // YYYY-MM-DD (IST)
  narration: String,
  lines: [
    {
      _id: false,
      accountId: { type: id, ref: 'Account', required: true },
      code: String,
      name: String,
      debit: { type: Number, default: 0 },
      credit: { type: Number, default: 0 },
      costCentre: String,
    },
  ],
  total: Number,
  source: { kind: String, ref: String, eventId: String },
  status: {
    type: String,
    enum: ['POSTED', 'PENDING_APPROVAL', 'REJECTED', 'REVERSED'],
    default: 'POSTED',
  },
  reversalOf: { type: id, ref: 'Journal' },
  createdByName: String,
  approvalId: { type: id, ref: 'ApprovalRequest' },
});
journalSchema.index({ tenantId: 1, date: 1 });
journalSchema.index({ tenantId: 1, 'lines.accountId': 1, date: 1 });
journalSchema.index(
  { tenantId: 1, 'source.eventId': 1 },
  { unique: true, partialFilterExpression: { 'source.eventId': { $type: 'string' } } },
);
journalSchema.index({ tenantId: 1, 'source.kind': 1, 'source.ref': 1 });
export const Journal = defineModel('Journal', journalSchema);

const settingsSchema = new Schema({
  lockedThrough: String, // YYYY-MM: this month and earlier cannot change
  lockHistory: [
    { _id: false, month: String, action: String, by: String, at: Date, reason: String },
  ],
  /** The petty cash float and the expense above which a petty cash payment needs approval. */
  pettyCash: {
    float: { type: Number, default: 20_000_00 },
    approvalOver: { type: Number, default: 2_000_00 },
  },
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const FinanceSettings = defineModel('FinanceSettings', settingsSchema);
