import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

const patientSnap = {
  _id: false,
  id: { type: id, ref: 'Patient', required: true },
  uhid: String,
  name: String,
  gender: String,
  age: String,
  mobile: String,
  allergies: { type: [String], default: [] },
};
const doctorSnap = {
  _id: false,
  id: { type: id, ref: 'Doctor' },
  name: String,
  department: String,
};
const bedSnap = {
  _id: false,
  bedId: { type: id, ref: 'Bed' },
  code: String,
  wardId: { type: id, ref: 'Ward' },
  ward: String,
  category: String,
};

/** One per hospital (IPD settings screen; values in paise and minutes). */
const settingsSchema = new Schema({
  deposits: { type: Map, of: Number, default: () => new Map() }, // ward category -> paise
  depositAlertPct: { type: Number, default: 80 },
  topUpPct: { type: Number, default: 100 },
  emergencyDepositHours: { type: Number, default: 24 },
  roomRentMethod: { type: String, enum: ['MIDNIGHT', 'HOURS_24'], default: 'MIDNIGHT' },
  icuFullDayHours: { type: Number, default: 6 },
  enhancementPct: { type: Number, default: 90 },
  reservationHoldMin: { type: Number, default: 120 },
  targets: {
    dischargeMin: { type: Number, default: 180 },
    billMin: { type: Number, default: 45 },
    cleaningMin: { type: Number, default: 45 },
    isolationCleaningMin: { type: Number, default: 90 },
  },
  visitingHours: { type: String, default: '16:00 to 19:00' },
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const IpdSettings = defineModel('IpdSettings', settingsSchema);

/**
 * Live state of each bed (the Bed master only describes it). Rule R3: a bed holds one patient;
 * a reservation expires after the hold time. Rule R19: a vacated bed is CLEANING until
 * housekeeping closes the task.
 */
const bedStateSchema = new Schema({
  bedId: { type: id, ref: 'Bed', required: true },
  status: {
    type: String,
    enum: ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'CLEANING', 'BLOCKED'],
    default: 'AVAILABLE',
  },
  admissionId: { type: id, ref: 'Admission' },
  requestId: { type: id, ref: 'AdmissionRequest' },
  reservedUntil: Date,
  since: { type: Date, default: () => new Date() },
  cleaning: { type: String, enum: ['ROUTINE', 'TERMINAL', null], default: null },
  blockedReason: String,
});
bedStateSchema.index({ tenantId: 1, bedId: 1 }, { unique: true });
bedStateSchema.index({ tenantId: 1, status: 1 });
export const BedState = defineModel('BedState', bedStateSchema);

/** Admission advice to admitted (OPD spec handover; IPD lifecycle "Admission request"). */
const requestSchema = new Schema({
  patient: patientSnap,
  visitId: { type: id, ref: 'OpdVisit' },
  doctor: doctorSnap,
  reason: { type: String, required: true },
  expectedDays: { type: Number, default: 3 },
  wardCategory: { type: String, default: 'GENERAL' },
  urgency: { type: String, enum: ['ROUTINE', 'TODAY', 'EMERGENCY'], default: 'TODAY' },
  isolation: { type: Boolean, default: false },
  packageId: { type: id, ref: 'Package' },
  status: {
    type: String,
    enum: ['REQUESTED', 'ESTIMATED', 'WAITING', 'RESERVED', 'ADMITTED', 'CANCELLED', 'EXPIRED'],
    default: 'REQUESTED',
  },
  estimate: { amount: Number, deposit: Number, days: Number, signedAt: Date, signedBy: String },
  reservedBedId: { type: id, ref: 'Bed' },
  reservedUntil: Date,
  admissionId: { type: id, ref: 'Admission' },
  cancelReason: String,
});
requestSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
requestSchema.index({ tenantId: 1, 'patient.id': 1 });
export const AdmissionRequest = defineModel('AdmissionRequest', requestSchema);

const diagnosis = { _id: false, code: String, name: String };

/**
 * The in-patient stay. Lifecycle: ADMITTED → UNDER_TREATMENT → DISCHARGE_PLANNED →
 * DISCHARGE_STARTED → DISCHARGED, with outcome NORMAL, LAMA, DEATH, ABSCONDED or REFERRED.
 */
const admissionSchema = new Schema({
  ipNo: { type: String, required: true },
  branchId: { type: id, ref: 'Branch' },
  requestId: { type: id, ref: 'AdmissionRequest' },
  patient: patientSnap,
  consultant: doctorSnap,
  reason: { type: String, required: true },
  expectedDays: Number,
  emergency: { type: Boolean, default: false },
  mlc: { flag: { type: Boolean, default: false }, policeIntimation: String, at: Date },
  payer: {
    kind: { type: String, enum: ['CASH', 'INSURANCE', 'CORPORATE', 'SCHEME'], default: 'CASH' },
    payerId: { type: id, ref: 'Payer' },
    name: String,
    policyNo: String,
    roomRentLimit: Number, // paise per day
  },
  bed: bedSnap,
  bedHistory: [{ ...bedSnap, from: Date, to: Date }],
  status: {
    type: String,
    enum: ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED', 'DISCHARGED'],
    default: 'ADMITTED',
  },
  outcome: {
    type: String,
    enum: ['NORMAL', 'LAMA', 'DEATH', 'ABSCONDED', 'REFERRED', null],
    default: null,
  },
  admittedAt: { type: Date, required: true },
  depositDueBy: Date,
  expectedDischargeAt: Date,
  dischargeAdviceAt: Date,
  billReadyAt: Date,
  leftAt: Date,
  billId: { type: id, ref: 'Bill' },
  /** Room days already on the bill: { date: 'YYYY-MM-DD', bedCode, serviceId }. */
  roomDays: [
    {
      _id: false,
      date: String,
      bedCode: String,
      category: String,
      serviceId: { type: id, ref: 'Service' },
      /** Set on a transfer day: hours in this bed, charged pro rata (rule R6). */
      hours: Number,
    },
  ],
  /** Other charges posted by IPD (procedures, nursing, visits): serviceId x qty. */
  charges: [
    {
      serviceId: { type: id, ref: 'Service' },
      name: String,
      qty: Number,
      at: Date,
      by: String,
      source: String,
    },
  ],
  alerts: { deposit80At: Date, deposit100At: Date },
  summary: {
    status: { type: String, enum: ['DRAFT', 'SIGNED'], default: 'DRAFT' },
    diagnoses: [diagnosis],
    procedures: [String],
    course: String,
    condition: String,
    medicines: [{ _id: false, name: String, dose: String, frequency: String, days: Number }],
    followUp: { date: String, note: String },
    advice: String,
    lama: { risksExplained: Boolean, witness: String, signedBy: String },
    death: { at: Date, cause: String, mccdNo: String },
    signedAt: Date,
    signedBy: String,
    addenda: [{ text: String, by: String, at: Date }],
  },
});
admissionSchema.index({ tenantId: 1, status: 1, admittedAt: -1 });
admissionSchema.index({ tenantId: 1, 'patient.id': 1, admittedAt: -1 });
admissionSchema.index({ tenantId: 1, 'consultant.id': 1, status: 1 });
admissionSchema.index({ tenantId: 1, ipNo: 1 }, { unique: true });
// Rule R3: one active stay per patient.
admissionSchema.index(
  { tenantId: 1, 'patient.id': 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'] },
    },
    name: 'one_active_stay',
  },
);
export const Admission = defineModel('Admission', admissionSchema);

/** Housekeeping task for a vacated bed (rule R19). */
const cleaningSchema = new Schema({
  bedId: { type: id, ref: 'Bed', required: true },
  bedCode: String,
  ward: String,
  admissionId: { type: id, ref: 'Admission' },
  type: { type: String, enum: ['ROUTINE', 'TERMINAL'], default: 'ROUTINE' },
  status: { type: String, enum: ['OPEN', 'DONE'], default: 'OPEN' },
  openedAt: { type: Date, default: () => new Date() },
  doneAt: Date,
  doneBy: String,
});
cleaningSchema.index({ tenantId: 1, status: 1, openedAt: 1 });
export const CleaningTask = defineModel('CleaningTask', cleaningSchema);
