import { registerHome, status } from '../../core/home/registry.js';
import { MrdRecord, ReleaseRequest } from './models/mrd.models.js';

/** Medical records widgets: files not closed, deficiencies, coding, release requests. */
const DAY = 86_400_000;
const daysSince = (d, now) => (d ? Math.floor((now - new Date(d)) / DAY) : null);

registerHome({
  id: 'mrd.notClosed',
  panels: ['mrd'],
  permission: 'mrd:record:read',
  module: 'MRD',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const open = await MrdRecord.find({ status: { $ne: 'CLOSED' } })
      .select('dischargedAt')
      .lean();
    const over7 = open.filter((r) => daysSince(r.dischargedAt, ctx.now) > 7).length;
    return {
      value: open.length,
      format: 'count',
      params: { over7 },
      tone: over7 ? 'warning' : 'neutral',
      link: '/records',
    };
  },
});

registerHome({
  id: 'mrd.deficient',
  panels: ['mrd', 'medsupt', 'doctor'],
  permission: 'mrd:record:read',
  module: 'MRD',
  kind: 'kpi',
  order: 50,
  build: async (ctx) => {
    const q = { status: 'DEFICIENT' };
    // A doctor sees the files waiting on them.
    if (ctx.panel === 'doctor') q['consultant.userId'] = ctx.userId;
    const n = await MrdRecord.countDocuments(q);
    return {
      value: n,
      format: 'count',
      tone: n ? 'warning' : 'neutral',
      link: '/records?tab=deficiencies',
    };
  },
});

registerHome({
  id: 'mrd.toCode',
  panels: ['mrd'],
  permission: 'mrd:record:read',
  module: 'MRD',
  kind: 'kpi',
  order: 30,
  build: async () => ({
    value: await MrdRecord.countDocuments({ status: 'CODING' }),
    format: 'count',
    link: '/records',
  }),
});

registerHome({
  id: 'mrd.releases',
  panels: ['mrd'],
  permission: 'mrd:release:read',
  module: 'MRD',
  kind: 'kpi',
  order: 40,
  build: async () => {
    const [waiting, ready] = await Promise.all([
      ReleaseRequest.countDocuments({ status: 'PENDING_APPROVAL' }),
      ReleaseRequest.countDocuments({ status: 'APPROVED' }),
    ]);
    return { value: ready, format: 'count', params: { waiting }, link: '/records?tab=releases' };
  },
});

registerHome({
  id: 'mrd.deficientList',
  panels: ['mrd'],
  permission: 'mrd:record:read',
  module: 'MRD',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await MrdRecord.find({ status: 'DEFICIENT' })
      .select('ipNo patient consultant dischargedAt checklist')
      .sort({ dischargedAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/records?tab=deficiencies',
      columns: [
        { key: 'ipNo', kind: 'id' },
        { key: 'patient', kind: 'text' },
        { key: 'doctor', kind: 'text' },
        { key: 'missing', kind: 'count' },
        { key: 'days', kind: 'count' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((r) => {
        const days = daysSince(r.dischargedAt, ctx.now) ?? 0;
        return {
          id: String(r._id),
          ipNo: r.ipNo,
          patient: r.patient?.name,
          doctor: r.consultant?.name,
          missing: (r.checklist ?? []).filter((c) => !c.ok).length,
          days,
          status: status(days > 7 ? 'OVERDUE' : 'DEFICIENT', days > 7 ? 'critical' : 'warning'),
        };
      }),
    };
  },
});
