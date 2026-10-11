import { registerHome, status } from '../../core/home/registry.js';
import { Employee } from '../hr/index.js';
import { PayrollRun, Payslip } from './models/payroll.models.js';

/** Payroll widgets: the current run and its totals; an employee's last payslip. */
const RUN_TONE = {
  DRAFT: 'neutral',
  CALCULATED: 'info',
  SUBMITTED: 'warning',
  RETURNED: 'critical',
  LOCKED: 'success',
};
const latestRun = () => PayrollRun.findOne().sort({ month: -1 }).lean();

registerHome({
  id: 'pay.run',
  panels: ['payroll', 'hr'],
  permission: 'payroll:run:read',
  module: 'PAY',
  kind: 'kpi',
  order: 5,
  build: async () => {
    const run = await latestRun();
    if (!run) return { value: null, format: 'text', params: { context: 'none' }, link: '/payroll' };
    return {
      value: run.month,
      format: 'month',
      params: { status: run.status },
      tone: RUN_TONE[run.status] === 'critical' ? 'critical' : 'neutral',
      link: '/payroll',
    };
  },
});

registerHome({
  id: 'pay.net',
  panels: ['payroll', 'accounts'],
  permission: 'payroll:run:read',
  module: 'PAY',
  kind: 'kpi',
  order: 10,
  build: async () => {
    const run = await latestRun();
    if (!run) return null;
    return {
      value: run.totals?.net ?? 0,
      format: 'money',
      params: { employees: run.totals?.employees ?? 0, month: run.month },
      link: '/payroll',
    };
  },
});

registerHome({
  id: 'pay.warnings',
  panels: ['payroll'],
  permission: 'payroll:run:read',
  module: 'PAY',
  kind: 'kpi',
  order: 20,
  build: async () => {
    const run = await latestRun();
    if (!run) return null;
    // A payslip that moved more than 20% from last month is worth a second look.
    const n = await Payslip.countDocuments({
      runId: run._id,
      $or: [{ variancePct: { $gt: 20 } }, { variancePct: { $lt: -20 } }],
    });
    return { value: n, format: 'count', tone: n ? 'warning' : 'neutral', link: '/payroll' };
  },
});

registerHome({
  id: 'pay.runs',
  panels: ['payroll'],
  permission: 'payroll:run:read',
  module: 'PAY',
  kind: 'list',
  order: 100,
  build: async () => {
    const runs = await PayrollRun.find()
      .select('month status totals')
      .sort({ month: -1 })
      .limit(6)
      .lean();
    return {
      link: '/payroll',
      columns: [
        { key: 'month', kind: 'month' },
        { key: 'employees', kind: 'count' },
        { key: 'net', kind: 'money' },
        { key: 'status', kind: 'status' },
      ],
      rows: runs.map((r) => ({
        id: String(r._id),
        month: r.month,
        employees: r.totals?.employees ?? 0,
        net: r.totals?.net ?? 0,
        status: status(r.status, RUN_TONE[r.status] ?? 'neutral'),
      })),
    };
  },
});

registerHome({
  id: 'pay.myPayslip',
  panels: ['employee'],
  permission: 'myspace:payslip:read',
  module: 'PAY',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => {
    const e = await Employee.findOne({ userId: ctx.userId }).select('_id').lean();
    if (!e) return null;
    const slip = await Payslip.findOne({ employeeId: e._id })
      .sort({ month: -1 })
      .select('month net')
      .lean();
    if (!slip) return null;
    return {
      value: slip.net,
      format: 'money',
      params: { month: slip.month },
      link: '/me?tab=payslips',
    };
  },
});
