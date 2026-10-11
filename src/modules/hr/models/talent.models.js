import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/** A vacancy being recruited for. */
const openingSchema = new Schema({
  code: String,
  title: { type: String, required: true },
  departmentId: { type: id, ref: 'Department' },
  department: String,
  type: { type: String, default: 'PERMANENT' },
  positions: { type: Number, default: 1 },
  description: String,
  status: { type: String, enum: ['OPEN', 'ON_HOLD', 'CLOSED'], default: 'OPEN' },
});
openingSchema.index({ tenantId: 1, status: 1 });
export const JobOpening = defineModel('JobOpening', openingSchema);

export const STAGES = ['APPLIED', 'SCREENED', 'INTERVIEW', 'OFFERED', 'JOINED', 'REJECTED'];

/** A candidate for an opening, moved through the stages; hiring creates the employee. */
const candidateSchema = new Schema({
  openingId: { type: id, ref: 'JobOpening', required: true },
  name: { type: String, required: true },
  mobile: String,
  email: String,
  source: String,
  experienceYears: Number,
  stage: { type: String, enum: STAGES, default: 'APPLIED' },
  interviews: [{ _id: false, at: Date, by: String, rating: Number, notes: String }],
  offer: { _id: false, ctc: Number, joinOn: String },
  employeeId: { type: id, ref: 'Employee' },
  log: [{ _id: false, at: Date, stage: String, by: String, note: String }],
});
candidateSchema.index({ tenantId: 1, openingId: 1, stage: 1 });
export const Candidate = defineModel('Candidate', candidateSchema);

/** A training session and who attended; mandatory topics are valid for a set number of months. */
const trainingSchema = new Schema({
  title: { type: String, required: true },
  topic: { type: String, required: true }, // e.g. BLS, FIRE, INFECTION
  mandatory: { type: Boolean, default: false },
  validMonths: Number,
  date: { type: String, required: true },
  hours: Number,
  trainer: String,
  attendees: [
    {
      _id: false,
      employeeId: { type: id, ref: 'Employee' },
      name: String,
      attended: { type: Boolean, default: true },
      score: Number,
    },
  ],
});
trainingSchema.index({ tenantId: 1, date: -1 });
trainingSchema.index({ tenantId: 1, 'attendees.employeeId': 1, topic: 1 });
export const TrainingSession = defineModel('TrainingSession', trainingSchema);

/** An appraisal cycle (e.g. FY 2026-27); opening it creates one appraisal per active employee. */
const cycleSchema = new Schema({
  name: { type: String, required: true },
  from: String,
  to: String,
  status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
});
export const AppraisalCycle = defineModel('AppraisalCycle', cycleSchema);

/** One employee's appraisal: self review, then the manager's, then HR closes it. */
const appraisalSchema = new Schema({
  cycleId: { type: id, ref: 'AppraisalCycle', required: true },
  employeeId: { type: id, ref: 'Employee', required: true },
  name: String,
  empNo: String,
  designation: String,
  managerId: { type: id, ref: 'Employee' },
  managerName: String,
  goals: [{ _id: false, title: String, weight: Number, self: Number, manager: Number }],
  selfComments: String,
  managerComments: String,
  selfRating: Number,
  managerRating: Number,
  finalRating: Number,
  status: { type: String, enum: ['SELF', 'MANAGER', 'HR', 'DONE'], default: 'SELF' },
});
appraisalSchema.index({ tenantId: 1, cycleId: 1, employeeId: 1 }, { unique: true });
appraisalSchema.index({ tenantId: 1, managerId: 1, status: 1 });
export const Appraisal = defineModel('Appraisal', appraisalSchema);
