import { z } from 'zod';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Employee, daysOfMonth, employeeOut, payInputs } from '../../hr/index.js';
import {
  DEFAULT_STATUTORY,
  declaredOtherDeductions,
  esi,
  monthlyTds,
  pf,
  pt,
} from '../data/statutory.js';
import {
  Loan,
  PayrollRun,
  PayrollSettings,
  Payslip,
  SalaryStructure,
  TaxDeclaration,
} from '../models/payroll.models.js';

const paise = z.number().int().min(0).max(1_00_00_000_00);
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const rupee = (p) => Math.round(p / 100) * 100;
/** Financial year of a YYYY-MM month: April to March, "2026-27". */
export const financialYearOf = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const start = mo >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const istDay = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);

async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

export async function statutory() {
  const s = await PayrollSettings.findOne().lean();
  return { ...DEFAULT_STATUTORY, ...(s?.statutory ?? {}) };
}

export const settingsInput = z.object({
  pf: z
    .object({
      employeeRate: z.number(),
      employerRate: z.number(),
      wageCeiling: paise,
      applyCeiling: z.boolean(),
    })
    .partial()
    .optional(),
  esi: z
    .object({ employeeRate: z.number(), employerRate: z.number(), wageLimit: paise })
    .partial()
    .optional(),
  overtimeMultiplier: z.number().min(1).max(3).optional(),
  nightAllowance: paise.optional(),
});

export async function saveSettings(input) {
  const cur = await statutory();
  const next = {
    ...cur,
    ...input,
    pf: { ...cur.pf, ...(input.pf ?? {}) },
    esi: { ...cur.esi, ...(input.esi ?? {}) },
  };
  const s = (await PayrollSettings.findOne()) ?? new PayrollSettings({});
  s.statutory = next;
  s.markModified('statutory');
  await s.save();
  return next;
}

// ---------------------------------------------------------------- salary structures

export const structureInput = z.object({
  effectiveFrom: month,
  basic: paise,
  da: paise.default(0),
  hra: paise.default(0),
  conveyance: paise.default(0),
  special: paise.default(0),
  allowances: z
    .array(
      z.object({
        code: z.string().trim().toUpperCase().max(10),
        name: z.string().trim().max(40),
        amount: paise,
      }),
    )
    .max(10)
    .default([]),
  pf: z.boolean().default(true),
  esi: z.boolean().default(true),
  pt: z.boolean().default(true),
  tdsRegime: z.enum(['NEW', 'OLD']).default('NEW'),
  declarations80C: z.number().int().min(0).max(1_00_00_000).default(0),
  reason: z.string().trim().max(200).optional(),
});

const fixedTotal = (s) =>
  s.basic +
  s.da +
  s.hra +
  s.conveyance +
  s.special +
  (s.allowances ?? []).reduce((t, a) => t + a.amount, 0);

const structureOut = (s) => ({
  id: String(s._id),
  employeeId: String(s.employeeId),
  effectiveFrom: s.effectiveFrom,
  basic: s.basic,
  da: s.da,
  hra: s.hra,
  conveyance: s.conveyance,
  special: s.special,
  allowances: s.allowances ?? [],
  monthlyGross: fixedTotal(s),
  pf: s.pf,
  esi: s.esi,
  pt: s.pt,
  tdsRegime: s.tdsRegime,
  declarations80C: s.declarations80C,
  status: s.status,
  approvalId: s.approvalId ? String(s.approvalId) : null,
  reason: s.reason ?? null,
  createdAt: s.createdAt,
});

/** A new salary (or a revision) goes through hr.salaryChange: HR Manager, then Super Admin. */
export async function proposeStructure(employeeId, input, res) {
  const e = await Employee.findById(employeeId).lean();
  if (!e) throw errors.notFound('Employee');
  if (await PayrollRun.exists({ month: { $gte: input.effectiveFrom }, status: 'LOCKED' }))
    throw new AppError(
      409,
      'MONTH_LOCKED',
      'Payroll is locked for that month; revise from a later month (arrears).',
    );
  const before = await activeStructure(employeeId, input.effectiveFrom);
  const [s] = await SalaryStructure.create([{ employeeId, ...input }]);
  const approval = await requestApproval({
    action: 'hr.salaryChange',
    module: 'HRM',
    entity: 'SalaryStructure',
    entityId: s._id,
    title: `Salary ${before ? 'revision' : 'structure'} · ${e.name.first} ${e.name.last ?? ''} (${e.empNo}) from ${input.effectiveFrom}`,
    before: before ? { monthlyGross: fixedTotal(before) } : {},
    after: { monthlyGross: fixedTotal(input) },
    payload: { structureId: String(s._id) },
    metrics: { amount: fixedTotal(input) },
    reason: input.reason || (before ? 'Salary revision' : 'New salary structure'),
  });
  if (approval) {
    s.approvalId = approval._id;
    await s.save();
    if (res) res.locals.status = 202;
  } else {
    s.status = 'ACTIVE';
    await s.save();
  }
  return structureOut(s.toObject());
}

onApprovalDecided('hr.salaryChange', async (req, outcome) => {
  const s = await SalaryStructure.findById(req.payload.structureId);
  if (!s || s.status !== 'PENDING_APPROVAL') return;
  s.status = outcome === 'APPROVED' ? 'ACTIVE' : 'REJECTED';
  await s.save();
});

export async function activeStructure(employeeId, forMonth) {
  return SalaryStructure.findOne({
    employeeId,
    status: 'ACTIVE',
    effectiveFrom: { $lte: forMonth },
  })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .lean();
}

export async function structures(employeeId) {
  const rows = await SalaryStructure.find({ employeeId })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .lean();
  return { items: rows.map(structureOut) };
}

// ---------------------------------------------------------------- loans

export const loanInput = z.object({
  kind: z.enum(['ADVANCE', 'LOAN']).default('LOAN'),
  amount: paise.refine((v) => v > 0, 'Enter the amount'),
  emi: paise.refine((v) => v > 0, 'Enter the instalment'),
  startMonth: month,
});

export async function createLoan(employeeId, input) {
  if (input.emi > input.amount)
    throw errors.validation([{ path: 'emi', message: 'The instalment is more than the loan' }]);
  return withTransaction(async () => {
    const [l] = await Loan.create([{ employeeId, ...input, balance: input.amount }]);
    // Paid out from the bank; Finance posts it to staff loans (recoveries come with payroll).
    await publish('payroll.loan.disbursed', {
      loanId: String(l._id),
      employeeId: String(employeeId),
      kind: l.kind,
      amount: l.amount,
    });
    return { id: String(l._id), ...input, balance: l.balance, status: l.status };
  });
}

export async function loans(employeeId) {
  const rows = await Loan.find({ employeeId }).sort({ createdAt: -1 }).lean();
  return {
    items: rows.map((l) => ({
      id: String(l._id),
      kind: l.kind,
      amount: l.amount,
      emi: l.emi,
      startMonth: l.startMonth,
      balance: l.balance,
      status: l.status,
      recoveries: l.recoveries,
    })),
  };
}

// ---------------------------------------------------------------- runs

const runOut = (r) => ({
  id: String(r._id),
  month: r.month,
  status: r.status,
  inputs: (r.inputs ?? []).map((i) => ({ ...i, employeeId: String(i.employeeId) })),
  totals: r.totals ?? null,
  approvalId: r.approvalId ? String(r.approvalId) : null,
  calculatedAt: r.calculatedAt ?? null,
  calculatedBy: r.calculatedBy ?? null,
  lockedAt: r.lockedAt ?? null,
  returnedReason: r.returnedReason ?? null,
});

export async function listRuns() {
  const rows = await PayrollRun.find({}).sort({ month: -1 }).limit(36).lean();
  return { items: rows.map(runOut) };
}

async function findRun(id) {
  const r = await PayrollRun.findById(id);
  if (!r) throw errors.notFound('Payroll run');
  return r;
}

export async function getRun(id) {
  return runOut((await findRun(id)).toObject());
}

/** Starts a month's run; HR must have locked that month's attendance (LOP comes from it). */
export async function createRun({ month: m }) {
  await payInputs(m); // throws ATTENDANCE_NOT_LOCKED
  if (await PayrollRun.exists({ month: m }))
    throw errors.conflict('RUN_EXISTS', `There is already a run for ${m}`);
  const [r] = await PayrollRun.create([{ month: m }]);
  return runOut(r.toObject());
}

export const inputsInput = z.object({
  inputs: z
    .array(
      z.object({
        employeeId: z.string(),
        overtimeHours: z.number().min(0).max(300).optional(),
        incentive: paise.optional(),
        arrears: paise.optional(),
        otherDeduction: paise.optional(),
        note: z.string().trim().max(120).optional(),
      }),
    )
    .max(5000),
});

export async function setInputs(id, { inputs }) {
  const r = await findRun(id);
  if (!['DRAFT', 'CALCULATED', 'RETURNED'].includes(r.status))
    throw new AppError(409, 'INVALID_STATE', 'The run is submitted or locked.');
  r.inputs = inputs;
  r.status = 'DRAFT';
  await r.save();
  return runOut(r.toObject());
}

/** One employee's payslip for the month (all paise). */
export function computeSlip({
  structure: s,
  employee,
  days,
  employedDays,
  lop,
  attendance,
  input,
  stat,
  month: m,
  loanEmi,
  declaration,
}) {
  const payable = Math.max(0, employedDays - lop);
  const factor = payable / days;
  const earnings = [];
  const add = (code, name, amount) =>
    amount > 0 && earnings.push({ code, name, amount: rupee(amount) });
  add('BASIC', 'Basic', s.basic * factor);
  add('DA', 'Dearness allowance', s.da * factor);
  add('HRA', 'House rent allowance', s.hra * factor);
  add('CONV', 'Conveyance', s.conveyance * factor);
  add('SPECIAL', 'Special allowance', s.special * factor);
  for (const a of s.allowances ?? []) add(a.code, a.name, a.amount * factor);
  const otHours = input?.overtimeHours ?? Math.floor((attendance?.overtimeMin ?? 0) / 60);
  add('OT', 'Overtime', otHours * ((s.basic + s.da) / 26 / 8) * stat.overtimeMultiplier);
  add('NIGHT', 'Night shift allowance', (attendance?.nights ?? 0) * stat.nightAllowance);
  add('INCENTIVE', 'Incentive', input?.incentive ?? 0);
  add('ARREARS', 'Arrears', input?.arrears ?? 0);
  const gross = earnings.reduce((t, e) => t + e.amount, 0);

  const deductions = [];
  const employer = [];
  const ded = (code, name, amount) => amount > 0 && deductions.push({ code, name, amount });
  if (s.pf) {
    const p = pf(rupee((s.basic + s.da) * factor), stat.pf);
    ded('PF', 'Provident fund', p.employee);
    employer.push({ code: 'PF_ER', name: 'Employer PF', amount: p.employer });
  }
  if (s.esi) {
    const e = esi(gross, stat.esi);
    ded('ESI', 'ESI', e.employee);
    if (e.employer) employer.push({ code: 'ESI_ER', name: 'Employer ESI', amount: e.employer });
  }
  if (s.pt)
    ded(
      'PT',
      'Professional tax',
      pt(gross, { state: employee.state, gender: employee.gender, month: m.slice(5) }, stat.pt),
    );
  ded(
    'TDS',
    'Income tax (TDS)',
    monthlyTds(
      gross,
      declaration
        ? {
            regime: declaration.regime,
            deductions80C: declaration.deductions80C,
            otherDeductions: declaredOtherDeductions(declaration, {
              basicDaMonthly: (s.basic + s.da) / 100,
              hraMonthly: s.hra / 100,
            }),
          }
        : { regime: s.tdsRegime, deductions80C: s.declarations80C },
      stat.tds,
    ),
  );
  ded('LOAN', 'Loan / advance recovery', loanEmi ?? 0);
  ded('OTHER', 'Other deductions', input?.otherDeduction ?? 0);
  const totalDeductions = deductions.reduce((t, d) => t + d.amount, 0);
  return {
    payableDays: payable,
    earnings,
    deductions,
    employer,
    gross,
    totalDeductions,
    net: gross - totalDeductions,
  };
}

/** Calculates every payslip of the run from salary structures and locked attendance. */
export async function calculate(id) {
  const r = await findRun(id);
  if (!['DRAFT', 'CALCULATED', 'RETURNED'].includes(r.status))
    throw new AppError(409, 'INVALID_STATE', 'The run is submitted or locked.');
  const stat = await statutory();
  const { days: nDays, byEmployee } = await payInputs(r.month);
  const days = daysOfMonth(r.month);
  const first = days[0];
  const last = days.at(-1);
  const emps = await Employee.find({
    joinedOn: { $lte: new Date(`${last}T23:59:59+05:30`) },
    $or: [{ exitOn: null }, { exitOn: { $gte: new Date(`${first}T00:00:00+05:30`) } }],
  }).lean();
  const prevMonth = (() => {
    const [y, m] = r.month.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  })();
  const by = await userName();
  const missing = [];
  return withTransaction(async () => {
    await Payslip.deleteMany({ runId: r._id });
    const totals = {
      employees: 0,
      gross: 0,
      deductions: 0,
      net: 0,
      pfEmployee: 0,
      pfEmployer: 0,
      esiEmployee: 0,
      esiEmployer: 0,
      pt: 0,
      tds: 0,
      loans: 0,
      other: 0,
    };
    for (const e of emps) {
      const s = await activeStructure(e._id, r.month);
      if (!s) {
        missing.push(e.empNo);
        continue;
      }
      const joined = istDay(e.joinedOn);
      const exited = e.exitOn ? istDay(e.exitOn) : null;
      const employedDays = days.filter((d) => d >= joined && (!exited || d <= exited)).length;
      const loan = await Loan.findOne({
        employeeId: e._id,
        status: 'ACTIVE',
        startMonth: { $lte: r.month },
      }).lean();
      const slip = computeSlip({
        structure: s,
        employee: e,
        days: nDays,
        employedDays,
        lop: byEmployee.get(String(e._id))?.lop ?? 0,
        attendance: byEmployee.get(String(e._id)),
        input: r.inputs.find((i) => String(i.employeeId) === String(e._id)),
        stat,
        month: r.month,
        loanEmi: loan ? Math.min(loan.emi, loan.balance) : 0,
        declaration: await TaxDeclaration.findOne({
          employeeId: e._id,
          fy: financialYearOf(r.month),
          status: { $ne: 'REJECTED' },
        }).lean(),
      });
      const last1 = await Payslip.findOne({ employeeId: e._id, month: prevMonth })
        .select('net')
        .lean();
      const o = employeeOut(e);
      await Payslip.create([
        {
          runId: r._id,
          month: r.month,
          employeeId: e._id,
          empNo: e.empNo,
          name: o.name,
          department: e.department,
          designation: e.designation,
          pan: e.pan,
          uan: e.uan,
          bank: e.bank,
          days: nDays,
          lop: byEmployee.get(String(e._id))?.lop ?? 0,
          ...slip,
          lastNet: last1?.net,
          variancePct: last1?.net
            ? Math.round(((slip.net - last1.net) * 1000) / last1.net) / 10
            : null,
        },
      ]);
      const amt = (list, code) => list.find((x) => x.code === code)?.amount ?? 0;
      totals.employees += 1;
      totals.gross += slip.gross;
      totals.deductions += slip.totalDeductions;
      totals.net += slip.net;
      totals.pfEmployee += amt(slip.deductions, 'PF');
      totals.pfEmployer += amt(slip.employer, 'PF_ER');
      totals.esiEmployee += amt(slip.deductions, 'ESI');
      totals.esiEmployer += amt(slip.employer, 'ESI_ER');
      totals.pt += amt(slip.deductions, 'PT');
      totals.tds += amt(slip.deductions, 'TDS');
      totals.loans += amt(slip.deductions, 'LOAN');
      totals.other += amt(slip.deductions, 'OTHER');
    }
    r.totals = totals;
    r.status = 'CALCULATED';
    r.calculatedAt = new Date();
    r.calculatedBy = by;
    r.returnedReason = undefined;
    await r.save();
    return { ...runOut(r.toObject()), withoutSalary: missing };
  });
}

/** Submits for release: HR Manager, then the Finance Controller (payroll.release). */
export async function submit(id, res) {
  const r = await findRun(id);
  if (r.status !== 'CALCULATED')
    throw new AppError(409, 'INVALID_STATE', 'Calculate the run before submitting.');
  const approval = await requestApproval({
    action: 'payroll.release',
    module: 'PAY',
    entity: 'PayrollRun',
    entityId: r._id,
    title: `Payroll ${r.month} · ${r.totals.employees} employees`,
    before: {},
    after: { net: r.totals.net, gross: r.totals.gross },
    payload: { runId: String(r._id) },
    metrics: { amount: r.totals.net },
    reason: `Salary for ${r.month}`,
  });
  r.status = 'SUBMITTED';
  if (approval) {
    r.approvalId = approval._id;
    await r.save();
    if (res) res.locals.status = 202;
    return runOut(r.toObject());
  }
  await r.save();
  await lock(r);
  return runOut(r.toObject());
}

/** Released: loans recovered, the month locked, the journal goes to Finance. */
async function lock(r) {
  await withTransaction(async () => {
    const slips = await Payslip.find({ runId: r._id }).lean();
    for (const s of slips) {
      const rec = s.deductions.find((d) => d.code === 'LOAN')?.amount ?? 0;
      if (!rec) continue;
      const loan = await Loan.findOne({ employeeId: s.employeeId, status: 'ACTIVE' });
      if (!loan) continue;
      loan.balance -= rec;
      loan.recoveries.push({ month: r.month, amount: rec });
      if (loan.balance <= 0) loan.status = 'CLOSED';
      await loan.save();
    }
    r.status = 'LOCKED';
    r.lockedAt = new Date();
    await r.save();
    await publish('payroll.locked', { runId: String(r._id), month: r.month, totals: r.totals });
  });
}

onApprovalDecided('payroll.release', async (req, outcome) => {
  const r = await PayrollRun.findById(req.payload.runId);
  if (!r || r.status !== 'SUBMITTED') return;
  if (outcome === 'APPROVED') await lock(r);
  else {
    r.status = 'RETURNED';
    r.returnedReason = req.decisions?.at?.(-1)?.comment ?? 'Returned by the approver';
    await r.save();
  }
});

const slipOut = (p) => ({
  id: String(p._id),
  month: p.month,
  employeeId: String(p.employeeId),
  empNo: p.empNo,
  name: p.name,
  department: p.department ?? null,
  designation: p.designation ?? null,
  pan: p.pan ?? null,
  uan: p.uan ?? null,
  bank: p.bank?.accountNo
    ? { name: p.bank.name, ifsc: p.bank.ifsc, accountNo: `XXXX${p.bank.accountNo.slice(-4)}` }
    : null,
  days: p.days,
  lop: p.lop,
  payableDays: p.payableDays,
  earnings: p.earnings,
  deductions: p.deductions,
  employer: p.employer,
  gross: p.gross,
  totalDeductions: p.totalDeductions,
  net: p.net,
  lastNet: p.lastNet ?? null,
  variancePct: p.variancePct ?? null,
});

export async function payslips(runId) {
  const rows = await Payslip.find({ runId }).sort({ empNo: 1 }).lean();
  return { items: rows.map(slipOut) };
}

/** My payslips (self-service): only from locked months. */
export async function myPayslips(employeeId) {
  const locked = new Set(
    (await PayrollRun.find({ status: 'LOCKED' }).select('_id').lean()).map((r) => String(r._id)),
  );
  const rows = await Payslip.find({ employeeId }).sort({ month: -1 }).limit(24).lean();
  return { items: rows.filter((p) => locked.has(String(p.runId))).map(slipOut) };
}

/** Bank transfer file for a locked run: account, IFSC, name, net amount in rupees. */
export async function bankFile(runId) {
  const r = await findRun(runId);
  if (r.status !== 'LOCKED')
    throw new AppError(409, 'INVALID_STATE', 'The bank file is made after the run is locked.');
  const rows = await Payslip.find({ runId, net: { $gt: 0 } })
    .sort({ empNo: 1 })
    .lean();
  const noBank = rows.filter((p) => !p.bank?.accountNo).map((p) => p.empNo);
  const lines = [
    'Employee No,Name,Account No,IFSC,Amount',
    ...rows
      .filter((p) => p.bank?.accountNo)
      .map((p) =>
        [p.empNo, `"${p.name}"`, p.bank.accountNo, p.bank.ifsc, (p.net / 100).toFixed(2)].join(','),
      ),
  ];
  return {
    csv: lines.join('\n'),
    count: rows.length - noBank.length,
    total: rows.reduce((t, p) => t + p.net, 0),
    noBank,
  };
}

/** PF ECR rows: UAN, name, gross wage, EPF wage, contributions (rupees). */
export async function pfEcr(runId) {
  const rows = await Payslip.find({ runId }).sort({ empNo: 1 }).lean();
  return {
    items: rows
      .filter((p) => p.deductions.some((d) => d.code === 'PF'))
      .map((p) => {
        const ee = p.deductions.find((d) => d.code === 'PF').amount;
        return {
          uan: p.uan ?? null,
          name: p.name,
          gross: p.gross / 100,
          epfWage: Math.round(ee / 0.12) / 100,
          employee: ee / 100,
          employer: (p.employer.find((x) => x.code === 'PF_ER')?.amount ?? 0) / 100,
        };
      }),
  };
}
