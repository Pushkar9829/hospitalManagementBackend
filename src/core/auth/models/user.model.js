import { Schema } from 'mongoose';
import { USER_STATUS } from '@hms/shared';
import { defineModel } from '../../db/model.js';

const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  username: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9._-]{2,40}$/,
  },
  mobile: { type: String, match: /^[6-9]\d{9}$/ },
  email: { type: String, lowercase: true, trim: true },
  designation: String,
  passwordHash: { type: String, select: false },
  passwordChangedAt: Date,
  /** Hashes of the last 5 passwords (spec 4.4: not one of the last 5). */
  passwordHistory: { type: [String], select: false, default: [] },
  /** Set by an admin reset: every call except changing the password answers 403. */
  mustChangePassword: { type: Boolean, default: false },
  /** One-time invitation (72 h); only the hash is stored. */
  invite: { tokenHash: { type: String, select: false }, expiresAt: Date, sentAt: Date },
  departmentIds: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
  /** Roles requested but waiting for Super Admin approval. */
  pendingRoleCodes: { type: [String], default: undefined },
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
  roles: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
  branchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
  defaultBranchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  status: { type: String, enum: Object.keys(USER_STATUS), default: 'ACTIVE' },
  failedLogins: { type: Number, default: 0 },
  lockedUntil: Date,
  twoFactor: {
    enabled: { type: Boolean, default: false },
    secret: { type: String, select: false },
    pendingSecret: { type: String, select: false },
  },
  preferredLanguage: { type: String, default: 'en' },
  lastLoginAt: Date,
});
// Sign-in bookkeeping is logged as LOGIN / LOGIN_FAILED entries instead of field updates.
schema.set('auditIgnore', ['failedLogins', 'lockedUntil', 'lastLoginAt']);
schema.index({ tenantId: 1, username: 1 }, { unique: true });
schema.index(
  { tenantId: 1, mobile: 1 },
  { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } },
);

schema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    if (ret.twoFactor) ret.twoFactor = { enabled: ret.twoFactor.enabled };
    return ret;
  },
});

export const User = defineModel('User', schema);
