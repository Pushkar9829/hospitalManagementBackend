import { Schema } from 'mongoose';
import { DEPARTMENT_STATUS, DEPARTMENT_TYPES } from '@hms/shared/schemas';
import { defineModel } from '../../../core/db/model.js';

/** Departments are never deleted, only made inactive (spec 5.2). */
const schema = new Schema({
  code: { type: String, required: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: Object.keys(DEPARTMENT_TYPES), required: true },
  parentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  hodUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  location: {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    building: String,
    floor: String,
    rooms: String,
  },
  services: { opd: Boolean, ipd: Boolean, procedures: Boolean, diagnostics: Boolean },
  costCentre: String,
  opdTimings: [{ _id: false, day: Number, from: String, to: String }],
  status: { type: String, enum: Object.keys(DEPARTMENT_STATUS), default: 'DRAFT' },
  approvalId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
});
schema.index({ tenantId: 1, code: 1 }, { unique: true });
schema.index({ tenantId: 1, status: 1, name: 1 });

export const Department = defineModel('Department', schema);
