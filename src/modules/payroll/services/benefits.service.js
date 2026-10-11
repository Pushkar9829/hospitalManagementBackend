import { z } from 'zod';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { Employee } from '../../hr/index.js';
import { BonusRun, PayrollRun, Payslip } from '../models/payroll.models.js';
import { activeStructure, financialYearOf } from './payroll.service.js';

const DAY = 86_400_000;
const ymd = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const nameOf = (e) => `${e.name.first}${e.name.last ? ` ${e.name.last}` : ''}`;

// ---------------------------------------------------------------- gratuity

/** Payment of Gratuity Act, 1972 (as amended): ceiling ₹20 lakh, payable after 5 years. */
export const GRATUITY = { ceiling: 20_00_000_00, minYears: 5 };

/**
 * Completed years of service for gratuity: whole years, and a part year of more than six months
 * counts as one more.
 */
export function serviceYears(joinedOn, asOf) {
  const from = new Date(joinedOn);
  const to = new Date(asOf);
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const anniversary = new Date(from);
  anniversary.setUTCFullYear(from.getUTCFullYear() + years);
  if (anniversary > to) {
    years -= 1;
    anniversary.setUTCFullYear(anniversary.getUTCFullYear() - 1);
  }
  const extraMonths = (to - anniversary) / DAY / 30.44;
  return { completed: years, counted: years + (extraMonths > 6 ? 1 : 0) };
}

/** 15 days' wages (basic + DA, a month taken as 26 days) for every counted year, capped. */
export function gratuityAmount(monthlyWage, countedYears) {
  return Math.min(GRATUITY.ceiling, Math.round((monthlyWage * 15 * countedYears) / 26));
}

async function gratuityRow(e, asOf) {
  const s = await activeStructure(e._id, asOf.slice(0, 7));
  const wage = (s?.basic ?? 0) + (s?.da ?? 0);
  const { completed, counted } = serviceYears(e.joinedOn, asOf);
  const death = /death|died|deceased/i.test(e.exitReason ?? '');
  return {
    employeeId: String(e._id),
    empNo: e.empNo,
    name: nameOf(e),
    department: e.department ?? null,
    joinedOn: ymd(e.joinedOn),
    status: e.status,
    completedYears: completed,
    countedYears: counted,
    monthlyWage: wage,
    amount: gratuityAmount(wage, counted),
    // Death or disablement: payable whatever the length of service.
    eligible: completed >= GRATUITY.minYears || death,
  };
}

/**
 * Gratuity register as of a date: what every employee has earned so far (the liability the
 * accounts provide for) and whether it is payable now.
 */
export async function gratuityRegister({ asOf = ymd(new Date()) } = {}) {
  const staff = await Employee.find({ status: { $in: ['ACTIVE', 'NOTICE'] } })
    .sort({ empNo: 1 })
    .lean();
  const items = [];
  for (const e of staff) items.push(await gratuityRow(e, asOf));
  return {
    asOf,
    items,
    liability: items.reduce((t, r) => t + r.amount, 0),
    payableNow: items.filter((r) => r.eligible).reduce((t, r) => t + r.amount, 0),
  };
}

/** Gratuity for one employee, as of their last day when they have left (final settlement). */
export async function gratuityFor(employeeId) {
  const e = await Employee.findById(employeeId).lean();
  if (!e) throw errors.notFound('Employee');
  const asOf = e.exitOn ? ymd(e.exitOn) : ymd(new Date());
  return { asOf, ...(await gratuityRow(e, asOf)) };
}

// ---------------------------------------------------------------- statutory bonus

/** Payment of Bonus Act, 1965: wage limit ₹21,000; bonus on at most ₹7,000 (or minimum wage). */
export const BONUS = {
  wageLimit: 21_000_00,
  calcCeiling: 7_000_00,
  minPct: 8.33,
  maxPct: 20,
  minDays: 30,
};

const fyMonths = (fy) => {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    return `${i < 9 ? start : start + 1}-${String(m).padStart(2, '0')}`;
  });
};

const earned = (slip, code) => slip.earnings?.find((l) => l.code === code)?.amount ?? 0;

const bonusOut = (b) => ({
  id: String(b._id),
  fy: b.fy,
  percent: b.percent,
  minimumWage: b.minimumWage,
  status: b.status,
  lines: (b.lines ?? []).map((l) => ({ ...l, employeeId: String(l.employeeId) })),
  total: b.total,
  approvalId: b.approvalId ? String(b.approvalId) : null,
  paidAt: b.paidAt ?? null,
  version: b.version,
});

export const bonusInput = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/, 'Use 2025-26'),
  percent: z.number().min(BONUS.minPct).max(BONUS.maxPct),
  /** Monthly minimum wage for the employment, when it is above ₹7,000 (paise). */
  minimumWage: z.number().int().min(0).max(1_00_000_00).default(0),
});

export async function listBonus() {
  const rows = await BonusRun.find({}).sort({ fy: -1 }).lean();
  return { items: rows.map(bonusOut) };
}

/**
 * Works out the year's statutory bonus from the locked payslips: employees whose basic + DA
 * stayed within ₹21,000 a month and who worked at least 30 days; bonus = percent of the salary
 * earned each month, counted at most at ₹7,000 (or the minimum wage, if higher). Redrafting
 * replaces a draft; a run sent for payment or paid stays as it is.
 */
export async function draftBonus({ fy, percent, minimumWage }) {
  const months = fyMonths(fy);
  const runs = await PayrollRun.find({ month: { $in: months }, status: 'LOCKED' })
    .select('_id')
    .lean();
  if (!runs.length)
    throw new AppError(409, 'NO_LOCKED_PAYROLL', `No locked payroll month in ${fy} yet.`);
  const found = await BonusRun.findOne({ fy });
  if (found && found.status !== 'DRAFT')
    throw new AppError(
      409,
      'BONUS_DONE',
      `The ${fy} bonus is already ${found.status.toLowerCase()}.`,
    );
  const cap = Math.max(BONUS.calcCeiling, minimumWage ?? 0);
  const slips = await Payslip.find({ runId: { $in: runs.map((r) => r._id) } }).lean();
  const by = new Map();
  for (const s of slips) {
    const k = String(s.employeeId);
    const r = by.get(k) ?? {
      employeeId: s.employeeId,
      empNo: s.empNo,
      name: s.name,
      months: 0,
      days: 0,
      highestWage: 0,
      basis: 0,
    };
    const wage = earned(s, 'BASIC') + earned(s, 'DA');
    // Full-month wage for the eligibility limit (a month with loss of pay is scaled back up).
    const fullMonth = s.payableDays ? Math.round((wage * s.days) / s.payableDays) : wage;
    r.months += 1;
    r.days += s.payableDays ?? 0;
    r.highestWage = Math.max(r.highestWage, fullMonth);
    r.basis += Math.min(wage, cap);
    by.set(k, r);
  }
  const lines = [...by.values()]
    .filter((r) => r.highestWage <= BONUS.wageLimit && r.days >= BONUS.minDays)
    .map((r) => ({ ...r, bonus: Math.round((r.basis * percent) / 100) }))
    .sort((a, b) => a.empNo.localeCompare(b.empNo));
  const doc = found ?? new BonusRun({ fy });
  Object.assign(doc, {
    percent,
    minimumWage,
    lines,
    total: lines.reduce((t, l) => t + l.bonus, 0),
    status: 'DRAFT',
  });
  await doc.save();
  return bonusOut(doc.toObject());
}

/** Sends the bonus for payment: Finance approves (payroll.bonus), then it is paid and posted. */
export async function payBonus(id, { version }, res) {
  const b = await BonusRun.findById(id);
  if (!b) throw errors.notFound('Bonus run');
  if (b.version !== version) throw errors.versionConflict();
  if (b.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATE', 'Only a draft can be sent.');
  if (!b.total) throw new AppError(422, 'NOTHING_TO_PAY', 'No employee is due a bonus.');
  return withTransaction(async () => {
    const approval = await requestApproval({
      action: 'payroll.bonus',
      module: 'PAY',
      entity: 'BonusRun',
      entityId: b._id,
      title: `Statutory bonus ${b.fy} at ${b.percent}% for ${b.lines.length} employees`,
      before: {},
      after: { total: b.total, employees: b.lines.length },
      payload: { bonusId: String(b._id) },
      metrics: { amount: b.total },
      reason: `Bonus ${b.fy}`,
    });
    if (approval) {
      b.status = 'PENDING_APPROVAL';
      b.approvalId = approval._id;
      if (res) res.locals.status = 202;
    } else await markPaid(b);
    await b.save();
    return bonusOut(b.toObject());
  });
}

async function markPaid(b) {
  b.status = 'PAID';
  b.paidAt = new Date();
  await publish('payroll.bonus.paid', { bonusId: String(b._id), fy: b.fy, total: b.total });
}

onApprovalDecided('payroll.bonus', async (req, outcome) => {
  const b = await BonusRun.findById(req.payload.bonusId);
  if (!b || b.status !== 'PENDING_APPROVAL') return;
  if (outcome === 'APPROVED') await markPaid(b);
  else b.status = 'DRAFT';
  await b.save();
});

export { financialYearOf };
