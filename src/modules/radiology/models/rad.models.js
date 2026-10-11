import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

export const MODALITIES = ['XRAY', 'USG', 'CT', 'MRI', 'MAMMO', 'ECHO'];

/** One per hospital: rooms per modality, working hours, PACS viewer link. */
const settingsSchema = new Schema({
  rooms: [
    {
      _id: false,
      code: String,
      name: String,
      modality: { type: String, enum: MODALITIES },
      slotMin: { type: Number, default: 15 },
    },
  ],
  dayStart: { type: String, default: '08:00' },
  dayEnd: { type: String, default: '20:00' },
  pacsViewerUrl: String, // e.g. https://pacs.example/viewer?acc={accession}
  creatinineLimit: { type: Number, default: 1.5 }, // mg/dL; above needs a radiologist's reason
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const RadSettings = defineModel('RadSettings', settingsSchema);

/** Study master keyed to the billable service: modality, preparation, contrast, template. */
const defSchema = new Schema({
  serviceId: { type: id, ref: 'Service', required: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  modality: { type: String, enum: MODALITIES, required: true },
  slotMin: Number,
  prep: String, // preparation told to the patient (e.g. fasting 6 hours)
  contrast: { type: Boolean, default: false },
  pcpndt: { type: Boolean, default: false }, // obstetric ultrasound: Form F (PCPNDT Act)
  template: String, // normal report macro
  isActive: { type: Boolean, default: true },
});
defSchema.index({ tenantId: 1, code: 1 }, { unique: true });
defSchema.index({ tenantId: 1, serviceId: 1 });
export const RadStudyDef = defineModel('RadStudyDef', defSchema);

/**
 * One imaging study: ORDERED → SCHEDULED → ARRIVED → PERFORMED → REPORTED → SIGNED, with
 * CANCELLED from ORDERED or SCHEDULED. Signed reports take addenda, never edits.
 */
const studySchema = new Schema({
  accessionNo: { type: String, required: true },
  orderedAt: { type: Date, required: true },
  source: { type: String, enum: ['OPD', 'IPD', 'WALKIN'], required: true },
  visitId: { type: id, ref: 'OpdVisit' },
  admissionId: { type: id, ref: 'Admission' },
  ipNo: String,
  location: String,
  patient: {
    _id: false,
    id: { type: id, ref: 'Patient', required: true },
    uhid: String,
    name: String,
    gender: String,
    age: String,
    mobile: String,
  },
  doctor: { _id: false, id: { type: id, ref: 'Doctor' }, name: String },
  payerKind: { type: String, default: 'CASH' },
  billId: { type: id, ref: 'Bill' },
  priority: { type: String, enum: ['ROUTINE', 'URGENT', 'STAT'], default: 'ROUTINE' },
  clinicalNotes: String,
  defId: { type: id, ref: 'RadStudyDef', required: true },
  serviceId: { type: id, ref: 'Service' },
  code: String,
  name: String,
  modality: String,
  contrast: Boolean,
  pcpndt: Boolean,
  status: {
    type: String,
    enum: ['ORDERED', 'SCHEDULED', 'ARRIVED', 'PERFORMED', 'REPORTED', 'SIGNED', 'CANCELLED'],
    default: 'ORDERED',
  },
  room: String,
  scheduledAt: Date,
  slotMin: Number,
  arrivedAt: Date,
  contrastCheck: {
    consent: Boolean,
    creatinine: Number,
    overrideReason: String,
    by: String,
    at: Date,
  },
  formF: {
    lmp: Date,
    weeks: Number,
    indication: String,
    declaration: Boolean, // doctor's declaration that sex will not be disclosed
    patientSigned: Boolean,
    by: String,
    at: Date,
  },
  performedAt: Date,
  performedBy: String,
  techNotes: String,
  report: {
    findings: String,
    impression: String,
    draftBy: { id: { type: id, ref: 'User' }, name: String },
    draftAt: Date,
  },
  critical: { type: Boolean, default: false }, // urgent finding phoned to the doctor
  signedBy: { id: { type: id, ref: 'User' }, name: String },
  signedAt: Date,
  addenda: [{ _id: false, text: String, by: String, at: Date }],
  acknowledgedAt: Date,
  acknowledgedBy: String,
  cancelReason: String,
});
studySchema.index({ tenantId: 1, status: 1, scheduledAt: 1 });
studySchema.index({ tenantId: 1, room: 1, scheduledAt: 1 });
studySchema.index({ tenantId: 1, 'patient.id': 1, orderedAt: -1 });
studySchema.index({ tenantId: 1, accessionNo: 1 }, { unique: true });
studySchema.index({ tenantId: 1, visitId: 1 });
export const RadStudy = defineModel('RadStudy', studySchema);
