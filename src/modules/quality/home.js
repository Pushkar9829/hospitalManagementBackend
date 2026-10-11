import { registerHome, status } from '../../core/home/registry.js';
import { Complaint, Feedback, Incident } from './models/quality.models.js';

/** Quality widgets: incidents and complaints open, complaint TAT, this month's NPS. */
const COMPLAINT_OPEN = ['OPEN', 'IN_PROGRESS', 'ESCALATED'];
const monthStart = (ctx) => new Date(`${ctx.today.slice(0, 7)}-01T00:00:00+05:30`);

registerHome({
  id: 'qlt.incidents',
  panels: ['quality', 'medsupt'],
  permission: 'quality:incident:update',
  module: 'QLT',
  kind: 'kpi',
  order: 10,
  build: async () => {
    const [open, serious] = await Promise.all([
      Incident.countDocuments({ status: { $ne: 'CLOSED' } }),
      Incident.countDocuments({
        status: { $ne: 'CLOSED' },
        severity: { $in: ['SEVERE', 'SENTINEL'] },
      }),
    ]);
    return {
      value: open,
      format: 'count',
      params: { serious },
      tone: serious ? 'critical' : 'neutral',
      link: '/quality?tab=incidents',
    };
  },
});

registerHome({
  id: 'qlt.complaints',
  panels: ['quality', 'medsupt', 'crm'],
  permission: 'quality:complaint:read',
  module: 'QLT',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => {
    const [open, overdue] = await Promise.all([
      Complaint.countDocuments({ status: { $in: COMPLAINT_OPEN } }),
      Complaint.countDocuments({ status: { $in: COMPLAINT_OPEN }, dueAt: { $lt: ctx.now } }),
    ]);
    return {
      value: open,
      format: 'count',
      params: { overdue },
      tone: overdue ? 'warning' : 'neutral',
      link: '/quality?tab=complaints',
    };
  },
});

registerHome({
  id: 'qlt.nps',
  panels: ['quality'],
  permission: 'quality:feedback:read',
  module: 'QLT',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => {
    const rows = await Feedback.find({ respondedAt: { $gte: monthStart(ctx) }, nps: { $ne: null } })
      .select('nps')
      .lean();
    if (!rows.length)
      return {
        value: null,
        format: 'count',
        params: { context: 'none' },
        link: '/quality?tab=feedback',
      };
    const promoters = rows.filter((r) => r.nps >= 9).length;
    const detractors = rows.filter((r) => r.nps <= 6).length;
    return {
      value: Math.round(((promoters - detractors) * 100) / rows.length),
      format: 'count',
      params: { responses: rows.length },
      link: '/quality?tab=feedback',
    };
  },
});

registerHome({
  id: 'qlt.complaintList',
  panels: ['quality'],
  permission: 'quality:complaint:read',
  module: 'QLT',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await Complaint.find({ status: { $in: COMPLAINT_OPEN } })
      .select('complaintNo category patient contactName priority status dueAt')
      .sort({ dueAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/quality?tab=complaints',
      columns: [
        { key: 'complaint', kind: 'id' },
        { key: 'patient', kind: 'text' },
        { key: 'category', kind: 'text' },
        { key: 'due', kind: 'datetime' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((r) => {
        const late = r.dueAt && new Date(r.dueAt) < ctx.now;
        return {
          id: String(r._id),
          complaint: r.complaintNo,
          patient: r.patient?.name ?? r.contactName,
          category: r.category,
          due: r.dueAt,
          status: status(
            late ? 'OVERDUE' : r.status,
            late || r.status === 'ESCALATED' ? 'critical' : 'info',
          ),
        };
      }),
    };
  },
});
