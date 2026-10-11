import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;
const kg = { type: Number, default: 0, min: 0 };

/** Linen types, ward par levels, ticket targets (hours) and the waste treatment facility. */
const settingsSchema = new Schema({
  linenTypes: {
    type: [{ _id: false, code: String, name: String }],
    default: [
      { code: 'BEDSHEET', name: 'Bed sheet' },
      { code: 'PILLOW', name: 'Pillow cover' },
      { code: 'BLANKET', name: 'Blanket' },
      { code: 'GOWN', name: 'Patient gown' },
      { code: 'TOWEL', name: 'Towel' },
    ],
  },
  par: { type: [{ _id: false, ward: String, code: String, qty: Number }], default: [] },
  ticketTargets: {
    type: { URGENT: Number, HIGH: Number, NORMAL: Number, LOW: Number },
    default: { URGENT: 2, HIGH: 8, NORMAL: 24, LOW: 72 },
  },
  amcAlertDays: { type: Number, default: 60 },
  wasteFacility: { type: String, default: '' }, // authorised CBWTF
  wasteTolerancePct: { type: Number, default: 5 },
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const FacilitySettings = defineModel('FacilitySettings', settingsSchema);

// ---------------------------------------------------------------- housekeeping

/** Area cleaning checklist on a schedule (spec "Scheduled cleaning"). */
const scheduleSchema = new Schema({
  area: { type: String, required: true },
  kind: { type: String, enum: ['WARD', 'TOILET', 'OPD', 'ICU', 'OT', 'COMMON'], default: 'WARD' },
  times: { type: [String], default: ['08:00'] }, // HH:mm each day
  checklist: { type: [String], default: [] },
  assignee: String,
  active: { type: Boolean, default: true },
});
export const HkSchedule = defineModel('HkSchedule', scheduleSchema);

/** One round of a schedule on a day: done by staff, verified by the supervisor. */
const roundSchema = new Schema({
  scheduleId: { type: id, ref: 'HkSchedule', required: true },
  area: String,
  date: { type: String, required: true },
  time: { type: String, required: true },
  status: { type: String, enum: ['DUE', 'DONE', 'VERIFIED'], default: 'DUE' },
  items: [{ _id: false, text: String, ok: Boolean }],
  doneBy: String,
  doneAt: Date,
  verifiedBy: String,
  verifiedAt: Date,
  remarks: String,
});
roundSchema.index({ tenantId: 1, scheduleId: 1, date: 1, time: 1 }, { unique: true });
roundSchema.index({ tenantId: 1, date: 1, status: 1 });
export const HkRound = defineModel('HkRound', roundSchema);

// ---------------------------------------------------------------- linen

/** Linen in circulation per ward and type. */
const linenStockSchema = new Schema({
  ward: { type: String, required: true },
  code: { type: String, required: true },
  qty: { type: Number, default: 0 },
});
linenStockSchema.index({ tenantId: 1, ward: 1, code: 1 }, { unique: true });
export const LinenStock = defineModel('LinenStock', linenStockSchema);

/** Soiled linen sent to the laundry and the count received back (shortage tracked). */
const laundrySchema = new Schema({
  batchNo: String,
  ward: { type: String, required: true },
  laundry: { type: String, default: 'In-house' },
  lines: [{ _id: false, code: String, sent: Number, received: { type: Number, default: 0 } }],
  status: { type: String, enum: ['SENT', 'RECEIVED'], default: 'SENT' },
  sentAt: { type: Date, default: () => new Date() },
  sentBy: String,
  receivedAt: Date,
  receivedBy: String,
  shortage: { type: Number, default: 0 },
});
laundrySchema.index({ tenantId: 1, status: 1, sentAt: -1 });
export const LaundryBatch = defineModel('LaundryBatch', laundrySchema);

/** Damaged linen written off (Hospital Admin approves); stock drops on approval. */
const condemnSchema = new Schema({
  ward: { type: String, required: true },
  code: { type: String, required: true },
  qty: { type: Number, required: true },
  reason: String,
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
    default: 'PENDING_APPROVAL',
  },
  approvalId: { type: id, ref: 'ApprovalRequest' },
  requestedBy: String,
});
export const LinenCondemnation = defineModel('LinenCondemnation', condemnSchema);

// ---------------------------------------------------------------- patient transport

const porterSchema = new Schema({
  requestNo: String,
  patient: { _id: false, id: { type: id, ref: 'Patient' }, uhid: String, name: String },
  from: { type: String, required: true },
  to: { type: String, required: true },
  mode: { type: String, enum: ['WHEELCHAIR', 'STRETCHER', 'BED', 'WALK'], default: 'WHEELCHAIR' },
  priority: { type: String, enum: ['ROUTINE', 'URGENT'], default: 'ROUTINE' },
  notes: String,
  status: {
    type: String,
    enum: ['REQUESTED', 'ASSIGNED', 'PICKED', 'DONE', 'CANCELLED'],
    default: 'REQUESTED',
  },
  porter: String,
  requestedBy: String,
  requestedAt: { type: Date, default: () => new Date() },
  assignedAt: Date,
  pickedAt: Date,
  doneAt: Date,
});
porterSchema.index({ tenantId: 1, status: 1, requestedAt: 1 });
export const PorterRequest = defineModel('PorterRequest', porterSchema);

// ---------------------------------------------------------------- maintenance and equipment

/** Medical and facility equipment (spec "Equipment register"). */
const assetSchema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  category: {
    type: String,
    enum: ['BIOMEDICAL', 'ELECTRICAL', 'HVAC', 'IT', 'FURNITURE', 'OTHER'],
    default: 'BIOMEDICAL',
  },
  make: String,
  model: String,
  serialNo: String,
  location: String,
  department: String,
  vendor: String,
  purchasedOn: Date,
  cost: Number, // paise
  warrantyUntil: Date,
  riskClass: { type: String, enum: ['A', 'B', 'C'], default: 'B' }, // A = life support
  status: {
    type: String,
    enum: ['IN_SERVICE', 'OUT_OF_SERVICE', 'CONDEMNED'],
    default: 'IN_SERVICE',
  },
  outSince: Date,
  pmEveryDays: Number,
  nextPmDue: Date,
  calibrationEveryDays: Number,
  nextCalibrationDue: Date,
  amc: {
    vendor: String,
    kind: { type: String, enum: ['AMC', 'CMC'] },
    from: Date,
    until: Date,
    cost: Number,
    phone: String,
  },
  downtimeMin: { type: Number, default: 0 },
  history: [{ _id: false, at: Date, kind: String, text: String, by: String }],
});
assetSchema.index({ tenantId: 1, code: 1 }, { unique: true });
assetSchema.index({ tenantId: 1, status: 1 });
export const Asset = defineModel('Asset', assetSchema);

/** Preventive maintenance or calibration done, with the certificate. */
const pmSchema = new Schema({
  assetId: { type: id, ref: 'Asset', required: true },
  kind: { type: String, enum: ['PM', 'CALIBRATION'], required: true },
  doneAt: { type: Date, required: true },
  doneBy: String,
  vendorVisit: Boolean,
  passed: { type: Boolean, default: true },
  notes: String,
  certificateFileId: { type: id, ref: 'File' },
  nextDue: Date,
});
pmSchema.index({ tenantId: 1, assetId: 1, doneAt: -1 });
export const PmRecord = defineModel('PmRecord', pmSchema);

/**
 * A maintenance ticket raised by any user: OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED
 * when the requester confirms (or REOPENED). A breakdown takes the equipment out of service.
 */
const ticketSchema = new Schema({
  ticketNo: String,
  category: {
    type: String,
    enum: ['ELECTRICAL', 'PLUMBING', 'AC', 'CIVIL', 'IT', 'BIOMEDICAL', 'CARPENTRY', 'OTHER'],
    required: true,
  },
  priority: { type: String, enum: ['URGENT', 'HIGH', 'NORMAL', 'LOW'], default: 'NORMAL' },
  location: { type: String, required: true },
  description: { type: String, required: true },
  assetId: { type: id, ref: 'Asset' },
  assetName: String,
  breakdown: { type: Boolean, default: false },
  photoFileId: { type: id, ref: 'File' },
  raisedBy: { _id: false, userId: id, name: String },
  assignee: String,
  status: {
    type: String,
    enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'],
    default: 'OPEN',
  },
  dueAt: Date,
  resolution: String,
  resolvedAt: Date,
  closedAt: Date,
  downtimeMin: Number,
  log: [{ _id: false, at: Date, status: String, by: String, note: String }],
});
ticketSchema.index({ tenantId: 1, status: 1, priority: 1, createdAt: -1 });
ticketSchema.index({ tenantId: 1, 'raisedBy.userId': 1, createdAt: -1 });
export const Ticket = defineModel('Ticket', ticketSchema);

// ---------------------------------------------------------------- biomedical waste

/** Daily waste per ward by colour category in kg (Bio-Medical Waste Management Rules, 2016). */
const wasteSchema = new Schema({
  date: { type: String, required: true },
  ward: { type: String, required: true },
  yellow: kg,
  red: kg,
  white: kg,
  blue: kg,
  enteredBy: String,
});
wasteSchema.index({ tenantId: 1, date: 1, ward: 1 }, { unique: true });
export const WasteEntry = defineModel('WasteEntry', wasteSchema);

/** Handover to the authorised treatment facility with the manifest; mismatch flagged. */
const handoverSchema = new Schema({
  date: { type: String, required: true },
  manifestNo: { type: String, required: true },
  vehicle: String,
  facility: String,
  weights: { yellow: kg, red: kg, white: kg, blue: kg },
  recorded: { yellow: kg, red: kg, white: kg, blue: kg },
  mismatch: { type: Boolean, default: false },
  by: String,
});
handoverSchema.index({ tenantId: 1, date: 1 });
export const WasteHandover = defineModel('WasteHandover', handoverSchema);
