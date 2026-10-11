import { GROUPS, registerReport } from '../../core/reports/registry.js';
import { PayrollRun, Payslip } from './models/payroll.models.js';

/** Payroll reports (released runs only). */
const amt = (lines, code) => (lines ?? []).find((l) => l.code === code)?.amount ?? 0;

async function lockedSlips(from, to) {
  const runs = await PayrollRun.find({
    status: 'LOCKED',
    month: { $gte: from.slice(0, 7), $lte: to.slice(0, 7) },
  })
    .select('_id')
    .lean();
  return Payslip.find({ runId: { $in: runs.map((r) => r._id) } })
    .sort({ month: 1, empNo: 1 })
    .lean();
}

registerReport({
  code: 'payroll-register',
  name: 'Payroll register',
  group: GROUPS.PEOPLE,
  module: 'PAY',
  permission: 'reports:payroll:read',
  description: 'Each payslip of the released months: days paid, gross, deductions and net.',
  columns: [
    ['month', 'Month', 'text'],
    ['empNo', 'Emp. no.', 'id'],
    ['name', 'Name', 'text'],
    ['department', 'Department', 'text'],
    ['paidDays', 'Paid days', 'number'],
    ['gross', 'Gross', 'money'],
    ['deductions', 'Deductions', 'money'],
    ['net', 'Net', 'money'],
  ],
  run: async ({ from, to }) => {
    const slips = await lockedSlips(from, to);
    return {
      kpis: [
        ['gross', 'Gross', slips.reduce((t, s) => t + s.gross, 0), 'money'],
        ['net', 'Net pay', slips.reduce((t, s) => t + s.net, 0), 'money'],
        ['slips', 'Payslips', slips.length, 'count'],
      ],
      items: slips.map((s) => ({
        month: s.month,
        empNo: s.empNo,
        name: s.name,
        department: s.department ?? '',
        paidDays: s.payableDays,
        gross: s.gross,
        deductions: s.totalDeductions,
        net: s.net,
      })),
    };
  },
});

registerReport({
  code: 'statutory-pf-esi',
  name: 'PF, ESI, PT, TDS',
  group: GROUPS.PEOPLE,
  module: 'PAY',
  permission: 'reports:payroll:read',
  description: 'Statutory deductions and employer contributions per employee, for the returns.',
  columns: [
    ['month', 'Month', 'text'],
    ['empNo', 'Emp. no.', 'id'],
    ['name', 'Name', 'text'],
    ['uan', 'UAN', 'id'],
    ['pf', 'PF (employee)', 'money'],
    ['pfEr', 'PF (employer)', 'money'],
    ['esi', 'ESI (employee)', 'money'],
    ['esiEr', 'ESI (employer)', 'money'],
    ['pt', 'PT', 'money'],
    ['tds', 'TDS', 'money'],
  ],
  run: async ({ from, to }) => {
    const slips = await lockedSlips(from, to);
    const items = slips.map((s) => ({
      month: s.month,
      empNo: s.empNo,
      name: s.name,
      uan: s.uan ?? '',
      pf: amt(s.deductions, 'PF'),
      pfEr: amt(s.employer, 'PF_ER'),
      esi: amt(s.deductions, 'ESI'),
      esiEr: amt(s.employer, 'ESI_ER'),
      pt: amt(s.deductions, 'PT'),
      tds: amt(s.deductions, 'TDS'),
    }));
    const sum = (k) => items.reduce((t, r) => t + r[k], 0);
    return {
      kpis: [
        ['pf', 'PF to deposit', sum('pf') + sum('pfEr'), 'money'],
        ['esi', 'ESI to deposit', sum('esi') + sum('esiEr'), 'money'],
        ['tds', 'TDS', sum('tds'), 'money'],
      ],
      items,
    };
  },
});
