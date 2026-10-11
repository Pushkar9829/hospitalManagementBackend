import { Schema } from 'mongoose';
import { isGstin } from '@hms/shared';
import { defineModel } from '../db/model.js';

const schema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z0-9]{2,8}$/ },
  address: { line1: String, city: String, state: String, pin: String },
  gstin: {
    type: String,
    uppercase: true,
    validate: { validator: (v) => !v || isGstin(v), message: 'Invalid GSTIN' },
  },
  phone: String,
  email: String,
  entityId: { type: Schema.Types.ObjectId, ref: 'LegalEntity' },
  /** Opening and closing a branch needs Super Admin approval (spec 4.6). */
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'ACTIVE', 'CLOSING', 'INACTIVE', 'REJECTED'],
    default: 'ACTIVE',
  },
  isActive: { type: Boolean, default: true },
});
schema.index({ tenantId: 1, code: 1 }, { unique: true });

export const Branch = defineModel('Branch', schema);
