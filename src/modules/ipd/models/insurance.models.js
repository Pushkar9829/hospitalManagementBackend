import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/**
 * Cashless case for one stay (IPD lifecycle "Pre-authorisation"): SENT → APPROVED → (ENHANCEMENT
 * sent and replied) → FINAL_SENT → FINAL_APPROVED → CLAIMED → SETTLED, with QUERY and DENIED on
 * the way. IRDAI (May 2024): the insurer replies to a cashless request within 1 h and gives the
 * final discharge approval within 3 h; `replyDueAt` carries the clock.
 */
const preAuthSchema = new Schema({
  admissionId: { type: id, ref: 'Admission', required: true },
  ipNo: String,
  patient: { id: { type: id, ref: 'Patient' }, name: String, uhid: String },
  payer: { id: { type: id, ref: 'Payer' }, name: String, kind: String },
  policyNo: String,
  memberId: String,
  diagnosis: String,
  plannedTreatment: String,
  status: {
    type: String,
    enum: [
      'SENT',
      'QUERY',
      'APPROVED',
      'DENIED',
      'ENHANCEMENT_SENT',
      'FINAL_SENT',
      'FINAL_APPROVED',
      'CLAIMED',
      'SETTLED',
    ],
    default: 'SENT',
  },
  requested: { type: Number, default: 0 }, // paise
  approved: { type: Number, default: 0 },
  finalApproved: Number,
  patientShare: Number,
  settled: Number,
  deductions: [{ _id: false, reason: String, amount: Number }],
  claim: { no: String, filedAt: Date },
  settlement: { utr: String, at: Date },
  replyDueAt: Date,
  enhancementSuggestedAt: Date,
  events: [
    {
      _id: false,
      at: Date,
      kind: String, // SENT, QUERY, APPROVED, DENIED, ENHANCEMENT, FINAL_SENT, FINAL_APPROVED, CLAIMED, SETTLED
      amount: Number,
      text: String,
      by: String,
    },
  ],
});
preAuthSchema.index({ tenantId: 1, status: 1, replyDueAt: 1 });
preAuthSchema.index({ tenantId: 1, admissionId: 1 });
export const PreAuth = defineModel('PreAuth', preAuthSchema);
