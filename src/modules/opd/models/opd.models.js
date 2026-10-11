import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/** The patient as shown on OPD screens, copied at booking (the master stays the truth). */
const patientSnap = {
  _id: false,
  id: { type: id, ref: 'Patient', required: true },
  uhid: String,
  name: String,
  gender: String,
  age: String,
  mobile: String,
  allergies: { type: [String], default: [] },
  noKnownAllergies: { type: Boolean, default: false },
};

const doctorSnap = {
  _id: false,
  id: { type: id, ref: 'Doctor', required: true },
  name: String,
  department: String,
  room: String,
};

const fee = {
  _id: false,
  amount: { type: Number, default: 0 }, // paise
  label: String, // FREE_FOLLOW_UP | PLUS_VACCINE
  freeDay: Number,
  window: Number,
  paid: { type: Boolean, default: false },
  prepaid: { type: Boolean, default: false },
  serviceId: { type: id, ref: 'Service' },
};

// ---------------------------------------------------------------------------------------------
// Settings and schedules
// ---------------------------------------------------------------------------------------------

const session = {
  _id: false,
  start: { type: String, required: true }, // HH:mm
  end: { type: String, required: true },
  room: String,
  slotNew: { type: Number, default: 10 },
  slotFollowUp: { type: Number, default: 5 },
  max: { type: Number, default: 18 },
  overbook: { type: Number, default: 0 },
  online: { type: Boolean, default: true },
  tele: { type: Boolean, default: false },
};

/** A doctor's weekly template (spec OPD settings). Fees live in the billing tariff. */
const scheduleSchema = new Schema({
  doctorId: { type: id, ref: 'Doctor', required: true },
  week: [
    {
      _id: false,
      day: { type: String, enum: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] },
      sessions: [session],
    },
  ],
  /** Services that price the consultation per visit type (NEW, FOLLOW_UP, TELE). */
  feeServices: {
    NEW: { type: id, ref: 'Service' },
    FOLLOW_UP: { type: id, ref: 'Service' },
    TELE: { type: id, ref: 'Service' },
  },
  followUp: { days: { type: Number, default: 15 }, visits: { type: Number, default: 1 } },
  pendingFeeChange: { fees: Schema.Types.Mixed, approvalId: { type: id, ref: 'ApprovalRequest' } },
});
scheduleSchema.index({ tenantId: 1, doctorId: 1 }, { unique: true });
export const DoctorSchedule = defineModel('DoctorSchedule', scheduleSchema);

/** Leave and blocked dates (rule R10). */
const blockSchema = new Schema({
  doctorId: { type: id, ref: 'Doctor', required: true },
  from: { type: String, required: true }, // YYYY-MM-DD (IST)
  to: { type: String, required: true },
  reason: String,
});
blockSchema.index({ tenantId: 1, doctorId: 1, from: 1 });
export const ScheduleBlock = defineModel('ScheduleBlock', blockSchema);

/** One per hospital: booking, cancellation, triage, tokens, messages and visit types. */
const settingsSchema = new Schema({
  booking: {
    bookAheadDays: { type: Number, default: 30 },
    latestBeforeMin: { type: Number, default: 60 },
    holdMin: { type: Number, default: 5 },
    maxFuturePerDoctor: { type: Number, default: 2 },
    walkInEvery: { type: Number, default: 3 },
    lateGraceMin: { type: Number, default: 15 },
    prepayOnline: { type: String, default: 'OPTIONAL' },
    triageRequired: { type: [String], default: [] },
  },
  cancellation: {
    freeUntilHours: { type: Number, default: 4 },
    keepPercent: { type: Number, default: 50 },
    noShowAfterMin: { type: Number, default: 30 },
    noShowRefund: { type: String, default: 'CREDIT' },
    prepayAfterNoShows: { type: Number, default: 3 },
    prepayWindowDays: { type: Number, default: 90 },
    hospitalChange: { type: String, default: 'FULL_REFUND_OR_FREE_RESCHEDULE' },
  },
  pending: {
    section: String,
    values: Schema.Types.Mixed,
    approvalId: { type: id, ref: 'ApprovalRequest' },
  },
  tokenSeries: [
    {
      prefix: String,
      usedFor: String,
      resets: { type: String, default: 'DAILY' },
      display: String,
    },
  ],
  messages: [
    {
      code: String,
      when: String,
      channels: [String],
      languages: [String],
      on: { type: Boolean, default: true },
    },
  ],
  visitTypes: [
    {
      code: String,
      name: String,
      slotMin: Number,
      fee: String,
      freeFollowUp: String,
      online: Boolean,
      tele: Boolean,
    },
  ],
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const OpdSettings = defineModel('OpdSettings', settingsSchema);

/**
 * A Queue TV's key. The TV opens /display/queue?key=… and sees its branch's queue (tokens and
 * rooms only, never patient names) without a signed-in user. Only the key's hash is stored.
 */
const displayKeySchema = new Schema({
  name: { type: String, required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  hash: { type: String, required: true },
  last4: String,
  createdByName: String,
  lastSeenAt: Date,
  revokedAt: Date,
});
displayKeySchema.index({ tenantId: 1, hash: 1 }, { unique: true });
export const DisplayKey = defineModel('DisplayKey', displayKeySchema);

// ---------------------------------------------------------------------------------------------
// Appointments and visits
// ---------------------------------------------------------------------------------------------

/** Status lifecycle (OPD spec 4): BOOKED → CONFIRMED → CHECKED_IN → IN_CONSULT → COMPLETED. */
const appointmentSchema = new Schema({
  apptNo: { type: String, required: true },
  branchId: { type: id, ref: 'Branch' },
  date: { type: String, required: true }, // YYYY-MM-DD (IST)
  time: { type: String, required: true }, // HH:mm
  slotStart: { type: Date, required: true },
  doctor: doctorSnap,
  patient: patientSnap,
  visitType: { type: String, required: true },
  channel: { type: String, required: true },
  status: {
    type: String,
    enum: [
      'BOOKED',
      'CONFIRMED',
      'CHECKED_IN',
      'IN_CONSULT',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
      'RESCHEDULED',
    ],
    default: 'BOOKED',
  },
  fee,
  token: String,
  visitId: { type: id, ref: 'OpdVisit' },
  notes: String,
  reason: String,
  rescheduledTo: { type: id, ref: 'Appointment' },
  detailsConfirmed: Boolean,
  whatsappConsent: Boolean,
  /** Unique while active: rule R1, one booking per doctor slot (overbooking adds a seq). */
  slotKey: String,
});
appointmentSchema.index({ tenantId: 1, date: 1, 'doctor.id': 1, time: 1 });
appointmentSchema.index({ tenantId: 1, 'patient.id': 1, date: -1 });
appointmentSchema.index(
  { tenantId: 1, slotKey: 1 },
  { unique: true, partialFilterExpression: { slotKey: { $type: 'string' } } },
);
export const Appointment = defineModel('Appointment', appointmentSchema);

const rxLine = {
  _id: false,
  drugId: String,
  brand: String,
  generic: String,
  dose: String,
  frequency: String,
  days: Number,
  route: String,
  instructions: String,
};
const orderLine = {
  _id: false,
  code: String,
  serviceId: { type: id, ref: 'Service' },
  name: String,
  // A field called "type" must be spelled out, or Mongoose reads the object as a type.
  type: { type: String },
  priority: { type: String, default: 'ROUTINE' },
  price: Number,
  status: { type: String, default: 'DRAFT' },
};

const consultationSchema = new Schema(
  {
    status: { type: String, enum: ['DRAFT', 'SIGNED'], default: 'DRAFT' },
    complaints: String,
    history: String,
    examination: String,
    diagnoses: [{ _id: false, code: String, name: String, provisional: Boolean }],
    noDiagnosisReason: String,
    rx: [rxLine],
    orders: [orderLine],
    advice: String,
    followUp: { date: String, note: String },
    printLanguage: { type: String, default: 'en' },
    specialty: String,
    certificate: Schema.Types.Mixed,
    addenda: [{ text: String, by: String, byUserId: { type: id, ref: 'User' }, at: Date }],
    savedAt: Date,
    signedAt: Date,
    signedBy: String,
    rev: { type: Number, default: 0 },
  },
  { _id: false },
);

/** Visit lifecycle (OPD spec 4): OPEN → TRIAGE_DONE → CONSULTED → ORDERS_PENDING → CLOSED. */
const visitSchema = new Schema({
  visitNo: { type: String, required: true },
  branchId: { type: id, ref: 'Branch' },
  date: { type: String, required: true },
  token: String,
  appointmentId: { type: id, ref: 'Appointment' },
  patient: patientSnap,
  doctor: doctorSnap,
  visitType: String,
  channel: String,
  walkIn: Boolean,
  stage: {
    type: String,
    enum: ['WAITING', 'IN_TRIAGE', 'TRIAGED', 'CALLED', 'WITH_DOCTOR', 'DONE'],
    default: 'WAITING',
  },
  status: {
    type: String,
    enum: ['OPEN', 'TRIAGE_DONE', 'CONSULTED', 'ORDERS_PENDING', 'CLOSED', 'ADMITTED', 'REFERRED'],
    default: 'OPEN',
  },
  priority: { type: String, enum: ['RED', 'AMBER', 'GREEN', null], default: null },
  late: { type: Boolean, default: false },
  moveReason: String,
  skipReason: String,
  checkedInAt: Date,
  triageStartedAt: Date,
  calledAt: Date,
  consultStartedAt: Date,
  closedAt: Date,
  complaint: String,
  vitals: Schema.Types.Mixed,
  triageSkipped: { reason: String, by: String, at: Date },
  procedures: [
    { type: { type: String }, detail: String, notes: String, recordedAt: Date, by: String },
  ],
  fee,
  consultation: consultationSchema,
  admissionRequest: Schema.Types.Mixed,
  referrals: [Schema.Types.Mixed],
  billId: { type: id, ref: 'Bill' },
  receipt: Schema.Types.Mixed,
});
visitSchema.index({ tenantId: 1, date: 1, 'doctor.id': 1, stage: 1 });
visitSchema.index({ tenantId: 1, 'patient.id': 1, date: -1 });
export const OpdVisit = defineModel('OpdVisit', visitSchema);

// ---------------------------------------------------------------------------------------------
// Templates and the other appointment tabs
// ---------------------------------------------------------------------------------------------

const templateSchema = new Schema({
  name: { type: String, required: true },
  kind: { type: String, enum: ['RX', 'ORDER_SET', 'SPECIALTY'], required: true },
  department: String,
  owner: String,
  ownerUserId: { type: id, ref: 'User' },
  rx: [rxLine],
  orders: [{ _id: false, code: String }],
  advice: String,
  specialty: String,
  usedThisMonth: { type: Number, default: 0 },
});
templateSchema.index({ tenantId: 1, kind: 1, department: 1 });
export const OpdTemplate = defineModel('OpdTemplate', templateSchema);

/** Health check-up packages in progress, treatment plans and bookable resources. */
const checkupSchema = new Schema({
  date: String,
  patient: patientSnap,
  package: String,
  company: String,
  stationsDone: { type: Number, default: 0 },
  stations: { type: Number, default: 8 },
  nextStation: String,
  report: { type: String, default: 'PENDING' },
});
checkupSchema.index({ tenantId: 1, date: -1 });
export const HealthCheckup = defineModel('HealthCheckup', checkupSchema);

const planSchema = new Schema({
  patient: patientSnap,
  plan: String,
  sessions: Number,
  done: { type: Number, default: 0 },
  nextSession: Date,
  billing: { type: String, enum: ['PACKAGE', 'PER_SESSION'] },
  amount: Number, // paise
});
export const TreatmentPlan = defineModel('TreatmentPlan', planSchema);

const resourceSchema = new Schema({
  name: String,
  type: { type: String, enum: ['ROOM', 'EQUIPMENT', 'THERAPIST'] },
  bookableFor: String,
  booked: { type: Number, default: 0 },
  slots: { type: Number, default: 8 },
});
export const OpdResource = defineModel('OpdResource', resourceSchema);
