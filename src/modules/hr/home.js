import { registerHome } from '../../core/home/registry.js';
import {
  Attendance,
  Employee,
  LeaveBalance,
  LeaveRequest,
  RosterCell,
} from './models/hr.models.js';
import { credentialAlerts } from './services/hr.service.js';

/** HR widgets: who is in today, leave waiting, expiring registrations; an employee's own leave. */

registerHome({
  id: 'hr.present',
  panels: ['hr', 'superadmin'],
  permission: 'hr:employee:read',
  module: 'HRM',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const [active, present] = await Promise.all([
      Employee.countDocuments({ status: { $ne: 'EXITED' } }),
      Attendance.countDocuments({ date: ctx.today, status: { $in: ['PRESENT', 'HALF_DAY'] } }),
    ]);
    return {
      value: present,
      format: 'count',
      params: { active, percent: active ? Math.round((present * 1000) / active) / 10 : 0 },
      link: '/hr?tab=attendance',
    };
  },
});

registerHome({
  id: 'hr.leaveToApprove',
  panels: ['hr'],
  permission: 'hr:leave:approve',
  module: 'HRM',
  kind: 'kpi',
  order: 20,
  build: async () => {
    const n = await LeaveRequest.countDocuments({ status: 'PENDING' });
    return { value: n, format: 'count', tone: n ? 'warning' : 'neutral', link: '/hr?tab=leave' };
  },
});

registerHome({
  id: 'hr.credentials',
  panels: ['hr'],
  permission: 'hr:employee:read',
  module: 'HRM',
  kind: 'kpi',
  order: 30,
  build: async () => {
    const { items } = await credentialAlerts();
    const expired = items.filter((x) => x.daysLeft < 0).length;
    return {
      value: items.length,
      format: 'count',
      params: { expired },
      tone: expired ? 'critical' : items.length ? 'warning' : 'neutral',
      link: '/hr?tab=alerts',
    };
  },
});

registerHome({
  id: 'hr.onShift',
  panels: ['wardincharge', 'hod'],
  permission: 'hr:roster:read',
  module: 'HRM',
  kind: 'kpi',
  order: 40,
  build: async (ctx) => {
    const [on, leave] = await Promise.all([
      RosterCell.countDocuments({ date: ctx.today, shift: { $ne: 'OFF' } }),
      Attendance.countDocuments({ date: ctx.today, status: 'LEAVE' }),
    ]);
    return { value: on, format: 'count', params: { leave }, link: '/hr/rosters' };
  },
});

registerHome({
  id: 'hr.leaveList',
  panels: ['hr'],
  permission: 'hr:leave:approve',
  module: 'HRM',
  kind: 'list',
  order: 100,
  build: async () => {
    const rows = await LeaveRequest.find({ status: 'PENDING' })
      .select('name department code from to days')
      .sort({ from: 1 })
      .limit(12)
      .lean();
    return {
      link: '/hr?tab=leave',
      columns: [
        { key: 'employee', kind: 'text' },
        { key: 'department', kind: 'text' },
        { key: 'leave', kind: 'text' },
        { key: 'from', kind: 'date' },
        { key: 'days', kind: 'count' },
      ],
      rows: rows.map((r) => ({
        id: String(r._id),
        employee: r.name,
        department: r.department,
        leave: r.code,
        from: r.from,
        days: r.days,
      })),
    };
  },
});

// ---- the employee's own panel

const meEmployee = (ctx) => Employee.findOne({ userId: ctx.userId }).select('_id').lean();

registerHome({
  id: 'hr.myLeave',
  panels: ['employee'],
  permission: 'myspace:leave:read',
  module: 'HRM',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const e = await meEmployee(ctx);
    if (!e) return null;
    const year = Number(ctx.today.slice(0, 4));
    const [balances, pending] = await Promise.all([
      LeaveBalance.find({ employeeId: e._id, year }).lean(),
      LeaveRequest.countDocuments({ employeeId: e._id, status: 'PENDING' }),
    ]);
    const left = balances.reduce(
      (t, b) => t + (b.opening ?? 0) + (b.accrued ?? 0) - (b.used ?? 0),
      0,
    );
    return { value: left, format: 'count', params: { pending }, link: '/me?tab=leave' };
  },
});

registerHome({
  id: 'hr.myAttendance',
  panels: ['employee'],
  permission: 'myspace:attendance:read',
  module: 'HRM',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => {
    const e = await meEmployee(ctx);
    if (!e) return null;
    const today = await Attendance.findOne({ employeeId: e._id, date: ctx.today })
      .select('status')
      .lean();
    const shift = await RosterCell.findOne({ employeeId: e._id, date: ctx.today })
      .select('shift')
      .lean();
    return {
      value: shift?.shift ?? null,
      format: 'text',
      params: { status: today?.status ?? 'NONE' },
      link: '/me?tab=attendance',
    };
  },
});
