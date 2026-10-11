import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;
const patientSnap = {
  _id: false,
  id: { type: id, ref: 'Patient' },
  uhid: String,
  name: String,
  gender: String,
  age: String,
  mobile: String,
};
const code = { _id: false, code: String, name: String };

/**
 * The legal record of one in-patient stay (spec "Record completion"). Opened when the patient is
 * discharged with a checklist of mandatory items; missing items are deficiencies owned by the
 * consultant. DEFICIENT → CODING (all items present) → CLOSED (final ICD-10 codes by the coder).
 */
const recordSchema = new Schema({
  admissionId: { type: id, ref: 'Admission', required: true },
  ipNo: String,
  patient: patientSnap,
  consultant: { _id: false, id: { type: id, ref: 'Doctor' }, name: String, userId: id },
  ward: String,
  admittedAt: Date,
  dischargedAt: Date,
  outcome: String,
  mlc: { type: Boolean, default: false },
  status: { type: String, enum: ['DEFICIENT', 'CODING', 'CLOSED'], default: 'DEFICIENT' },
  checklist: [
    {
      _id: false,
      code: String,
      label: String,
      ok: Boolean,
      resolvedAt: Date,
      resolvedBy: String,
      note: String,
    },
  ],
  diagnoses: [{ ...code, primary: Boolean }],
  procedures: [code],
  codedBy: String,
  codedAt: Date,
  // Physical file (hospitals that still keep paper)
  file: {
    fileNo: String,
    rack: String,
    status: { type: String, enum: ['IN', 'OUT'], default: 'IN' },
    issuedTo: String,
    issuedAt: Date,
    dueOn: String,
    history: [{ _id: false, action: String, to: String, at: Date, by: String, dueOn: String }],
  },
  retainUntil: String, // YYYY-MM-DD
  /** A court case, claim or complaint: the record cannot be destroyed while held. */
  legalHold: { _id: false, on: Boolean, reason: String, by: String, at: Date },
  /** Physical file destroyed after its retention period (destruction batch). */
  destroyed: { _id: false, at: Date, batchNo: String },
});
recordSchema.index({ tenantId: 1, admissionId: 1 }, { unique: true });
recordSchema.index({ tenantId: 1, status: 1, dischargedAt: -1 });
recordSchema.index({ tenantId: 1, 'consultant.id': 1, status: 1 });
recordSchema.index({ tenantId: 1, 'patient.id': 1 });
export const MrdRecord = defineModel('MrdRecord', recordSchema);

/**
 * Request for a copy of the record (spec "Record release"): identity and authorisation checked
 * by the MRD officer, the Medical Superintendent approves, the copy fee is billed, the release
 * is logged and the certified copy carries a watermark number.
 */
const releaseSchema = new Schema({
  requestNo: String,
  recordId: { type: id, ref: 'MrdRecord', required: true },
  patient: patientSnap,
  ipNo: String,
  requester: {
    kind: {
      type: String,
      enum: ['PATIENT', 'FAMILY', 'INSURER', 'COURT', 'POLICE', 'OTHER'],
      required: true,
    },
    name: { type: String, required: true },
    relation: String,
    idProof: String, // document type and last four characters only
    authorisation: String, // consent letter, court order, police requisition no.
  },
  purpose: String,
  pages: { type: Number, default: 1 },
  fee: { type: Number, default: 0 }, // paise
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RELEASED'],
    default: 'PENDING_APPROVAL',
  },
  approvalId: { type: id, ref: 'ApprovalRequest' },
  billId: { type: id, ref: 'Bill' },
  copyNo: String,
  releasedAt: Date,
  releasedBy: String,
  requestedBy: String,
});
releaseSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const ReleaseRequest = defineModel('ReleaseRequest', releaseSchema);

/** Birth register: reported to the Civil Registration System within 21 days. */
const birthSchema = new Schema({
  regNo: String,
  mother: patientSnap,
  admissionId: { type: id, ref: 'Admission' },
  fatherName: String,
  bornAt: { type: Date, required: true },
  sex: { type: String, enum: ['M', 'F', 'O'], required: true },
  weightGrams: Number,
  deliveryType: {
    type: String,
    enum: ['NORMAL', 'ASSISTED', 'CAESAREAN'],
    required: true,
  },
  liveBirth: { type: Boolean, default: true },
  place: String,
  attendedBy: String,
  crsDueBy: Date,
  reportedAt: Date,
  crsRefNo: String,
  recordedBy: String,
});
birthSchema.index({ tenantId: 1, bornAt: -1 });
export const BirthRecord = defineModel('BirthRecord', birthSchema);

/** Death register with the MCCD (Form 4) and the mortuary handover. */
const deathSchema = new Schema({
  regNo: String,
  patient: patientSnap,
  admissionId: { type: id, ref: 'Admission' },
  diedAt: { type: Date, required: true },
  admittedAt: Date,
  cause: { immediate: String, antecedent: String, underlying: String, icd: String },
  mccdNo: String,
  certifiedBy: String,
  mlc: { type: Boolean, default: false },
  crsDueBy: Date,
  reportedAt: Date,
  crsRefNo: String,
  mortuary: {
    slot: String,
    receivedAt: Date,
    handedOverAt: Date,
    handedTo: String,
    relation: String,
    idProof: String,
    toPolice: Boolean,
  },
  recordedBy: String,
});
deathSchema.index({ tenantId: 1, diedAt: -1 });
deathSchema.index({ tenantId: 1, admissionId: 1 });
export const DeathRecord = defineModel('DeathRecord', deathSchema);

/** Medico-legal case register. */
const mlcSchema = new Schema({
  mlcNo: String,
  patient: patientSnap,
  admissionId: { type: id, ref: 'Admission' },
  at: { type: Date, required: true },
  nature: {
    type: String,
    enum: ['ROAD_ACCIDENT', 'ASSAULT', 'POISONING', 'BURNS', 'FALL', 'SEXUAL_OFFENCE', 'OTHER'],
    required: true,
  },
  broughtBy: String,
  policeStation: String,
  intimatedAt: Date,
  officer: { name: String, rank: String, badgeNo: String },
  injuries: String,
  certificateIssuedAt: Date,
  status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
  recordedBy: String,
});
mlcSchema.index({ tenantId: 1, at: -1 });
export const MlcCase = defineModel('MlcCase', mlcSchema);

const settingsSchema = new Schema({
  copyServiceCode: { type: String, default: 'MRD-COPY' },
  fileDueDays: { type: Number, default: 3 },
  retentionYears: { type: Number, default: 10 },
  mlcRetentionYears: { type: Number, default: 0 }, // 0 = keep permanently
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const MrdSettings = defineModel('MrdSettings', settingsSchema);

/**
 * A destruction batch: records past retention, approved by the Medical Superintendent and the
 * Super Admin, then destroyed with a witness and recorded with the certificate.
 */
const destructionSchema = new Schema({
  batchNo: String,
  items: [
    {
      _id: false,
      recordId: { type: Schema.Types.ObjectId, ref: 'MrdRecord' },
      ipNo: String,
      uhid: String,
      patient: String,
      fileNo: String,
      retainUntil: String,
    },
  ],
  method: { type: String, enum: ['SHREDDING', 'INCINERATION', 'PULPING'], required: true },
  reason: String,
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'DESTROYED'],
    default: 'PENDING_APPROVAL',
  },
  approvalId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
  requestedBy: String,
  destroyedAt: Date,
  witness: String,
  vendor: String,
  certificateNo: String,
  recordedBy: String,
});
destructionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const MrdDestruction = defineModel('MrdDestruction', destructionSchema);
