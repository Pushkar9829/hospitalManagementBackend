import { Schema } from 'mongoose';
import { defineModel } from '../db/model.js';

const id = Schema.Types.ObjectId;

/** An export of a report run (XLSX or PDF), kept 7 days. */
const exportSchema = new Schema({
  reportCode: { type: String, required: true },
  reportName: String,
  format: { type: String, enum: ['XLSX', 'PDF'], required: true },
  filters: Schema.Types.Mixed,
  filtersLabel: String,
  rows: Number,
  status: { type: String, enum: ['RUNNING', 'READY', 'FAILED'], default: 'RUNNING' },
  error: String,
  fileId: { type: id, ref: 'StoredFile' },
  requestedAt: { type: Date, default: () => new Date() },
  requestedBy: String,
  requestedById: { type: id, ref: 'User' },
  scheduleId: { type: id, ref: 'ReportSchedule' },
  readyAt: Date,
  expiresAt: Date,
});
exportSchema.index({ tenantId: 1, requestedAt: -1 });
export const ReportExport = defineModel('ReportExport', exportSchema);

/** A report run on a schedule; each run makes an export for the recipients. */
const scheduleSchema = new Schema({
  reportCode: { type: String, required: true },
  reportName: String,
  frequency: { type: String, enum: ['DAILY', 'WEEKLY', 'MONTHLY'], required: true },
  time: { type: String, required: true }, // HH:mm IST
  dayOfWeek: Number, // 0 = Sunday
  dayOfMonth: Number,
  recipients: [String],
  format: { type: String, enum: ['XLSX', 'PDF'], default: 'XLSX' },
  active: { type: Boolean, default: true },
  nextRunAt: Date,
  lastRunAt: Date,
  createdByName: String,
  createdById: { type: id, ref: 'User' },
  permissions: [String], // the creator's permissions when scheduled (runs never see more)
});
scheduleSchema.index({ tenantId: 1, active: 1, nextRunAt: 1 });
export const ReportSchedule = defineModel('ReportSchedule', scheduleSchema);
