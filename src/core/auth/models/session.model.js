import { Schema } from 'mongoose';
import { defineModel } from '../../db/model.js';

/**
 * One row per refresh token. Tokens rotate on every refresh; presenting a rotated token again
 * means it was stolen, so the whole family is revoked (refresh token reuse detection).
 */
const schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: String,
    replacedBy: { type: Schema.Types.ObjectId },
    rememberDevice: { type: Boolean, default: false },
    ip: String,
    userAgent: String,
  },
  { timestamps: true, versionKey: false },
);
schema.index({ tenantId: 1, tokenHash: 1 }, { unique: true });
schema.index({ tenantId: 1, userId: 1, revokedAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = defineModel('Session', schema, { base: false, audit: false });
