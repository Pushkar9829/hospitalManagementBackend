import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/**
 * A line of a bank statement, imported for reconciliation. `amount` is signed: a deposit is
 * positive (the bank account is debited in the books), a withdrawal negative. Matched to the one
 * journal that put it in the books, or ignored with a reason.
 */
const statementLineSchema = new Schema({
  accountId: { type: id, ref: 'Account', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  description: String,
  ref: String,
  amount: { type: Number, required: true },
  balance: Number, // running balance the bank printed, if given
  batch: String,
  status: { type: String, enum: ['UNMATCHED', 'MATCHED', 'IGNORED'], default: 'UNMATCHED' },
  journalId: { type: id, ref: 'Journal' },
  matchedBy: { type: String, enum: ['AUTO', 'MANUAL', 'CREATED'] },
  note: String,
});
statementLineSchema.index({ tenantId: 1, accountId: 1, date: 1 });
statementLineSchema.index(
  { tenantId: 1, accountId: 1, journalId: 1 },
  { unique: true, partialFilterExpression: { journalId: { $type: 'objectId' } } },
);
export const BankStatementLine = defineModel('BankStatementLine', statementLineSchema);

/**
 * Fixed asset register (Companies Act Schedule II, straight line; or written-down value).
 * Depreciation is charged monthly by the depreciation run; disposal posts the gain or loss.
 */
const fixedAssetSchema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  block: { type: String, required: true },
  equipmentId: { type: id, ref: 'Asset' }, // the biomedical / facility equipment, if any
  department: String,
  putToUseOn: { type: String, required: true }, // YYYY-MM-DD
  cost: { type: Number, required: true },
  salvagePct: { type: Number, default: 5 },
  method: { type: String, enum: ['SLM', 'WDV'], default: 'SLM' },
  usefulLifeYears: Number, // SLM
  wdvRate: Number, // WDV, % a year
  accumulated: { type: Number, default: 0 }, // depreciation charged so far (incl. opening)
  depreciatedThrough: String, // YYYY-MM
  fundedFrom: { type: String, enum: ['BANK', 'AP_VENDOR', 'EXISTING'] },
  journalId: { type: id, ref: 'Journal' },
  status: { type: String, enum: ['ACTIVE', 'DISPOSED'], default: 'ACTIVE' },
  disposal: { on: String, proceeds: Number, gain: Number, journalId: id, reason: String },
});
fixedAssetSchema.index({ tenantId: 1, code: 1 }, { unique: true });
fixedAssetSchema.index({ tenantId: 1, equipmentId: 1 });
export const FixedAsset = defineModel('FixedAsset', fixedAssetSchema);

/** One month's depreciation run: the journal and what each asset was charged. */
const depreciationRunSchema = new Schema({
  month: { type: String, required: true },
  journalId: { type: id, ref: 'Journal' },
  total: Number,
  lines: [{ _id: false, assetId: id, code: String, name: String, block: String, amount: Number }],
  byName: String,
});
depreciationRunSchema.index({ tenantId: 1, month: 1 }, { unique: true });
export const DepreciationRun = defineModel('DepreciationRun', depreciationRunSchema);
