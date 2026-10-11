import { registerHome, status } from '../../core/home/registry.js';
import { RadStudy } from './models/rad.models.js';

/** Radiology widgets: studies to report, today's schedule, signed reports. */
const minutesSince = (d, now) => (d ? Math.max(0, Math.round((now - new Date(d)) / 60_000)) : null);
const URGENT = ['URGENT', 'STAT'];

registerHome({
  id: 'rad.toReport',
  panels: ['radiology'],
  permission: 'rad:study:read',
  module: 'RAD',
  kind: 'kpi',
  order: 10,
  build: async () => {
    const [n, urgent] = await Promise.all([
      RadStudy.countDocuments({ status: { $in: ['PERFORMED', 'REPORTED'] } }),
      RadStudy.countDocuments({
        status: { $in: ['PERFORMED', 'REPORTED'] },
        priority: { $in: URGENT },
      }),
    ]);
    return {
      value: n,
      format: 'count',
      params: { urgent },
      tone: urgent ? 'warning' : 'neutral',
      link: '/radiology',
    };
  },
});

registerHome({
  id: 'rad.scheduledToday',
  panels: ['radiology'],
  permission: 'rad:study:read',
  module: 'RAD',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => {
    const [scheduled, arrived] = await Promise.all([
      RadStudy.countDocuments({
        status: 'SCHEDULED',
        scheduledAt: { $gte: ctx.day.start, $lte: ctx.day.end },
      }),
      RadStudy.countDocuments({ status: 'ARRIVED' }),
    ]);
    return { value: scheduled, format: 'count', params: { arrived }, link: '/radiology' };
  },
});

registerHome({
  id: 'rad.signedToday',
  panels: ['radiology'],
  permission: 'rad:study:read',
  module: 'RAD',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => ({
    value: await RadStudy.countDocuments({ signedAt: { $gte: ctx.day.start, $lte: ctx.day.end } }),
    format: 'count',
    link: '/radiology',
  }),
});

registerHome({
  id: 'rad.reportList',
  panels: ['radiology'],
  permission: 'rad:study:read',
  module: 'RAD',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await RadStudy.find({ status: { $in: ['PERFORMED', 'REPORTED'] } })
      .select('accessionNo patient name modality priority performedAt status')
      .sort({ performedAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/radiology',
      columns: [
        { key: 'accession', kind: 'id' },
        { key: 'patient', kind: 'text' },
        { key: 'study', kind: 'text' },
        { key: 'waited', kind: 'minutes' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((x) => ({
        id: String(x._id),
        accession: x.accessionNo,
        patient: x.patient?.name,
        study: x.name,
        waited: minutesSince(x.performedAt, ctx.now),
        status: URGENT.includes(x.priority)
          ? status(x.priority, 'critical')
          : status(x.status, x.status === 'REPORTED' ? 'info' : 'neutral'),
      })),
    };
  },
});
