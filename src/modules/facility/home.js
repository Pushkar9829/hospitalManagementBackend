import { registerHome, status } from '../../core/home/registry.js';
import { Asset, PorterRequest, Ticket } from './models/facility.models.js';

/** Facility widgets: maintenance tickets, equipment due, porters. Beds to clean come from IPD. */
const OPEN = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED'];
const DAY = 86_400_000;
const PRIORITY_TONE = { URGENT: 'critical', HIGH: 'warning', NORMAL: 'info', LOW: 'neutral' };

registerHome({
  id: 'fac.tickets',
  panels: ['facility'],
  permission: 'facility:ticket:read',
  module: 'FAC',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => {
    const [open, overdue] = await Promise.all([
      Ticket.countDocuments({ status: { $in: OPEN } }),
      Ticket.countDocuments({ status: { $in: OPEN }, dueAt: { $lt: ctx.now } }),
    ]);
    return {
      value: open,
      format: 'count',
      params: { overdue },
      tone: overdue ? 'critical' : 'neutral',
      link: '/facility?tab=tickets',
    };
  },
});

registerHome({
  id: 'fac.pmDue',
  panels: ['facility'],
  permission: 'facility:asset:read',
  module: 'FAC',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => {
    const soon = new Date(ctx.now.getTime() + 7 * DAY);
    const [due, down] = await Promise.all([
      Asset.countDocuments({
        status: 'IN_SERVICE',
        $or: [{ nextPmDue: { $lte: soon } }, { nextCalibrationDue: { $lte: soon } }],
      }),
      Asset.countDocuments({ status: 'OUT_OF_SERVICE' }),
    ]);
    return {
      value: due,
      format: 'count',
      params: { down },
      tone: down ? 'warning' : 'neutral',
      link: '/facility?tab=equipment',
    };
  },
});

registerHome({
  id: 'fac.porters',
  panels: ['facility'],
  permission: 'facility:porter:read',
  module: 'FAC',
  kind: 'kpi',
  order: 40,
  build: async () => ({
    value: await PorterRequest.countDocuments({
      status: { $in: ['REQUESTED', 'ASSIGNED', 'PICKED'] },
    }),
    format: 'count',
    link: '/facility?tab=porters',
  }),
});

registerHome({
  id: 'fac.ticketList',
  panels: ['facility'],
  permission: 'facility:ticket:read',
  module: 'FAC',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await Ticket.find({ status: { $in: OPEN } })
      .select('ticketNo category priority location assetName status dueAt createdAt')
      .sort({ dueAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/facility?tab=tickets',
      columns: [
        { key: 'ticket', kind: 'id' },
        { key: 'location', kind: 'text' },
        { key: 'category', kind: 'text' },
        { key: 'due', kind: 'datetime' },
        { key: 'priority', kind: 'status' },
      ],
      rows: rows.map((r) => ({
        id: String(r._id),
        ticket: r.ticketNo,
        location: [r.location, r.assetName].filter(Boolean).join(' · '),
        category: r.category,
        due: r.dueAt,
        priority: status(
          r.dueAt && new Date(r.dueAt) < ctx.now ? 'OVERDUE' : r.priority,
          r.dueAt && new Date(r.dueAt) < ctx.now
            ? 'critical'
            : (PRIORITY_TONE[r.priority] ?? 'neutral'),
        ),
      })),
    };
  },
});
