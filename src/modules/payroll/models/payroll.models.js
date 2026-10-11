import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;
const money = { type: Number, default: 0 };

/** One per hospital: statutory tables and allowances (DEFAULT_STATUTORY until edited). */
const settingsSchema = new Schema({ statutory: Schema.Types.Mixed });
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const PayrollSettings = defineModel('PayrollSettings', settingsSchema);

/**
 * An employee's salary, monthly amounts in paise, from a month on. A new structure (and any
 * change) waits for the hr.salaryChange approval; the active one is the latest effective.
 */
const structureSchema = new Schema({
  employeeId: { type: id, ref: 'Employee', required: true },
  effectiveFrom: { type: String, required: true }, // YYYY-MM
  basic: money,
  da: money,
  hra: money,
  conveyance: money,
  special: money,
  allowances: [{ _id: false, code: String, name: String, amount: Number }],
  pf: { type: Boolean, default: true },
  esi: { type: Boolean, default: true },
  pt: { type: Boolean, default: true },
  tdsRegime: { type: String, enum: ['NEW', 'OLD'], default: 'NEW' },
  declarations80C: money, // rupees a year (old regime)
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED'],
    default: 'PENDING_APPROVAL',
  },
  approvalId: { type: id, ref: 'ApprovalRequest' },
  reason: String,
});
structureSchema.index({ tenantId: 1, employeeId: 1, effectiveFrom: -1 });
export const SalaryStructure = defineModel('SalaryStructure', structureSchema);

/** Salary advance or loan recovered in monthly instalments. */
const loanSchema = new Schema({
  employeeId: { type: id, ref: 'Employee', required: true },
  kind: { type: String, enum: ['ADVANCE', 'LOAN'], default: 'LOAN' },
  amount: { type: Number, required: true },
  emi: { type: Number, required: true },
  startMonth: { type: String, required: true },
  balance: { type: Number, required: true },
  status: { type: String, enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE' },
  recoveries: [{ _id: false, month: String, amount: Number }],
});
export const Loan = defineModel('Loan', loanSchema);

/**
 * Monthly run: DRAFT → CALCULATED → SUBMITTED → (HR, then Finance) → LOCKED; RETURNED when an
 * approver sends it back. A locked month is never changed; corrections are arrears next month.
 */
const runSchema = new Schema({
  month: { type: String, required: true },
  status: {
    type: String,
    enum: ['DRAFT', 'CALCULATED', 'SUBMITTED', 'RETURNED', 'LOCKED'],
    default: 'DRAFT',
  },
  inputs: [
    {
      _id: false,
      employeeId: { type: id, ref: 'Employee' },
      overtimeHours: Number,
      incentive: Number,
      arrears: Number,
      otherDeduction: Number,
      note: String,
    },
  ],
  totals: {
    employees: Number,
    gross: Number,
    deductions: Number,
    net: Number,
    pfEmployee: Number,
    pfEmployer: Number,
    esiEmployee: Number,
    esiEmployer: Number,
    pt: Number,
    tds: Number,
    loans: Number,
    other: Number,
  },
  approvalId: { type: id, ref: 'ApprovalRequest' },
  calculatedAt: Date,
  calculatedBy: String,
  lockedAt: Date,
  returnedReason: String,
});
runSchema.index({ tenantId: 1, month: 1 }, { unique: true });
export const PayrollRun = defineModel('PayrollRun', runSchema);

const line = { _id: false, code: String, name: String, amount: Number };
const payslipSchema = new Schema({
  runId: { type: id, ref: 'PayrollRun', required: true },
  month: String,
  employeeId: { type: id, ref: 'Employee', required: true },
  empNo: String,
  name: String,
  department: String,
  designation: String,
  pan: String,
  uan: String,
  bank: { name: String, accountNo: String, ifsc: String },
  days: Number,
  lop: Number,
  payableDays: Number,
  earnings: [line],
  deductions: [line],
  employer: [line],
  gross: Number,
  totalDeductions: Number,
  net: Number,
  lastNet: Number,
  variancePct: Number,
});
payslipSchema.index({ tenantId: 1, runId: 1, employeeId: 1 }, { unique: true });
payslipSchema.index({ tenantId: 1, employeeId: 1, month: -1 });
export const Payslip = defineModel('Payslip', payslipSchema);

/**
 * An employee's income-tax declaration for a financial year (board My Space, "Tax declaration"):
 * the regime and old-regime deductions. Payroll uses it for TDS unless payroll rejects it.
 */
const declarationSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  fy: { type: String, required: true }, // "2026-27"
  regime: { type: String, enum: ['NEW', 'OLD'], default: 'NEW' },
  rentMonthly: money, // rupees
  deductions80C: money, // rupees a year
  deductions80D: money, // rupees a year
  status: { type: String, enum: ['SUBMITTED', 'VERIFIED', 'REJECTED'], default: 'SUBMITTED' },
  reviewedBy: String,
  reviewNote: String,
});
declarationSchema.index({ tenantId: 1, employeeId: 1, fy: 1 }, { unique: true });
export const TaxDeclaration = defineModel('TaxDeclaration', declarationSchema);
