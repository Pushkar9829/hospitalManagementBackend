import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

const patientSnap = {
  _id: false,
  id: { type: id, ref: 'Patient', required: true },
  uhid: String,
  name: String,
  gender: String, // M | F | O | U
  age: String, // label, e.g. "44Y"
  ageDays: Number, // for reference ranges by age
  mobile: String,
};

/** One per hospital (Lab settings screen; times in minutes). */
const settingsSchema = new Schema({
  criticalCallMin: { type: Number, default: 30 }, // R7
  escalateMin: { type: Number, default: 15 },
  deltaDays: { type: Number, default: 7 }, // R8
  autoverify: { type: Boolean, default: false }, // R9
  labelVoidHours: { type: Number, default: 2 },
  tatMin: {
    STAT: { type: Number, default: 60 },
    URGENT: { type: Number, default: 120 },
    ROUTINE: { type: Number, default: 240 },
  },
  rejectReasons: {
    type: [String],
    default: [
      'HAEMOLYSED',
      'CLOTTED',
      'WRONG_CONTAINER',
      'INSUFFICIENT',
      'UNLABELLED',
      'LABEL_MISMATCH',
      'DELAYED',
      'LEAKED',
    ],
  },
  retentionDays: { serum: { type: Number, default: 7 }, blocks: { type: Number, default: 3650 } },
  /** Westgard rules per analyser (board QC): the warning rule and the rules that reject a run. */
  qcRules: {
    type: [
      {
        _id: false,
        analyser: String,
        warning: { type: String, default: '1-2s' },
        reject: { type: [String], default: ['1-3s', '2-2s'] },
        levels: Number,
        frequency: String,
      },
    ],
    default: [],
  },
  /** Home sample collection (board Lab settings): fee, slots offered, areas served. */
  homeCollection: {
    fee: { type: Number, default: 0 }, // paise
    slots: { type: [String], default: ['07:00-08:00', '08:00-09:00', '09:00-10:00'] },
    areas: { type: [String], default: [] },
  },
  /** Report layout: the header and footer lines and who signs for each department. */
  report: {
    header: { type: String, default: '' },
    footer: { type: String, default: '' },
    signatories: {
      type: [{ _id: false, department: String, name: String, qualification: String }],
      default: [],
    },
  },
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const LabSettings = defineModel('LabSettings', settingsSchema);

/**
 * Test master, keyed to the billable service (price and approval live in setup). Ranges by sex
 * and age (R6), critical limits (R7) and delta limits (R8) per analyte.
 */
const rangeSchema = new Schema(
  {
    sex: { type: String, enum: ['ANY', 'M', 'F'], default: 'ANY' },
    ageMinDays: { type: Number, default: 0 },
    ageMaxDays: { type: Number, default: 200 * 365 },
    low: Number,
    high: Number,
    text: String, // e.g. "Negative"
  },
  { _id: false },
);
const analyteSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    unit: String,
    kind: { type: String, enum: ['NUMBER', 'TEXT', 'CHOICE'], default: 'NUMBER' },
    choices: [String],
    abnormal: [String], // CHOICE values that are flagged abnormal (e.g. "Reactive")
    decimals: { type: Number, default: 1 },
    ranges: [rangeSchema],
    criticalLow: Number,
    criticalHigh: Number,
    deltaPct: Number, // change beyond this % of the last value holds the result
    repeatOnCritical: { type: Boolean, default: false }, // R18
  },
  { _id: false },
);
const testSchema = new Schema({
  serviceId: { type: id, ref: 'Service', required: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  department: {
    type: String,
    enum: [
      'BIOCHEMISTRY',
      'HAEMATOLOGY',
      'CLINICAL_PATHOLOGY',
      'SEROLOGY',
      'MICROBIOLOGY',
      'HISTOPATHOLOGY',
    ],
    default: 'BIOCHEMISTRY',
  },
  sampleType: { type: String, default: 'SERUM' },
  container: { type: String, default: 'RED' }, // tube colour / container
  method: String,
  analyser: String, // QC gate (R4) applies when set
  tatMin: Number, // routine TAT; falls back to settings
  stabilityHours: { type: Number, default: 24 }, // add-on window (R14)
  sensitive: { type: Boolean, default: false }, // R13
  nabl: { type: Boolean, default: true }, // R12
  autoverify: { type: Boolean, default: false },
  analytes: [analyteSchema],
  isActive: { type: Boolean, default: true },
});
testSchema.index({ tenantId: 1, code: 1 }, { unique: true });
testSchema.index({ tenantId: 1, serviceId: 1 });
export const LabTest = defineModel('LabTest', testSchema);

/**
 * One ordered test (the unit on every worklist). Lifecycle (LAB.md section 4):
 * ORDERED → COLLECTED → RECEIVED → RESULTED → VERIFIED → RELEASED, with CANCELLED (from ORDERED)
 * and REJECTED (a rejected sample sends the test back to ORDERED with a recollection flag).
 */
const resultSchema = new Schema(
  {
    code: String,
    name: String,
    unit: String,
    value: String,
    num: Number,
    flag: { type: String, enum: ['N', 'L', 'H', 'LL', 'HH', 'A', null], default: null },
    range: String,
    critical: Boolean,
    delta: { prev: String, prevAt: Date, changePct: Number },
  },
  { _id: false },
);
const holdSchema = new Schema(
  {
    kind: { type: String, enum: ['CRITICAL', 'DELTA', 'QC'] },
    open: { type: Boolean, default: true },
    note: String,
    at: Date,
    closedAt: Date,
    closedBy: String,
  },
  { _id: true },
);
const itemSchema = new Schema({
  orderNo: { type: String, required: true },
  orderedAt: { type: Date, required: true },
  source: { type: String, enum: ['OPD', 'IPD', 'WALKIN'], required: true },
  visitId: { type: id, ref: 'OpdVisit' },
  admissionId: { type: id, ref: 'Admission' },
  ipNo: String, // wristband scan matches the UHID or this (R1)
  location: String, // ward and bed, or OPD
  patient: patientSnap,
  doctor: { _id: false, id: { type: id, ref: 'Doctor' }, name: String },
  payerKind: { type: String, default: 'CASH' },
  billId: { type: id, ref: 'Bill' },
  priority: { type: String, enum: ['ROUTINE', 'URGENT', 'STAT'], default: 'ROUTINE' },
  clinicalNotes: String,
  testId: { type: id, ref: 'LabTest', required: true },
  serviceId: { type: id, ref: 'Service' },
  code: String,
  name: String,
  department: String,
  analyser: String,
  sensitive: Boolean,
  status: {
    type: String,
    enum: ['ORDERED', 'COLLECTED', 'RECEIVED', 'RESULTED', 'VERIFIED', 'RELEASED', 'CANCELLED'],
    default: 'ORDERED',
  },
  recollect: { type: Boolean, default: false },
  sampleId: { type: id, ref: 'LabSample' },
  sampleNo: String,
  results: [resultSchema],
  holds: [holdSchema],
  comment: String,
  enteredBy: { id: { type: id, ref: 'User' }, name: String },
  verifiedBy: { id: { type: id, ref: 'User' }, name: String },
  releasedBy: { id: { type: id, ref: 'User' }, name: String },
  collectedAt: Date,
  receivedAt: Date,
  enteredAt: Date,
  verifiedAt: Date,
  releasedAt: Date,
  dueAt: Date, // TAT target (R11)
  reportVersion: { type: Number, default: 1 }, // amendments add one (R10)
  amendments: [
    {
      _id: false,
      version: Number,
      reason: String,
      results: [resultSchema],
      releasedAt: Date,
      releasedBy: String,
      amendedAt: Date,
      amendedBy: String,
    },
  ],
  acknowledgedAt: Date,
  acknowledgedBy: String,
  cancelReason: String,
});
itemSchema.index({ tenantId: 1, status: 1, priority: 1, orderedAt: 1 });
itemSchema.index({ tenantId: 1, 'patient.id': 1, code: 1, releasedAt: -1 });
itemSchema.index({ tenantId: 1, orderNo: 1 });
itemSchema.index({ tenantId: 1, sampleId: 1 });
itemSchema.index({ tenantId: 1, visitId: 1 });
itemSchema.index({ tenantId: 1, admissionId: 1 });
export const LabItem = defineModel('LabItem', itemSchema);

/**
 * One container with its barcode (R1). LABELLED → COLLECTED → RECEIVED → STORED → DISCARDED;
 * REJECTED at receipt (R3).
 */
const sampleSchema = new Schema({
  sampleNo: { type: String, required: true },
  orderNo: String,
  patient: patientSnap,
  location: String,
  priority: String,
  sampleType: String,
  container: String,
  itemIds: [{ type: id, ref: 'LabItem' }],
  tests: [String],
  status: {
    type: String,
    enum: ['COLLECTED', 'RECEIVED', 'REJECTED', 'STORED', 'DISCARDED'],
    default: 'COLLECTED',
  },
  collectedAt: Date,
  collectedBy: String,
  receivedAt: Date,
  receivedBy: String,
  /** Storage after testing (board Sample receipt, "Storage"): rack and keep-until date. */
  storage: { _id: false, location: String, until: String, storedAt: Date, storedBy: String },
  discardedAt: Date,
  rejectReason: String,
  rejectNote: String,
  rejectedAt: Date,
  rejectedBy: String,
});
sampleSchema.index({ tenantId: 1, sampleNo: 1 }, { unique: true });
sampleSchema.index({ tenantId: 1, status: 1, collectedAt: 1 });
export const LabSample = defineModel('LabSample', sampleSchema);

/** Critical value call (R7): phoned with read-back within the time limit; escalated if not. */
const callSchema = new Schema({
  itemId: { type: id, ref: 'LabItem', required: true },
  orderNo: String,
  patient: patientSnap,
  location: String,
  test: String,
  analyte: String,
  value: String,
  flag: String,
  doctor: String,
  status: { type: String, enum: ['OPEN', 'DONE'], default: 'OPEN' },
  dueAt: Date,
  escalateAt: Date,
  escalatedAt: Date,
  attempts: [
    {
      _id: false,
      at: Date,
      to: String,
      role: String,
      reached: Boolean,
      readBack: Boolean,
      note: String,
      by: String,
    },
  ],
  doneAt: Date,
});
callSchema.index({ tenantId: 1, status: 1, dueAt: 1 });
export const CriticalCall = defineModel('CriticalCall', callSchema);

/** QC run of one control level on one analyser (R4, R5: Westgard 1-2s, 1-3s, 2-2s). */
const controlSchema = new Schema({
  analyser: { type: String, required: true },
  analyte: { type: String, required: true }, // analyte code
  name: String,
  level: { type: String, default: 'L1' },
  lot: String,
  mean: { type: Number, required: true },
  sd: { type: Number, required: true },
  unit: String,
  isActive: { type: Boolean, default: true },
});
controlSchema.index({ tenantId: 1, analyser: 1, analyte: 1, level: 1 });
export const QcControl = defineModel('QcControl', controlSchema);

const qcRunSchema = new Schema({
  controlId: { type: id, ref: 'QcControl', required: true },
  analyser: String,
  analyte: String,
  level: String,
  value: Number,
  z: Number,
  rules: [String], // broken rules, e.g. ["1-2s"], ["1-3s"]
  status: { type: String, enum: ['IN_CONTROL', 'WARNING', 'REJECTED'] },
  at: Date,
  by: String,
  note: String,
});
qcRunSchema.index({ tenantId: 1, controlId: 1, at: -1 });
qcRunSchema.index({ tenantId: 1, analyser: 1, at: -1 });
export const QcRun = defineModel('QcRun', qcRunSchema);

/**
 * A home collection visit (design board "Phlebotomist phone screens"): booked by the call centre,
 * front office or lab, assigned to a phlebotomist, who starts it, collects at the patient's home
 * (wristband rule replaced by the UHID card scan) and hands the samples over at the lab.
 */
const homeVisitSchema = new Schema({
  visitNo: { type: String, required: true },
  patient: patientSnap,
  address: { type: String, required: true },
  landmark: String,
  phone: String,
  date: { type: String, required: true }, // YYYY-MM-DD (IST)
  slot: { type: String, required: true }, // "07:00-08:00"
  orderNo: String,
  itemIds: [{ type: Schema.Types.ObjectId, ref: 'LabItem' }],
  tests: [String],
  notes: String,
  phlebotomist: { _id: false, userId: { type: Schema.Types.ObjectId, ref: 'User' }, name: String },
  status: {
    type: String,
    enum: ['BOOKED', 'ASSIGNED', 'ON_THE_WAY', 'COLLECTED', 'HANDED_OVER', 'CANCELLED'],
    default: 'BOOKED',
  },
  startedAt: Date,
  collectedAt: Date,
  handedOverAt: Date,
  sampleNos: [String],
  cancelReason: String,
});
homeVisitSchema.index({ tenantId: 1, visitNo: 1 }, { unique: true });
homeVisitSchema.index({ tenantId: 1, date: 1, 'phlebotomist.userId': 1, status: 1 });
export const HomeVisit = defineModel('HomeVisit', homeVisitSchema);
