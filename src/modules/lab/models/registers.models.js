import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

/**
 * Laboratory registers (boards Quality control, Laboratory settings, Microbiology, Sample
 * receipt): QC lots, external quality (EQAS) cycles, calibration and maintenance, partner labs
 * and send-out manifests, culture media lots.
 */
const id = Schema.Types.ObjectId;

const lotSchema = new Schema({
  lotNo: { type: String, required: true },
  material: { type: String, required: true },
  level: String,
  analyser: String,
  openedOn: String, // YYYY-MM-DD
  expiresOn: { type: String, required: true },
  active: { type: Boolean, default: true },
});
lotSchema.index({ tenantId: 1, lotNo: 1, level: 1 }, { unique: true });
export const QcLot = defineModel('QcLot', lotSchema);

const eqasSchema = new Schema({
  scheme: { type: String, required: true },
  cycle: { type: String, required: true },
  department: String,
  dueOn: String,
  analytes: Number,
  acceptable: Number,
  status: { type: String, enum: ['DUE', 'SUBMITTED', 'REVIEWED'], default: 'DUE' },
  note: String,
});
eqasSchema.index({ tenantId: 1, scheme: 1, cycle: 1 }, { unique: true });
export const EqasCycle = defineModel('EqasCycle', eqasSchema);

const maintenanceSchema = new Schema({
  equipment: { type: String, required: true },
  activity: { type: String, required: true },
  kind: { type: String, enum: ['CALIBRATION', 'MAINTENANCE'], default: 'MAINTENANCE' },
  doneOn: { type: String, required: true },
  doneBy: String,
  nextDue: String,
  note: String,
});
maintenanceSchema.index({ tenantId: 1, equipment: 1, doneOn: -1 });
export const LabMaintenance = defineModel('LabMaintenance', maintenanceSchema);

const partnerSchema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  nabl: { type: Boolean, default: false },
  contact: String,
  phone: String,
  tatHours: Number,
  tests: [String], // test codes sent there
  active: { type: Boolean, default: true },
});
partnerSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const PartnerLab = defineModel('PartnerLab', partnerSchema);

const sendOutSchema = new Schema({
  manifestNo: { type: String, required: true },
  partnerId: { type: id, ref: 'PartnerLab', required: true },
  partnerName: String,
  samples: [{ _id: false, sampleNo: String, patient: String, uhid: String, tests: [String] }],
  sentAt: { type: Date, default: () => new Date() },
  sentBy: String,
  courier: String,
  status: { type: String, enum: ['SENT', 'RESULTS_RECEIVED'], default: 'SENT' },
  receivedAt: Date,
});
sendOutSchema.index({ tenantId: 1, manifestNo: 1 }, { unique: true });
sendOutSchema.index({ tenantId: 1, status: 1, sentAt: -1 });
export const SendOut = defineModel('SendOut', sendOutSchema);

const mediaSchema = new Schema({
  medium: { type: String, required: true },
  lotNo: { type: String, required: true },
  qcStrain: String,
  result: { type: String, enum: ['PASS', 'FAIL', 'PENDING'], default: 'PENDING' },
  testedOn: String,
  expiresOn: { type: String, required: true },
  note: String,
});
mediaSchema.index({ tenantId: 1, medium: 1, lotNo: 1 }, { unique: true });
export const MediaLot = defineModel('MediaLot', mediaSchema);
