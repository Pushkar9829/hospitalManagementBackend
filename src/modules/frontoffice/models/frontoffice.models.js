import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/** A service counter with its own token series (Registration R-, Billing B-, Pharmacy P- ...). */
const counterSchema = new Schema({
  name: { type: String, required: true },
  prefix: { type: String, required: true }, // "B-"
  branchId: { type: id, ref: 'Branch' },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
});
counterSchema.index({ tenantId: 1, branchId: 1, name: 1 }, { unique: true });
export const FoCounter = defineModel('FoCounter', counterSchema);

/** One counter token for the day. WAITING → CALLED → DONE (or SKIPPED). */
const tokenSchema = new Schema({
  counterId: { type: id, ref: 'FoCounter', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD IST
  no: { type: String, required: true }, // "B-119"
  seq: { type: Number, required: true },
  name: String,
  mobile: String,
  status: { type: String, enum: ['WAITING', 'CALLED', 'DONE', 'SKIPPED'], default: 'WAITING' },
  calledAt: Date,
  doneAt: Date,
});
tokenSchema.index({ tenantId: 1, counterId: 1, date: 1, seq: 1 }, { unique: true });
tokenSchema.index({ tenantId: 1, counterId: 1, date: 1, status: 1 });
export const FoToken = defineModel('FoToken', tokenSchema);

/** Phone, walk-in and WhatsApp enquiries with what came of them. */
const enquirySchema = new Schema({
  at: { type: Date, required: true },
  date: { type: String, required: true },
  caller: String,
  mobile: String,
  topic: { type: String, required: true },
  category: String, // DOCTOR, PACKAGE, TARIFF, BED, VISITING, OTHER
  channel: { type: String, enum: ['PHONE', 'WALK_IN', 'WHATSAPP', 'EMAIL'], required: true },
  outcome: { type: String, enum: ['ANSWERED', 'BOOKED', 'LEAD', 'FOLLOW_UP'], required: true },
  notes: String,
});
enquirySchema.index({ tenantId: 1, date: -1 });
export const Enquiry = defineModel('Enquiry', enquirySchema);

/**
 * Attendant (24 h) and visitor (visiting hours) passes with a QR code. Revoked automatically at
 * discharge once IPD publishes it; until then the desk marks visitors out.
 */
const passSchema = new Schema({
  passNo: { type: String, required: true },
  patient: {
    id: { type: id, ref: 'Patient', required: true },
    uhid: String,
    name: String,
  },
  bed: String,
  visitor: { name: { type: String, required: true }, relation: String, mobile: String },
  type: { type: String, enum: ['ATTENDANT', 'VISITOR'], required: true },
  qr: { type: String, required: true },
  validUntil: { type: Date, required: true },
  status: { type: String, enum: ['INSIDE', 'OUT', 'REVOKED', 'EXPIRED'], default: 'INSIDE' },
  inAt: { type: Date, required: true },
  outAt: Date,
});
passSchema.index({ tenantId: 1, status: 1, inAt: -1 });
passSchema.index({ tenantId: 1, 'patient.id': 1, status: 1 });
passSchema.index({ tenantId: 1, qr: 1 }, { unique: true });
export const VisitorPass = defineModel('VisitorPass', passSchema);
