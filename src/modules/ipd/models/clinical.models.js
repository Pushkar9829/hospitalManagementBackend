import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/**
 * A medicine order for an in-patient. ORDERED → VERIFIED (pharmacist, rule R11; STAT doses may
 * be given first) → STOPPED, or REJECTED by the pharmacist. High-alert medicines need a second
 * nurse at every dose (rule R12).
 */
const medOrderSchema = new Schema({
  admissionId: { type: id, ref: 'Admission', required: true },
  patientId: { type: id, ref: 'Patient', required: true },
  drug: { drugId: String, brand: { type: String, required: true }, generic: String },
  dose: { type: String, required: true },
  route: { type: String, required: true },
  frequency: { type: String, required: true }, // OD, BD, TDS, QID, Q6H, Q8H, HS, SOS, STAT
  times: [String], // HH:mm IST
  prn: { type: Boolean, default: false },
  stat: { type: Boolean, default: false },
  highAlert: { type: Boolean, default: false },
  instructions: String,
  startAt: { type: Date, required: true },
  endAt: Date,
  status: {
    type: String,
    enum: ['ORDERED', 'VERIFIED', 'STOPPED', 'REJECTED'],
    default: 'ORDERED',
  },
  orderedBy: String,
  verifiedBy: String,
  verifiedAt: Date,
  stoppedBy: String,
  stopReason: String,
});
medOrderSchema.index({ tenantId: 1, admissionId: 1, status: 1 });
export const MedOrder = defineModel('MedOrder', medOrderSchema);

/** One scheduled (or PRN/STAT) dose on the MAR. */
const doseSchema = new Schema({
  orderId: { type: id, ref: 'MedOrder', required: true },
  admissionId: { type: id, ref: 'Admission', required: true },
  dueAt: { type: Date, required: true },
  status: { type: String, enum: ['DUE', 'GIVEN', 'HELD', 'REFUSED', 'MISSED'], default: 'DUE' },
  givenAt: Date,
  givenBy: String,
  witness: String,
  reason: String,
  scan: { wristband: String, drug: String },
});
doseSchema.index({ tenantId: 1, admissionId: 1, dueAt: 1 });
doseSchema.index({ tenantId: 1, orderId: 1, dueAt: 1 }, { unique: true });
export const MarDose = defineModel('MarDose', doseSchema);

/** Observations with the NEWS2 early warning score (RCP 2017). */
const vitalsSchema = new Schema({
  admissionId: { type: id, ref: 'Admission', required: true },
  at: { type: Date, required: true },
  rr: Number,
  spo2: Number,
  onOxygen: Boolean,
  tempC: Number,
  sbp: Number,
  dbp: Number,
  hr: Number,
  consciousness: { type: String, enum: ['A', 'C', 'V', 'P', 'U'], default: 'A' },
  painScore: Number,
  sugar: Number,
  news2: Number,
  risk: { type: String, enum: ['LOW', 'LOW_MEDIUM', 'MEDIUM', 'HIGH'] },
  by: String,
});
vitalsSchema.index({ tenantId: 1, admissionId: 1, at: -1 });
export const IpdVitals = defineModel('IpdVitals', vitalsSchema);

const ioSchema = new Schema({
  admissionId: { type: id, ref: 'Admission', required: true },
  at: { type: Date, required: true },
  kind: { type: String, enum: ['INTAKE', 'OUTPUT'], required: true },
  route: { type: String, required: true }, // ORAL, IV, RT, URINE, DRAIN, VOMIT, STOOL
  ml: { type: Number, required: true, min: 0 },
  note: String,
  by: String,
});
ioSchema.index({ tenantId: 1, admissionId: 1, at: -1 });
export const IoEntry = defineModel('IoEntry', ioSchema);

/**
 * Clinical notes on the stay: the nurse's admission assessment (due in 2 h), the doctor's
 * initial assessment (due in 24 h; rule R10), progress notes on rounds, nursing notes and SBAR
 * handovers. Signed notes are not edited; addenda carry the change (rule R13).
 */
const noteSchema = new Schema({
  admissionId: { type: id, ref: 'Admission', required: true },
  kind: {
    type: String,
    enum: ['NURSING_ADMISSION', 'DOCTOR_INITIAL', 'PROGRESS', 'NURSING', 'HANDOVER'],
    required: true,
  },
  text: String,
  data: Schema.Types.Mixed, // assessment fields (falls, pressure, pain …) or SBAR parts
  by: String,
  byUserId: { type: id, ref: 'User' },
  at: { type: Date, required: true },
  addenda: [{ text: String, by: String, at: Date }],
});
noteSchema.index({ tenantId: 1, admissionId: 1, at: -1 });
noteSchema.index({ tenantId: 1, admissionId: 1, kind: 1 });
export const IpdNote = defineModel('IpdNote', noteSchema);
