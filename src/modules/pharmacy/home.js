import { registerHome, status } from '../../core/home/registry.js';
import { Dispense, PharmacyReturn, Prescription } from './models/pharmacy.models.js';

/** Pharmacy widgets: prescriptions waiting, ward returns, today's sales. */
const minutesSince = (d, now) => (d ? Math.max(0, Math.round((now - new Date(d)) / 60_000)) : null);

registerHome({
  id: 'phr.rxWaiting',
  panels: ['pharmacy'],
  permission: 'pharmacy:sale:read',
  module: 'PHR',
  kind: 'kpi',
  order: 5,
  build: async () => {
    const [n, stat] = await Promise.all([
      Prescription.countDocuments({ status: { $in: ['PENDING', 'PARTIAL'] } }),
      Prescription.countDocuments({ status: { $in: ['PENDING', 'PARTIAL'] }, stat: true }),
    ]);
    return {
      value: n,
      format: 'count',
      params: { stat },
      tone: stat ? 'warning' : 'neutral',
      link: '/pharmacy',
    };
  },
});

registerHome({
  id: 'phr.returns',
  panels: ['pharmacy'],
  permission: 'pharmacy:sale:read',
  module: 'PHR',
  kind: 'kpi',
  order: 15,
  build: async () => ({
    value: await PharmacyReturn.countDocuments({ status: 'PENDING' }),
    format: 'count',
    link: '/pharmacy?tab=returns',
  }),
});

registerHome({
  id: 'phr.salesToday',
  panels: ['pharmacy'],
  permission: 'pharmacy:sale:read',
  module: 'PHR',
  kind: 'kpi',
  order: 40,
  build: async (ctx) => {
    const [r] = await Dispense.aggregate([
      { $match: { at: { $gte: ctx.day.start, $lte: ctx.day.end } } },
      { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: { $ifNull: ['$total', 0] } } } },
    ]);
    return {
      value: r?.n ?? 0,
      format: 'count',
      params: { amount: r?.amount ?? 0 },
      link: '/pharmacy?tab=today',
    };
  },
});

registerHome({
  id: 'phr.rxList',
  panels: ['pharmacy'],
  permission: 'pharmacy:sale:read',
  module: 'PHR',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await Prescription.find({ status: { $in: ['PENDING', 'PARTIAL'] } })
      .select('rxNo source patient prescriber lines stat status createdAt location')
      .sort({ stat: -1, createdAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/pharmacy',
      columns: [
        { key: 'rx', kind: 'id' },
        { key: 'patient', kind: 'text' },
        { key: 'doctor', kind: 'text' },
        { key: 'items', kind: 'count' },
        { key: 'waited', kind: 'minutes' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((r) => ({
        id: String(r._id),
        rx: r.rxNo,
        patient: r.patient?.name,
        doctor: r.prescriber?.name,
        items: r.lines?.length ?? 0,
        waited: minutesSince(r.createdAt, ctx.now),
        status: r.stat
          ? status('STAT', 'critical')
          : status(r.source, r.source === 'IPD' ? 'accent' : 'info'),
      })),
    };
  },
});
