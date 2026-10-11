import { Schema } from 'mongoose';
import { defineModel } from '../db/model.js';

const levelSchema = new Schema(
  {
    label: { type: String, required: true },
    permission: { type: String, required: true },
    when: { amountOver: Number, percentOver: Number },
  },
  { _id: false },
);

/** Per-hospital copy of a maker-checker rule (seeded from DEFAULT_APPROVAL_RULES). */
const ruleSchema = new Schema({
  action: { type: String, required: true },
  label: { type: String, required: true },
  levels: { type: [levelSchema], validate: (v) => v.length >= 1 && v.length <= 3 },
  expiryHours: { type: Number, min: 1, max: 24 * 14, default: 48 },
  enabled: { type: Boolean, default: true },
});
ruleSchema.index({ tenantId: 1, action: 1 }, { unique: true });
export const ApprovalRule = defineModel('ApprovalRule', ruleSchema);

const decisionSchema = new Schema(
  {
    level: Number,
    decision: { type: String, enum: ['APPROVE', 'REJECT'] },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    comment: String,
    at: Date,
  },
  { _id: false },
);

/**
 * Maker-checker request (spec 4.5). The real record does not change until the request is
 * APPROVED; the owning module then applies it and marks it APPLIED.
 * Lifecycle: PENDING (levelIndex 0..n-1) -> APPROVED -> APPLIED, or REJECTED / EXPIRED / WITHDRAWN.
 */
const schema = new Schema({
  action: { type: String, required: true, match: /^[a-z]+\.[a-zA-Z.]+$/ },
  module: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: String, required: true },
  title: { type: String, required: true, maxlength: 200 },
  /** Shown side by side to the checker. */
  before: { type: Schema.Types.Mixed },
  after: { type: Schema.Types.Mixed },
  /** What the owning module needs to apply the change. */
  payload: { type: Schema.Types.Mixed, default: {} },
  metrics: { amount: Number, percent: Number },
  reason: { type: String, required: true, maxlength: 1000 },
  levels: { type: [levelSchema], required: true },
  levelIndex: { type: Number, default: 0 },
  decisions: { type: [decisionSchema], default: [] },
  makerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  makerName: String,
  branchId: { type: Schema.Types.ObjectId },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'APPLIED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'],
    default: 'PENDING',
  },
  /** Permission needed at the current level; kept in sync for inbox queries. */
  currentPermission: String,
  expiresAt: { type: Date, required: true },
  appliedAt: Date,
});
schema.index({ tenantId: 1, status: 1, currentPermission: 1, createdAt: -1 });
schema.index({ tenantId: 1, entity: 1, entityId: 1, status: 1 });
schema.index({ tenantId: 1, makerId: 1, createdAt: -1 });

export const ApprovalRequest = defineModel('ApprovalRequest', schema);
