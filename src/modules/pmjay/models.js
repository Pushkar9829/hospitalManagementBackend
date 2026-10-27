import { Schema } from 'mongoose';
import { defineModel } from '../../core/db/model.js';

const id = Schema.Types.ObjectId;

/**
 * A Health Benefit Package (HBP) the hospital is empanelled for, at the State Health Agency's
 * rate. PM-JAY pays the package rate for the whole stay, not the itemised bill.
 */
const packageSchema = new Schema({
  code: { type: String, required: true, trim: true, uppercase: true }, // e.g. SG039A
  name: { type: String, required: true, trim: true },
  specialty: { type: String, required: true, trim: true }, // e.g. General Surgery
  rate: { type: Number, required: true, min: 0 }, // paise, state rate for this hospital
  stayDays: { type: Number, default: 0 },
  preauthRequired: { type: Boolean, default: true },
  reservedForPublic: { type: Boolean, default: false },
  /** Extra documents this package needs, on top of the scheme's standard list. */
  documents: {
    preauth: { type: [String], default: [] },
    claim: { type: [String], default: [] },
  },
  isActive: { type: Boolean, default: true },
});
packageSchema.index({ tenantId: 1, code: 1 }, { unique: true });
packageSchema.index({ tenantId: 1, specialty: 1, isActive: 1 });
export const HbpPackage = defineModel('HbpPackage', packageSchema);

/** The hospital's PM-JAY registration and claim channel (one per hospital). */
const settingsSchema = new Schema({
  hospitalType: { type: String, enum: ['PRIVATE', 'PUBLIC'], default: 'PRIVATE' },
  stateCode: String, // e.g. MH
  hospitalCode: String, // PM-JAY hospital ID from empanelment (HEM)
  hfrId: String, // ABDM Health Facility Registry ID
  payerId: { type: id, ref: 'Payer' }, // the GOVT_SCHEME payer that stands for PM-JAY
  channel: { type: String, enum: ['TMS', 'NHCX'], default: 'TMS' },
  nhcx: {
    mode: { type: String, enum: ['MOCK', 'SANDBOX', 'LIVE'], default: 'MOCK' },
    participantCode: String, // ours, ends in @hcx in production
    payerCode: String, // the SHA / PM-JAY participant code
  },
});
export const PmjaySettings = defineModel('PmjaySettings', settingsSchema);

export const CASE_STATUS = [
  'REGISTERED',
  'PREAUTH_SENT',
  'PREAUTH_QUERY',
  'PREAUTH_APPROVED',
  'PREAUTH_REJECTED',
  'DISCHARGED',
  'CLAIM_SUBMITTED',
  'CLAIM_QUERY',
  'CLAIM_APPROVED',
  'CLAIM_REJECTED',
  'PAID',
  'CANCELLED',
];

/**
 * One PM-JAY cashless stay: beneficiary verified → packages → pre-authorisation → treatment →
 * discharge → claim → payment. `dueAt`/`dueKind` carry the scheme's clock for the next step.
 */
const caseSchema = new Schema({
  admissionId: { type: id, ref: 'Admission', required: true },
  ipNo: String,
  patient: { id: { type: id, ref: 'Patient' }, name: String, uhid: String, mobile: String },
  beneficiary: {
    pmjayId: { type: String, required: true }, // Ayushman card / PM-JAY ID
    name: String,
    familyId: String,
    abha: String,
    verification: {
      method: { type: String, enum: ['AADHAAR_OTP', 'AADHAAR_BIOMETRIC', 'FALLBACK'] },
      ref: String, // BIS transaction / approval reference
      at: Date,
      by: String,
    },
  },
  packages: [
    {
      _id: false,
      packageId: { type: id, ref: 'HbpPackage' },
      code: String,
      name: String,
      specialty: String,
      rate: Number,
      preauthRequired: Boolean,
      documents: { preauth: [String], claim: [String] },
    },
  ],
  diagnosis: String,
  plannedTreatment: String,
  channel: { type: String, enum: ['TMS', 'NHCX'], default: 'TMS' },
  status: { type: String, enum: CASE_STATUS, default: 'REGISTERED' },
  dueAt: Date,
  dueKind: String,
  /** References typed in from TMS (entered there by the Ayushman Mitra). */
  tms: { registrationId: String, preauthNo: String, claimNo: String },
  /** NHCX exchange: one correlation id for the case, one api call id per request. */
  nhcx: {
    correlationId: String,
    calls: [{ _id: false, action: String, apiCallId: String, at: Date, status: String }],
  },
  amounts: {
    preauthRequested: { type: Number, default: 0 },
    preauthApproved: { type: Number, default: 0 },
    claimed: { type: Number, default: 0 },
    claimApproved: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
  },
  deductions: [{ _id: false, reason: String, amount: Number }],
  payment: { utr: String, at: Date },
  outcome: String, // discharge outcome
  dischargedAt: Date,
  documents: [
    {
      stage: { type: String, enum: ['PREAUTH', 'DISCHARGE', 'CLAIM'] },
      name: String,
      fileId: String,
      at: Date,
      by: String,
    },
  ],
  events: [{ _id: false, at: Date, kind: String, amount: Number, text: String, by: String }],
});
caseSchema.index({ tenantId: 1, admissionId: 1 });
caseSchema.index({ tenantId: 1, status: 1, dueAt: 1 });
caseSchema.index({ tenantId: 1, 'beneficiary.pmjayId': 1 });
caseSchema.index({ tenantId: 1, 'nhcx.correlationId': 1 });
export const PmjayCase = defineModel('PmjayCase', caseSchema);
