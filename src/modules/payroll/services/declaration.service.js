import { z } from 'zod';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Employee, myEmployee } from '../../hr/index.js';
import { TaxDeclaration } from '../models/payroll.models.js';
import { financialYearOf } from './payroll.service.js';

/** Income-tax declarations (board My Space, "Tax declaration"); payroll verifies or rejects. */
const istMonth = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
const rupees = z.number().int().min(0).max(1_00_00_000);

export const declarationInput = z.object({
  regime: z.enum(['NEW', 'OLD']),
  rentMonthly: rupees.default(0),
  deductions80C: rupees.default(0),
  deductions80D: rupees.default(0),
});

const out = (d, e) => ({
  id: String(d._id),
  employeeId: String(d.employeeId),
  employee: e
    ? { name: `${e.name.first}${e.name.last ? ` ${e.name.last}` : ''}`, empNo: e.empNo }
    : undefined,
  fy: d.fy,
  regime: d.regime,
  rentMonthly: d.rentMonthly ?? 0,
  deductions80C: d.deductions80C ?? 0,
  deductions80D: d.deductions80D ?? 0,
  status: d.status,
  reviewedBy: d.reviewedBy,
  reviewNote: d.reviewNote,
  updatedAt: d.updatedAt,
  version: d.version ?? 0,
});

export async function myDeclaration() {
  const me = await myEmployee();
  const fy = financialYearOf(istMonth());
  const d = await TaxDeclaration.findOne({ employeeId: me._id, fy }).lean();
  return { fy, declaration: d ? out(d) : null };
}

/** Save this year's declaration; a change goes back to payroll for checking. */
export async function saveMyDeclaration(input) {
  const me = await myEmployee();
  const fy = financialYearOf(istMonth());
  const d =
    (await TaxDeclaration.findOne({ employeeId: me._id, fy })) ??
    new TaxDeclaration({ employeeId: me._id, fy });
  d.set({ ...input, status: 'SUBMITTED', reviewedBy: undefined, reviewNote: undefined });
  await d.save();
  return { fy, declaration: out(d.toObject()) };
}

export async function listDeclarations({ fy, status } = {}) {
  const rows = await TaxDeclaration.find({
    fy: fy ?? financialYearOf(istMonth()),
    ...(status ? { status } : {}),
  })
    .sort({ updatedAt: -1 })
    .limit(500)
    .lean();
  const emps = new Map(
    (
      await Employee.find({ _id: { $in: rows.map((r) => r.employeeId) } })
        .select('name empNo')
        .lean()
    ).map((e) => [String(e._id), e]),
  );
  return { items: rows.map((r) => out(r, emps.get(String(r.employeeId)))) };
}

export async function reviewDeclaration(id, { version, outcome, note }) {
  const d = await TaxDeclaration.findById(id);
  if (!d) throw errors.notFound('Declaration');
  if (d.version !== version) throw errors.versionConflict();
  if (d.status !== 'SUBMITTED') throw new AppError(409, 'INVALID_STATE', 'Already reviewed');
  // Maker-checker: nobody verifies their own declaration.
  const self = await Employee.exists({ _id: d.employeeId, userId: current().userId });
  if (self)
    throw new AppError(
      403,
      'SELF_REVIEW',
      'You cannot review your own declaration. Another payroll officer has to.',
    );
  d.set({ status: outcome, reviewedBy: current().userName, reviewNote: note });
  await d.save();
  return out(d.toObject());
}
