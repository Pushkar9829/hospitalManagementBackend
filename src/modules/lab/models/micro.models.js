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
};

/**
 * Culture and sensitivity (alternate flow H). RECEIVED → PLATED → GROWTH_READ → IDENTIFIED →
 * SENSITIVITY_DONE → FINAL; NO_GROWTH after 48 hours goes straight to FINAL. The final report is
 * written onto the LabItem, which then goes through the normal release (R9).
 */
const cultureSchema = new Schema({
  itemId: { type: id, ref: 'LabItem', required: true },
  orderNo: String,
  sampleNo: String,
  test: String,
  specimen: String,
  patient: patientSnap,
  location: String,
  status: {
    type: String,
    enum: ['RECEIVED', 'PLATED', 'GROWTH_READ', 'IDENTIFIED', 'SENSITIVITY_DONE', 'FINAL'],
    default: 'RECEIVED',
  },
  media: [String],
  platedAt: Date,
  readings: [
    {
      _id: false,
      at: Date,
      hours: Number,
      growth: Boolean,
      text: String,
      by: String,
    },
  ],
  noGrowth: { type: Boolean, default: false },
  organism: String,
  colonyCount: String,
  sensitivity: [
    {
      _id: false,
      antibiotic: String,
      result: { type: String, enum: ['S', 'I', 'R'] },
      mic: String,
    },
  ],
  prelimAt: Date,
  finalAt: Date,
  finalBy: String,
});
cultureSchema.index({ tenantId: 1, status: 1, createdAt: 1 });
cultureSchema.index({ tenantId: 1, itemId: 1 }, { unique: true });
cultureSchema.index({ tenantId: 1, organism: 1, finalAt: -1 });
export const Culture = defineModel('Culture', cultureSchema);

/**
 * Histopathology case (alternate flow I). RECEIVED → GROSSED → PROCESSED → SLIDES → REPORTED;
 * the report is written onto the LabItem for release. Blocks and slides are archived (R17).
 */
const histoSchema = new Schema({
  itemId: { type: id, ref: 'LabItem', required: true },
  caseNo: { type: String, required: true },
  orderNo: String,
  test: String,
  patient: patientSnap,
  location: String,
  clinicalNotes: String,
  status: {
    type: String,
    enum: ['RECEIVED', 'GROSSED', 'PROCESSED', 'SLIDES', 'REPORTED'],
    default: 'RECEIVED',
  },
  specimen: String,
  fixative: { type: String, default: 'Formalin 10%' },
  gross: String,
  blocks: Number,
  slides: Number,
  specialStains: [String],
  microscopy: String,
  diagnosis: String,
  icdO: String,
  synoptic: { type: Map, of: String },
  archive: String, // block and slide cabinet location
  history: [{ _id: false, status: String, at: Date, by: String }],
  /** Blocks and slides issued from the archive (second opinion, review) and returned. */
  archiveLog: [
    {
      _id: false,
      kind: { type: String, enum: ['ISSUE', 'RETURN'] },
      to: String,
      note: String,
      at: Date,
      by: String,
    },
  ],
  reportedAt: Date,
  reportedBy: String,
});
histoSchema.index({ tenantId: 1, status: 1, createdAt: 1 });
histoSchema.index({ tenantId: 1, itemId: 1 }, { unique: true });
histoSchema.index({ tenantId: 1, caseNo: 1 }, { unique: true });
export const HistoCase = defineModel('HistoCase', histoSchema);
