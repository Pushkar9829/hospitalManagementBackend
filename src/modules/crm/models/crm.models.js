import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;
const patientSnap = { _id: false, id: { type: id, ref: 'Patient' }, uhid: String, name: String };

/** A call-centre or desk enquiry: who called, about what, what was done. */
const enquirySchema = new Schema({
  mobile: { type: String, required: true },
  name: String,
  patient: patientSnap,
  channel: { type: String, enum: ['CALL', 'WALK_IN', 'WHATSAPP', 'WEB', 'EMAIL'], default: 'CALL' },
  direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], default: 'INBOUND' },
  topic: {
    type: String,
    enum: ['APPOINTMENT', 'PACKAGE', 'REPORT', 'BILLING', 'GENERAL', 'COMPLAINT'],
    default: 'GENERAL',
  },
  notes: String,
  outcome: String,
  leadId: { type: id, ref: 'Lead' },
  by: String,
  at: { type: Date, default: () => new Date() },
  recordingUrl: String,
});
enquirySchema.index({ tenantId: 1, mobile: 1, at: -1 });
export const Enquiry = defineModel('CrmEnquiry', enquirySchema);

/**
 * A lead for a surgery, package or check-up: NEW → CONTACTED → COUNSELLED → BOOKED → CONVERTED
 * (admitted or seen), or LOST with a reason. Follow-ups are dated.
 */
const leadSchema = new Schema({
  leadNo: String,
  name: { type: String, required: true },
  mobile: { type: String, required: true },
  patient: patientSnap,
  interest: { type: String, required: true }, // e.g. "Knee replacement"
  department: String,
  source: {
    type: String,
    enum: ['CALL', 'WALK_IN', 'WEBSITE', 'CAMP', 'REFERRAL', 'CAMPAIGN', 'SOCIAL', 'OTHER'],
    default: 'CALL',
  },
  campId: { type: id, ref: 'HealthCamp' },
  campaignId: { type: id, ref: 'Campaign' },
  referralSourceId: { type: id, ref: 'ReferralSource' },
  estimate: Number, // paise
  stage: {
    type: String,
    enum: ['NEW', 'CONTACTED', 'COUNSELLED', 'BOOKED', 'CONVERTED', 'LOST'],
    default: 'NEW',
  },
  owner: String,
  nextFollowUp: Date,
  lostReason: String,
  convertedAt: Date,
  convertedRef: String, // IP or visit number
  notes: [{ _id: false, at: Date, by: String, text: String }],
});
leadSchema.index({ tenantId: 1, stage: 1, nextFollowUp: 1 });
leadSchema.index({ tenantId: 1, mobile: 1 });
leadSchema.index({ tenantId: 1, 'patient.id': 1, stage: 1 });
export const Lead = defineModel('Lead', leadSchema);

/** A health camp: plan, budget, on-site registrations with screening results, conversions. */
const campSchema = new Schema({
  campNo: String,
  name: { type: String, required: true },
  date: { type: String, required: true },
  venue: { type: String, required: true },
  partner: String,
  screenings: [String], // e.g. BP, RBS, BMI, ECG
  cost: { type: Number, default: 0 }, // paise
  status: { type: String, enum: ['PLANNED', 'DONE', 'CANCELLED'], default: 'PLANNED' },
  registrations: [
    {
      name: String,
      mobile: String,
      age: Number,
      gender: String,
      results: Schema.Types.Mixed, // { BP: '150/95', RBS: 210 }
      advice: String,
      followUp: { type: Boolean, default: false },
      patientId: { type: id, ref: 'Patient' },
      leadId: { type: id, ref: 'Lead' },
      at: Date,
    },
  ],
});
campSchema.index({ tenantId: 1, date: -1 });
export const HealthCamp = defineModel('HealthCamp', campSchema);

/** Communication consent per mobile number (campaigns respect opt-out). */
const prefSchema = new Schema({
  mobile: { type: String, required: true },
  patientId: { type: id, ref: 'Patient' },
  sms: { type: Boolean, default: true },
  whatsapp: { type: Boolean, default: true },
  optedOutAt: Date,
  source: String,
});
prefSchema.index({ tenantId: 1, mobile: 1 }, { unique: true });
export const CommsPreference = defineModel('CommsPreference', prefSchema);

/** An SMS or WhatsApp campaign to a filtered patient list (DLT template), with delivery counts. */
const campaignSchema = new Schema({
  campaignNo: String,
  name: { type: String, required: true },
  channel: { type: String, enum: ['SMS', 'WHATSAPP'], default: 'SMS' },
  dltTemplateId: String,
  text: { type: String, required: true },
  audience: {
    conditions: [String],
    gender: String,
    ageMin: Number,
    ageMax: Number,
    lastVisitBefore: String,
    lastVisitAfter: String,
  },
  status: { type: String, enum: ['DRAFT', 'SENT'], default: 'DRAFT' },
  audienceCount: Number,
  sent: { type: Number, default: 0 },
  skippedOptOut: { type: Number, default: 0 },
  responses: { type: Number, default: 0 },
  sentAt: Date,
  sentBy: String,
});
export const Campaign = defineModel('Campaign', campaignSchema);

/** Membership plans: price, validity, discount, free consultations and a wallet credit. */
const planSchema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true }, // paise
  validityDays: { type: Number, default: 365 },
  maxMembers: { type: Number, default: 4 },
  discountPct: { type: Number, default: 0 },
  freeVisits: { type: Number, default: 0 },
  walletCredit: { type: Number, default: 0 }, // paise, promotional credit usable at counters
  active: { type: Boolean, default: true },
});
planSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const MembershipPlan = defineModel('MembershipPlan', planSchema);

/** A family health card: members, validity, free visits left and the wallet ledger. */
const membershipSchema = new Schema({
  cardNo: { type: String, required: true },
  planId: { type: id, ref: 'MembershipPlan', required: true },
  planName: String,
  discountPct: Number,
  holder: patientSnap,
  members: [patientSnap],
  validFrom: Date,
  validUntil: Date,
  status: { type: String, enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'], default: 'ACTIVE' },
  paymentRef: String, // receipt number of the plan fee
  freeVisitsLeft: { type: Number, default: 0 },
  wallet: { type: Number, default: 0 }, // paise
  ledger: [
    {
      _id: false,
      at: Date,
      kind: { type: String, enum: ['CREDIT', 'DEBIT', 'FREE_VISIT', 'REVERSAL'] },
      amount: Number,
      ref: String,
      by: String,
    },
  ],
});
membershipSchema.index({ tenantId: 1, cardNo: 1 }, { unique: true });
membershipSchema.index({ tenantId: 1, 'members.id': 1, status: 1 });
export const Membership = defineModel('Membership', membershipSchema);

/** Referral fee agreement with a referral source (where policy permits). */
const agreementSchema = new Schema({
  referralSourceId: { type: id, ref: 'ReferralSource', required: true },
  feePct: { type: Number, required: true },
  categories: [String], // bill line categories the fee applies to; empty = all
  active: { type: Boolean, default: true },
  notes: String,
});
agreementSchema.index({ tenantId: 1, referralSourceId: 1 }, { unique: true });
export const ReferralAgreement = defineModel('ReferralAgreement', agreementSchema);

/** Monthly referral statement sent to Finance. */
const statementSchema = new Schema({
  month: { type: String, required: true },
  referralSourceId: { type: id, ref: 'ReferralSource', required: true },
  sourceName: String,
  patients: Number,
  revenue: Number, // paise
  fee: Number, // paise
  status: { type: String, enum: ['DRAFT', 'SENT'], default: 'DRAFT' },
  sentAt: Date,
});
statementSchema.index({ tenantId: 1, month: 1, referralSourceId: 1 }, { unique: true });
export const ReferralStatement = defineModel('ReferralStatement', statementSchema);
