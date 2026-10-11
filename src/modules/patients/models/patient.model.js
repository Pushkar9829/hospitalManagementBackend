import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const contact = { _id: false, name: String, relation: String, mobile: String };

/**
 * One permanent UHID per patient across all branches (spec 5.4). Aadhaar numbers are never
 * stored in full: only the last four digits and a salted hash for duplicate checks.
 */
const schema = new Schema({
  uhid: { type: String, required: true, immutable: true },
  name: {
    title: String,
    first: { type: String, required: true },
    middle: String,
    last: String,
    regional: String,
  },
  gender: { type: String, enum: ['M', 'F', 'O', 'U'], required: true },
  dob: { type: Date, required: true },
  dobEstimated: { type: Boolean, default: false },
  bloodGroup: String,
  maritalStatus: String,
  mobile: { type: String, required: true },
  altMobile: String,
  email: String,
  address: {
    line1: String,
    line2: String,
    city: String,
    district: String,
    state: String,
    pin: String,
  },
  relation: { type: { type: String }, name: String },
  guardian: contact,
  emergencyContact: contact,
  ids: [
    {
      _id: false,
      type: { type: String },
      number: String,
      last4: String,
      fileId: { type: Schema.Types.ObjectId, ref: 'StoredFile' },
    },
  ],
  idHashes: { type: [String], default: [] },
  abha: { number: String, address: String, verified: { type: Boolean, default: false } },
  allergies: [
    {
      _id: false,
      substance: String,
      reaction: String,
      severity: String,
      recordedAt: Date,
      recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
  ],
  noKnownAllergies: { type: Boolean, default: false },
  chronicConditions: { type: [String], default: [] },
  flags: { vip: { type: Boolean, default: false }, mlc: { type: Boolean, default: false } },
  category: { type: String, default: 'GENERAL' },
  referral: {
    sourceId: { type: Schema.Types.ObjectId, ref: 'ReferralSource' },
    doctorName: String,
  },
  photoFileId: { type: Schema.Types.ObjectId, ref: 'StoredFile' },
  preferredLanguage: { type: String, default: 'en' },
  registrationType: { type: String, enum: ['QUICK', 'FULL'], required: true },
  registeredBranchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  status: { type: String, enum: ['ACTIVE', 'MERGED'], default: 'ACTIVE' },
  mergedInto: { type: Schema.Types.ObjectId, ref: 'Patient' },
  /** Lower-case name words for prefix search ("rav kum" finds Ravi Kumar). */
  nameTokens: { type: [String], default: [] },
});
schema.index({ tenantId: 1, uhid: 1 }, { unique: true });
schema.index({ tenantId: 1, mobile: 1 });
schema.index({ tenantId: 1, idHashes: 1 });
schema.index({ tenantId: 1, nameTokens: 1, status: 1 });
schema.index({ tenantId: 1, 'abha.number': 1 }, { sparse: true });

export const Patient = defineModel('Patient', schema);
