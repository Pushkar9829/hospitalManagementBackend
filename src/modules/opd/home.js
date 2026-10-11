import { registerHome, status } from '../../core/home/registry.js';
import { Department, Doctor } from '../setup/index.js';
import { Appointment, OpdVisit } from './models/opd.models.js';

/** OPD widgets on the role home pages: the doctor's queue, the counter's day, a department. */
const DAY = 86_400_000;
const STAGE_TONE = {
  WAITING: 'neutral',
  IN_TRIAGE: 'info',
  TRIAGED: 'info',
  CALLED: 'warning',
  WITH_DOCTOR: 'accent',
};
const minutesSince = (d, now) => (d ? Math.max(0, Math.round((now - new Date(d)) / 60_000)) : null);
const myDoctor = (ctx) => Doctor.findOne({ userId: ctx.userId }).select('_id').lean();

registerHome({
  id: 'opd.myToday',
  panels: ['doctor', 'clinic'],
  permission: 'opd:consultation:read',
  module: 'OPD',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const d = await myDoctor(ctx);
    if (!d) return null;
    const visits = await OpdVisit.find({ date: ctx.today, 'doctor.id': d._id })
      .select('stage')
      .lean();
    const seen = visits.filter((v) => v.stage === 'DONE').length;
    return {
      value: visits.length,
      format: 'count',
      params: { seen, waiting: visits.length - seen },
      link: '/opd/visits/next',
    };
  },
});

registerHome({
  id: 'opd.followUps',
  panels: ['doctor', 'clinic'],
  permission: 'opd:consultation:read',
  module: 'OPD',
  kind: 'kpi',
  order: 40,
  build: async (ctx) => {
    const d = await myDoctor(ctx);
    if (!d) return null;
    const until = new Date(new Date(`${ctx.today}T00:00:00Z`).getTime() + 7 * DAY)
      .toISOString()
      .slice(0, 10);
    const n = await OpdVisit.countDocuments({
      'doctor.id': d._id,
      'consultation.followUp.date': { $gte: ctx.today, $lte: until },
    });
    return { value: n, format: 'count' };
  },
});

registerHome({
  id: 'opd.myQueue',
  panels: ['doctor', 'clinic'],
  permission: 'opd:consultation:read',
  module: 'OPD',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const d = await myDoctor(ctx);
    if (!d) return null;
    const visits = await OpdVisit.find({
      date: ctx.today,
      'doctor.id': d._id,
      stage: { $ne: 'DONE' },
    })
      .select('token patient visitType stage checkedInAt priority')
      .sort({ checkedInAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/opd/visits/next',
      columns: [
        { key: 'token', kind: 'id' },
        { key: 'patient', kind: 'text' },
        { key: 'visit', kind: 'text' },
        { key: 'waited', kind: 'minutes' },
        { key: 'status', kind: 'status' },
      ],
      rows: visits.map((v) => ({
        id: String(v._id),
        link: `/opd/visits/${v._id}`,
        token: v.token,
        patient: v.patient?.name,
        visit: v.visitType,
        waited: minutesSince(v.checkedInAt, ctx.now),
        status: status(
          v.stage,
          v.priority === 'RED' ? 'critical' : (STAGE_TONE[v.stage] ?? 'neutral'),
        ),
      })),
    };
  },
});

registerHome({
  id: 'opd.today',
  panels: ['admin', 'medsupt', 'frontoffice', 'superadmin'],
  permission: 'opd:appointment:read',
  module: 'OPD',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => {
    const [total, waiting] = await Promise.all([
      OpdVisit.countDocuments({ date: ctx.today }),
      OpdVisit.countDocuments({ date: ctx.today, stage: { $ne: 'DONE' } }),
    ]);
    return { value: total, format: 'count', params: { waiting }, link: '/opd' };
  },
});

registerHome({
  id: 'opd.appointments',
  panels: ['frontoffice'],
  permission: 'opd:appointment:read',
  module: 'OPD',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await Appointment.find({
      date: ctx.today,
      status: { $in: ['BOOKED', 'CONFIRMED'] },
      slotStart: { $gte: new Date(ctx.now.getTime() - 30 * 60_000) },
    })
      .select('time patient doctor status token')
      .sort({ slotStart: 1 })
      .limit(12)
      .lean();
    return {
      link: '/opd/check-in',
      columns: [
        { key: 'time', kind: 'text' },
        { key: 'patient', kind: 'text' },
        { key: 'doctor', kind: 'text' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((a) => ({
        id: String(a._id),
        time: a.time,
        patient: a.patient?.name,
        doctor: a.doctor?.name,
        status: status(a.status, a.status === 'CONFIRMED' ? 'success' : 'info'),
      })),
    };
  },
});

registerHome({
  id: 'opd.department',
  panels: ['hod'],
  permission: 'opd:consultation:read',
  module: 'OPD',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const dept = await Department.findOne({ hodUserId: ctx.userId }).select('name').lean();
    if (!dept) return null;
    const visits = await OpdVisit.find({ date: ctx.today, 'doctor.department': dept.name })
      .select('stage')
      .lean();
    return {
      value: visits.filter((v) => v.stage !== 'DONE').length,
      format: 'count',
      params: { department: dept.name, total: visits.length },
      link: '/opd/visits/next',
    };
  },
});
