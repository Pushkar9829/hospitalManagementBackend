import { GROUPS, period, registerReport, registerTile, tone } from '../../core/reports/registry.js';
import { Asset, Ticket } from './models/facility.models.js';

/** Facility report: equipment downtime and maintenance tickets. */
const DAY = 86_400_000;

registerReport({
  code: 'equipment-downtime',
  name: 'Equipment downtime',
  group: GROUPS.SUPPORT,
  module: 'FAC',
  permission: 'reports:facility:read',
  description: 'Breakdowns in the period per equipment, downtime and current status.',
  columns: [
    ['code', 'Asset', 'id'],
    ['name', 'Equipment', 'text'],
    ['location', 'Location', 'text'],
    ['breakdowns', 'Breakdowns', 'count'],
    ['downtimeMin', 'Downtime', 'minutes'],
    ['uptime', 'Uptime', 'percent'],
    ['status', 'Now', 'status'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const tickets = await Ticket.find({
      breakdown: true,
      createdAt: { $gte: p.from, $lte: p.to },
      assetId: { $ne: null },
    }).lean();
    const ids = [...new Set(tickets.map((t) => String(t.assetId)))];
    const assets = await Asset.find({ _id: { $in: ids } }).lean();
    const minutes = Math.max(1, (Math.min(p.to.getTime(), Date.now()) - p.from.getTime()) / 60000);
    const items = assets.map((a) => {
      const ts = tickets.filter((t) => String(t.assetId) === String(a._id));
      const down =
        ts.reduce((s, t) => s + (t.downtimeMin ?? 0), 0) +
        (a.status === 'OUT_OF_SERVICE' && a.outSince
          ? Math.round((Date.now() - Math.max(a.outSince, p.from)) / 60000)
          : 0);
      return {
        code: a.code,
        name: a.name,
        location: a.location ?? '',
        breakdowns: ts.length,
        downtimeMin: down,
        uptime: Math.max(0, Math.round(((minutes - down) * 1000) / minutes) / 10),
        status: a.status === 'IN_SERVICE' ? tone.ok('In service') : tone.bad('Out of service'),
      };
    });
    return {
      kpis: [
        ['breakdowns', 'Breakdowns', tickets.length, 'count'],
        [
          'down',
          'Downtime (days)',
          Math.round((items.reduce((t, i) => t + i.downtimeMin, 0) / (DAY / 60000)) * 10) / 10,
          'number',
        ],
      ],
      items: items.sort((a, b) => b.downtimeMin - a.downtimeMin),
    };
  },
});

registerTile({
  key: 'facility-open',
  label: 'Open maintenance tickets',
  group: GROUPS.SUPPORT,
  module: 'FAC',
  permission: 'reports:facility:read',
  report: 'equipment-downtime',
  run: async () => {
    const [open, down] = await Promise.all([
      Ticket.countDocuments({ status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED'] } }),
      Asset.countDocuments({ status: 'OUT_OF_SERVICE' }),
    ]);
    return {
      value: open,
      note: down ? `${down} equipment out of service` : null,
      tone: down ? 'warning' : null,
    };
  },
});
