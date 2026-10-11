import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;
const patientSnap = {
  _id: false,
  id: { type: id, ref: 'Patient' },
  uhid: String,
  name: String,
  mobile: String,
};

/** Indicator targets, complaint turnaround (hours by priority) and feedback switches. */
const settingsSchema = new Schema({
  targets: { type: Schema.Types.Mixed, default: () => ({}) },
  complaintTatHours: {
    type: { HIGH: Number, NORMAL: Number, LOW: Number },
    default: { HIGH: 24, NORMAL: 72, LOW: 168 },
  },
  feedbackOpd: { type: Boolean, default: true },
  feedbackIpd: { type: Boolean, default: true },
  reviewLink: String, // public review page shown to promoters (CRM "Reviews")
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const QualitySettings = defineModel('QualitySettings', settingsSchema);

/**
 * A feedback invitation sent after an OPD visit or a discharge; answered through a public link
 * (token). Ratings 1-5 and the 0-10 Net Promoter question.
 */
const feedbackSchema = new Schema({
  token: { type: String, required: true },
  source: { type: String, enum: ['OPD', 'IPD', 'QR'], required: true },
  refId: String, // visit or admission
  patient: patientSnap,
  department: String,
  sentAt: Date,
  respondedAt: Date,
  ratings: {
    overall: Number,
    doctor: Number,
    nursing: Number,
    cleanliness: Number,
    billing: Number,
    food: Number,
  },
  nps: Number,
  comment: String,
  complaintId: { type: id, ref: 'Complaint' },
  expiresAt: Date,
});
feedbackSchema.index({ tenantId: 1, token: 1 }, { unique: true });
feedbackSchema.index({ tenantId: 1, respondedAt: -1 });
feedbackSchema.index({ tenantId: 1, source: 1, refId: 1 });
export const Feedback = defineModel('Feedback', feedbackSchema);

/** Complaint register: owner, TAT, escalation to the Medical Superintendent, closure message. */
const complaintSchema = new Schema({
  complaintNo: String,
  source: {
    type: String,
    enum: ['FEEDBACK', 'FRONT_OFFICE', 'PHONE', 'EMAIL', 'PORTAL', 'WRITTEN'],
    required: true,
  },
  patient: patientSnap,
  contactName: String,
  contactMobile: String,
  category: {
    type: String,
    enum: [
      'BILLING',
      'CLINICAL',
      'NURSING',
      'FACILITY',
      'FOOD',
      'STAFF_BEHAVIOUR',
      'WAITING',
      'OTHER',
    ],
    required: true,
  },
  department: String,
  priority: { type: String, enum: ['HIGH', 'NORMAL', 'LOW'], default: 'NORMAL' },
  description: { type: String, required: true },
  owner: String,
  status: {
    type: String,
    enum: ['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'],
    default: 'OPEN',
  },
  dueAt: Date,
  escalatedAt: Date,
  resolution: String,
  resolvedAt: Date,
  closedAt: Date,
  messageSentAt: Date,
  feedbackId: { type: id, ref: 'Feedback' },
  log: [{ _id: false, at: Date, status: String, by: String, note: String }],
});
complaintSchema.index({ tenantId: 1, status: 1, dueAt: 1 });
export const Complaint = defineModel('Complaint', complaintSchema);

/**
 * Incident report (any staff, anonymously if they choose): investigation, root cause,
 * corrective and preventive actions (CAPA), closure approved by the Quality Manager.
 */
const incidentSchema = new Schema({
  incidentNo: String,
  type: {
    type: String,
    enum: [
      'FALL',
      'MEDICATION_ERROR',
      'NEEDLE_STICK',
      'EQUIPMENT_FAILURE',
      'PRESSURE_INJURY',
      'INFECTION',
      'NEAR_MISS',
      'VIOLENCE',
      'OTHER',
    ],
    required: true,
  },
  severity: {
    type: String,
    enum: ['NEAR_MISS', 'NO_HARM', 'MILD', 'MODERATE', 'SEVERE', 'SENTINEL'],
    required: true,
  },
  occurredAt: { type: Date, required: true },
  location: { type: String, required: true },
  patient: patientSnap,
  description: { type: String, required: true },
  immediateAction: String,
  anonymous: { type: Boolean, default: false },
  reportedBy: { _id: false, userId: id, name: String }, // empty when anonymous
  status: {
    type: String,
    enum: ['REPORTED', 'INVESTIGATING', 'CAPA', 'PENDING_CLOSURE', 'CLOSED'],
    default: 'REPORTED',
  },
  investigator: String,
  rootCause: String,
  contributing: [String],
  actions: [
    {
      text: String,
      kind: { type: String, enum: ['CORRECTIVE', 'PREVENTIVE'] },
      owner: String,
      dueOn: String,
      done: { type: Boolean, default: false },
      doneAt: Date,
      doneBy: String,
    },
  ],
  approvalId: { type: id, ref: 'ApprovalRequest' },
  closedAt: Date,
  log: [{ _id: false, at: Date, status: String, by: String, note: String }],
});
incidentSchema.index({ tenantId: 1, status: 1, occurredAt: -1 });
incidentSchema.index({ tenantId: 1, type: 1, occurredAt: -1 });
export const Incident = defineModel('Incident', incidentSchema);

/** Audit checklist templates and completed audits with a score and action items. */
const auditTemplateSchema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  items: [String],
  active: { type: Boolean, default: true },
});
auditTemplateSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const AuditTemplate = defineModel('AuditTemplate', auditTemplateSchema);

const auditSchema = new Schema({
  templateCode: { type: String, required: true },
  templateName: String,
  area: { type: String, required: true },
  date: { type: String, required: true },
  auditor: String,
  answers: [
    { _id: false, item: String, result: { type: String, enum: ['YES', 'NO', 'NA'] }, note: String },
  ],
  score: Number, // % of applicable items met
  actions: [
    {
      text: String,
      owner: String,
      dueOn: String,
      done: { type: Boolean, default: false },
      doneAt: Date,
    },
  ],
});
auditSchema.index({ tenantId: 1, templateCode: 1, date: -1 });
export const QualityAudit = defineModel('QualityAudit', auditSchema);

/** Controlled documents (policies, SOPs): version, approval, review date, read-acknowledgement. */
const documentSchema = new Schema({
  code: { type: String, required: true },
  title: { type: String, required: true },
  kind: { type: String, enum: ['POLICY', 'SOP', 'FORM', 'PROTOCOL'], default: 'SOP' },
  department: String,
  version: { type: Number, default: 1 },
  docVersion: { type: Number, default: 1 },
  summary: String,
  fileId: { type: id, ref: 'File' },
  status: { type: String, enum: ['DRAFT', 'ACTIVE', 'RETIRED'], default: 'DRAFT' },
  reviewOn: String,
  preparedBy: String,
  approvedBy: String,
  approvedAt: Date,
  acknowledgements: [{ _id: false, userId: id, name: String, at: Date }],
});
documentSchema.index({ tenantId: 1, code: 1, docVersion: -1 });
export const QualityDocument = defineModel('QualityDocument', documentSchema);

/** Hospital-acquired infection cases and monthly device days per ward (infection control). */
const haiSchema = new Schema({
  type: { type: String, enum: ['CAUTI', 'CLABSI', 'VAP', 'SSI'], required: true },
  patient: patientSnap,
  ward: { type: String, required: true },
  onsetOn: { type: String, required: true },
  organism: String,
  notes: String,
  recordedBy: String,
});
haiSchema.index({ tenantId: 1, onsetOn: -1 });
export const HaiCase = defineModel('HaiCase', haiSchema);

const deviceDaysSchema = new Schema({
  month: { type: String, required: true },
  ward: { type: String, required: true },
  catheter: { type: Number, default: 0 },
  centralLine: { type: Number, default: 0 },
  ventilator: { type: Number, default: 0 },
  surgeries: { type: Number, default: 0 },
});
deviceDaysSchema.index({ tenantId: 1, month: 1, ward: 1 }, { unique: true });
export const DeviceDays = defineModel('DeviceDays', deviceDaysSchema);
