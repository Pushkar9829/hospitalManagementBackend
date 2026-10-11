import {
  GROUPS,
  istDate,
  period,
  registerReport,
  registerTile,
  tone,
} from '../../core/reports/registry.js';
import { Attendance, Employee, LeaveRequest } from './models/hr.models.js';

/** HR reports. */
const DAY = 86_400_000;
const name = (e) => `${e.name.first}${e.name.last ? ` ${e.name.last}` : ''}`;
const departments = async () => (await Employee.distinct('department')).filter(Boolean).sort();
const deptFilter = { key: 'department', label: 'Department', options: departments };

registerReport({
  code: 'headcount-attrition',
  name: 'Headcount and attrition',
  group: GROUPS.PEOPLE,
  module: 'HRM',
  permission: 'reports:hr:read',
  description: 'Staff at the end of the period, joiners, leavers and attrition, by department.',
  columns: [
    ['department', 'Department', 'text'],
    ['headcount', 'Headcount', 'count'],
    ['joined', 'Joined', 'count'],
    ['left', 'Left', 'count'],
    ['attrition', 'Attrition', 'percent'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const all = await Employee.find({ joinedOn: { $lte: p.to } }).lean();
    const by = new Map();
    for (const e of all) {
      const k = e.department ?? '—';
      const r = by.get(k) ?? { department: k, headcount: 0, joined: 0, left: 0, start: 0 };
      const active = !e.exitOn || e.exitOn > p.to;
      if (active) r.headcount += 1;
      if (e.joinedOn >= p.from) r.joined += 1;
      if (e.exitOn && e.exitOn >= p.from && e.exitOn <= p.to) r.left += 1;
      if (e.joinedOn < p.from && (!e.exitOn || e.exitOn >= p.from)) r.start += 1;
      by.set(k, r);
    }
    const items = [...by.values()].map((r) => {
      const avg = (r.start + r.headcount) / 2;
      return {
        department: r.department,
        headcount: r.headcount,
        joined: r.joined,
        left: r.left,
        attrition: avg ? Math.round((r.left * 1000) / avg) / 10 : 0,
      };
    });
    return {
      kpis: [
        ['headcount', 'Headcount', items.reduce((t, r) => t + r.headcount, 0), 'count'],
        ['left', 'Left in period', items.reduce((t, r) => t + r.left, 0), 'count'],
      ],
      items: items.sort((a, b) => b.headcount - a.headcount),
    };
  },
});

registerReport({
  code: 'attendance-overtime',
  name: 'Attendance and overtime',
  group: GROUPS.PEOPLE,
  module: 'HRM',
  permission: 'reports:hr:read',
  description:
    'Days present, absent, on leave, loss of pay, late arrivals and overtime per employee.',
  filters: [deptFilter],
  columns: [
    ['empNo', 'Emp. no.', 'id'],
    ['name', 'Name', 'text'],
    ['department', 'Department', 'text'],
    ['present', 'Present', 'number'],
    ['absent', 'Absent', 'number'],
    ['leave', 'Leave', 'count'],
    ['late', 'Late', 'count'],
    ['otHours', 'Overtime (h)', 'number'],
  ],
  run: async ({ from, to, filters }) => {
    const emps = await Employee.find({
      status: { $ne: 'EXITED' },
      ...(filters.department ? { department: filters.department } : {}),
    }).lean();
    const rows = await Attendance.find({
      employeeId: { $in: emps.map((e) => e._id) },
      date: { $gte: from, $lte: to },
    }).lean();
    const by = new Map(
      emps.map((e) => [
        String(e._id),
        {
          empNo: e.empNo,
          name: name(e),
          department: e.department ?? '',
          present: 0,
          absent: 0,
          leave: 0,
          late: 0,
          ot: 0,
        },
      ]),
    );
    for (const a of rows) {
      const r = by.get(String(a.employeeId));
      if (!r) continue;
      if (a.status === 'PRESENT') r.present += 1;
      if (a.status === 'HALF_DAY') {
        r.present += 0.5;
        r.absent += 0.5;
      }
      if (a.status === 'ABSENT' || a.status === 'LOP') r.absent += 1;
      if (a.status === 'LEAVE') r.leave += 1;
      if ((a.lateMin ?? 0) > 0) r.late += 1;
      r.ot += a.overtimeMin ?? 0;
    }
    const items = [...by.values()].map(({ ot, ...r }) => ({
      ...r,
      otHours: Math.round(ot / 6) / 10,
    }));
    return {
      kpis: [
        [
          'ot',
          'Overtime hours',
          Math.round(items.reduce((t, r) => t + r.otHours, 0) * 10) / 10,
          'number',
        ],
        ['absent', 'Absent days', items.reduce((t, r) => t + r.absent, 0), 'number'],
      ],
      items,
    };
  },
});

registerReport({
  code: 'leave-register',
  name: 'Leave register',
  group: GROUPS.PEOPLE,
  module: 'HRM',
  permission: 'reports:hr:read',
  description: 'Leave requests overlapping the period with type, days and decision.',
  columns: [
    ['from', 'From', 'date'],
    ['to', 'To', 'date'],
    ['empNo', 'Emp. no.', 'id'],
    ['name', 'Name', 'text'],
    ['code', 'Type', 'text'],
    ['days', 'Days', 'number'],
    ['status', 'Status', 'status'],
    ['decidedBy', 'Decided by', 'text'],
  ],
  run: async ({ from, to }) => {
    const rows = await LeaveRequest.find({ from: { $lte: to }, to: { $gte: from } })
      .sort({ from: 1 })
      .lean();
    const st = (s) =>
      s === 'APPROVED'
        ? tone.ok('Approved')
        : s === 'PENDING'
          ? tone.warn('Waiting')
          : tone.plain(s);
    return {
      kpis: [
        [
          'days',
          'Approved leave days',
          rows.filter((l) => l.status === 'APPROVED').reduce((t, l) => t + (l.days ?? 0), 0),
          'number',
        ],
      ],
      items: rows.map((l) => ({
        from: l.from,
        to: l.to,
        empNo: l.empNo,
        name: l.name,
        code: l.code,
        days: l.days,
        status: st(l.status),
        decidedBy: l.decidedBy ?? '',
      })),
    };
  },
});

registerReport({
  code: 'credential-expiry',
  name: 'Credential expiry',
  group: GROUPS.PEOPLE,
  module: 'HRM',
  permission: 'reports:hr:read',
  description: 'Clinical registrations expired or expiring within 90 days of the end date.',
  columns: [
    ['expiresOn', 'Expires', 'date'],
    ['empNo', 'Emp. no.', 'id'],
    ['name', 'Name', 'text'],
    ['designation', 'Designation', 'text'],
    ['registration', 'Registration', 'text'],
    ['status', 'Status', 'status'],
  ],
  run: async ({ to }) => {
    const end = new Date(`${to}T23:59:59+05:30`);
    const rows = await Employee.find({
      status: { $ne: 'EXITED' },
      'registration.expiresOn': { $lte: new Date(end.getTime() + 90 * DAY) },
    })
      .sort({ 'registration.expiresOn': 1 })
      .lean();
    return {
      kpis: [
        [
          'expired',
          'Expired',
          rows.filter((e) => e.registration.expiresOn < new Date()).length,
          'count',
        ],
      ],
      items: rows.map((e) => ({
        expiresOn: istDate(e.registration.expiresOn),
        empNo: e.empNo,
        name: name(e),
        designation: e.designation ?? '',
        registration: [e.registration.council, e.registration.number].filter(Boolean).join(' · '),
        status:
          e.registration.expiresOn < new Date() ? tone.bad('Expired') : tone.warn('Renew soon'),
      })),
    };
  },
});

registerTile({
  key: 'staff-today',
  label: 'Staff present today',
  group: GROUPS.PEOPLE,
  module: 'HRM',
  permission: 'reports:hr:read',
  report: 'attendance-overtime',
  run: async () => {
    const today = istDate(new Date());
    const [present, staff] = await Promise.all([
      Attendance.countDocuments({ date: today, status: { $in: ['PRESENT', 'HALF_DAY'] } }),
      Employee.countDocuments({ status: { $ne: 'EXITED' } }),
    ]);
    return { value: present, note: `of ${staff} staff` };
  },
});
