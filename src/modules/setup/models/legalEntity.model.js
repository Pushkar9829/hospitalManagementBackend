import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

/** A legal entity that issues bills (one hospital group can have several). */
const schema = new Schema({
  name: { type: String, required: true, trim: true },
  registrationNo: String,
  gstin: String,
  pan: String,
  address: { line1: String, line2: String, city: String, state: String, pin: String },
  signatory: String,
  logoFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile' },
  letterheadFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile' },
  isActive: { type: Boolean, default: true },
});
schema.index({ tenantId: 1, name: 1 }, { unique: true });

export const LegalEntity = defineModel('LegalEntity', schema);
