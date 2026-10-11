import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/**
 * Employee master (spec "HR management"): job details, statutory numbers, bank, clinical
 * registration with expiry. Aadhaar is never stored in full (last four digits only).
 */
const employeeSchema = new Schema({
  empNo: { type: String, required: true },
  userId: { type: id, ref: 'User' },
  name: { first: { type: String, required: true }, last: String },
  gender: { type: String, enum: ['M', 'F', 'O'] },
  dob: Date,
  mobile: String,
  address: String,
  emergencyContact: { _id: false, name: String, relation: String, mobile: String },
  email: String,
  branchId: { type: id, ref: 'Branch' },
  departmentId: { type: id, ref: 'Department' },
  department: String,
  designation: String,
  grade: String,
  type: {
    type: String,
    enum: ['PERMANENT', 'CONTRACT', 'CONSULTANT', 'TRAINEE'],
    default: 'PERMANENT',
  },
  managerId: { type: id, ref: 'Employee' },
  joinedOn: { type: Date, required: true },
  probationEndsOn: Date,
  status: { type: String, enum: ['ACTIVE', 'NOTICE', 'EXITED'], default: 'ACTIVE' },
  exitOn: Date,
  exitReason: String,
  /** Exit clearances by department (no dues, assets returned). */
  clearance: [{ _id: false, dept: String, by: String, at: Date, note: String }],
  pan: String,
  uan: String,
  esiNo: String,
  aadhaarLast4: String,
  bank: { name: String, accountNo: String, ifsc: String },
  registration: { council: String, number: String, expiresOn: Date },
  state: { type: String, default: 'MH' }, // for Professional Tax
  history: [{ _id: false, at: Date, kind: String, text: String, by: String }],
});
employeeSchema.index({ tenantId: 1, empNo: 1 }, { unique: true });
employeeSchema.index({ tenantId: 1, userId: 1 });
employeeSchema.index({ tenantId: 1, status: 1, departmentId: 1 });
export const Employee = defineModel('Employee', employeeSchema);

/** One per hospital: leave types, shifts and the attendance rules. */
const settingsSchema = new Schema({
  leaveTypes: {
    type: [
      {
        _id: false,
        code: String,
        name: String,
        perYear: Number,
        paid: { type: Boolean, default: true },
        carryForwardMax: { type: Number, default: 0 },
        accrual: { type: String, enum: ['YEARLY', 'MONTHLY'], default: 'YEARLY' },
      },
    ],
    default: [
      {
        code: 'CL',
        name: 'Casual leave',
        perYear: 12,
        paid: true,
        carryForwardMax: 0,
        accrual: 'YEARLY',
      },
      {
        code: 'SL',
        name: 'Sick leave',
        perYear: 12,
        paid: true,
        carryForwardMax: 6,
        accrual: 'YEARLY',
      },
      {
        code: 'EL',
        name: 'Earned leave',
        perYear: 18,
        paid: true,
        carryForwardMax: 45,
        accrual: 'MONTHLY',
      },
      {
        code: 'LOP',
        name: 'Leave without pay',
        perYear: 365,
        paid: false,
        carryForwardMax: 0,
        accrual: 'YEARLY',
      },
    ],
  },
  shifts: {
    type: [{ _id: false, code: String, name: String, start: String, end: String, night: Boolean }],
    default: [
      { code: 'M', name: 'Morning', start: '08:00', end: '14:00', night: false },
      { code: 'E', name: 'Evening', start: '14:00', end: '20:00', night: false },
      { code: 'N', name: 'Night', start: '20:00', end: '08:00', night: true },
      { code: 'G', name: 'General', start: '09:00', end: '17:00', night: false },
    ],
  },
  weekOff: { type: [Number], default: [0] }, // 0 = Sunday, for staff without a roster
  lateGraceMin: { type: Number, default: 15 },
  minPerShift: { type: Number, default: 1 }, // roster cover check for leave
  credentialAlertDays: { type: Number, default: 60 },
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const HrSettings = defineModel('HrSettings', settingsSchema);

const leaveBalanceSchema = new Schema({
  employeeId: { type: id, ref: 'Employee', required: true },
  year: { type: Number, required: true },
  code: { type: String, required: true },
  opening: { type: Number, default: 0 },
  accrued: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
});
leaveBalanceSchema.index({ tenantId: 1, employeeId: 1, year: 1, code: 1 }, { unique: true });
export const LeaveBalance = defineModel('LeaveBalance', leaveBalanceSchema);

/** Leave request: PENDING → APPROVED or REJECTED; CANCELLED by the employee before it starts. */
const leaveSchema = new Schema({
  employeeId: { type: id, ref: 'Employee', required: true },
  empNo: String,
  name: String,
  department: String,
  managerId: { type: id, ref: 'Employee' },
  code: { type: String, required: true },
  from: { type: String, required: true }, // YYYY-MM-DD
  to: { type: String, required: true },
  halfDay: { type: Boolean, default: false },
  days: Number,
  reason: String,
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
    default: 'PENDING',
  },
  decidedBy: String,
  decidedAt: Date,
  decisionNote: String,
});
leaveSchema.index({ tenantId: 1, status: 1, from: 1 });
leaveSchema.index({ tenantId: 1, employeeId: 1, from: 1 });
export const LeaveRequest = defineModel('LeaveRequest', leaveSchema);

/** One row per employee per day; locked months feed payroll (LOP). */
const attendanceSchema = new Schema({
  employeeId: { type: id, ref: 'Employee', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  status: {
    type: String,
    enum: ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'LOP', 'HOLIDAY', 'WEEK_OFF'],
    required: true,
  },
  leaveCode: String,
  shift: String,
  inAt: String, // HH:mm
  outAt: String,
  lateMin: Number,
  overtimeMin: Number,
  source: {
    type: String,
    enum: ['BIOMETRIC', 'WEB', 'MANUAL', 'LEAVE', 'SYSTEM'],
    default: 'MANUAL',
  },
  note: String,
});
attendanceSchema.index({ tenantId: 1, employeeId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ tenantId: 1, date: 1 });
export const Attendance = defineModel('Attendance', attendanceSchema);

const attendanceLockSchema = new Schema({
  month: { type: String, required: true }, // YYYY-MM
  lockedAt: Date,
  lockedBy: String,
});
attendanceLockSchema.index({ tenantId: 1, month: 1 }, { unique: true });
export const AttendanceLock = defineModel('AttendanceLock', attendanceLockSchema);

/** Shift roster: one cell per employee per day in a unit (ward or department). */
const rosterSchema = new Schema({
  unit: { type: String, required: true }, // ward or department name
  employeeId: { type: id, ref: 'Employee', required: true },
  date: { type: String, required: true },
  shift: { type: String, required: true }, // shift code or OFF
});
rosterSchema.index({ tenantId: 1, employeeId: 1, date: 1 }, { unique: true });
rosterSchema.index({ tenantId: 1, unit: 1, date: 1 });
export const RosterCell = defineModel('RosterCell', rosterSchema);

/** Shift swap between two employees, approved by the in-charge. */
const swapSchema = new Schema({
  unit: String,
  date: String,
  fromId: { type: id, ref: 'Employee', required: true },
  toId: { type: id, ref: 'Employee', required: true },
  fromShift: String,
  toShift: String,
  reason: String,
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  decidedBy: String,
});
export const ShiftSwap = defineModel('ShiftSwap', swapSchema);
