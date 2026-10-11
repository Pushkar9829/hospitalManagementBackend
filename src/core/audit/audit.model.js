import mongoose, { Schema } from 'mongoose';
import { tenantPlugin } from '../tenancy/tenant.plugin.js';

export const AUDIT_ACTIONS = Object.freeze([
  'CREATE',
  'UPDATE',
  'DELETE',
  'APPROVE',
  'REJECT',
  'PRINT',
  'EXPORT',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'ACCOUNT_LOCKED',
  'PASSWORD_CHANGED',
  'TWO_FACTOR_ENABLED',
  'SESSION_REUSE_DETECTED',
  'VIEW',
  'ACCESS_DENIED',
]);

/** Append-only. Created directly (not via defineModel) to avoid auditing the audit log. */
const schema = new Schema(
  {
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    entity: { type: String, required: true },
    entityId: { type: String },
    summary: String,
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    branchId: { type: Schema.Types.ObjectId },
    requestId: String,
    ip: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    at: { type: Date, default: Date.now, immutable: true },
  },
  { versionKey: false, minimize: true },
);
schema.plugin(tenantPlugin);
schema.index({ tenantId: 1, at: -1 });
schema.index({ tenantId: 1, entity: 1, entityId: 1, at: -1 });
schema.index({ tenantId: 1, userId: 1, at: -1 });
for (const op of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
]) {
  schema.pre(op, () => {
    throw new Error('The audit log is append-only');
  });
}

export const AuditLog = mongoose.models.AuditLog ?? mongoose.model('AuditLog', schema);
