import { registerHome, status } from '../../core/home/registry.js';
import { Enquiry, HealthCamp, Lead, Membership } from './models/crm.models.js';

/** CRM widgets: leads to call today, enquiries, conversions, the next camp, renewals due. */
const DAY = 86_400_000;
const OPEN = ['NEW', 'CONTACTED', 'COUNSELLED', 'BOOKED'];
const monthStart = (ctx) => new Date(`${ctx.today.slice(0, 7)}-01T00:00:00+05:30`);

registerHome({
  id: 'crm.followUps',
  panels: ['crm'],
  permission: 'crm:lead:read',
  module: 'CRM',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const [due, late] = await Promise.all([
      Lead.countDocuments({ stage: { $in: OPEN }, nextFollowUp: { $lte: ctx.day.end } }),
      Lead.countDocuments({ stage: { $in: OPEN }, nextFollowUp: { $lt: ctx.day.start } }),
    ]);
    return {
      value: due,
      format: 'count',
      params: { late },
      tone: late ? 'warning' : 'neutral',
      link: '/crm?tab=leads',
    };
  },
});

registerHome({
  id: 'crm.enquiries',
  panels: ['crm'],
  permission: 'crm:enquiry:read',
  module: 'CRM',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => ({
    value: await Enquiry.countDocuments({ at: { $gte: ctx.day.start, $lte: ctx.day.end } }),
    format: 'count',
    link: '/crm',
  }),
});

registerHome({
  id: 'crm.converted',
  panels: ['crm'],
  permission: 'crm:lead:read',
  module: 'CRM',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => ({
    value: await Lead.countDocuments({
      stage: 'CONVERTED',
      convertedAt: { $gte: monthStart(ctx) },
    }),
    format: 'count',
    link: '/crm?tab=report',
  }),
});

registerHome({
  id: 'crm.nextCamp',
  panels: ['crm'],
  permission: 'crm:camp:read',
  module: 'CRM',
  kind: 'kpi',
  order: 40,
  build: async (ctx) => {
    const camp = await HealthCamp.findOne({ status: 'PLANNED', date: { $gte: ctx.today } })
      .sort({ date: 1 })
      .select('name date registrations')
      .lean();
    if (!camp)
      return { value: null, format: 'text', params: { context: 'none' }, link: '/crm?tab=camps' };
    return {
      value: camp.registrations?.length ?? 0,
      format: 'count',
      params: { name: camp.name, date: camp.date },
      link: '/crm?tab=camps',
    };
  },
});

registerHome({
  id: 'crm.renewals',
  panels: ['crm'],
  permission: 'crm:membership:read',
  module: 'CRM',
  kind: 'kpi',
  order: 50,
  build: async (ctx) => ({
    value: await Membership.countDocuments({
      status: 'ACTIVE',
      validUntil: { $gte: ctx.day.start, $lte: new Date(ctx.now.getTime() + 30 * DAY) },
    }),
    format: 'count',
    link: '/crm?tab=members',
  }),
});

registerHome({
  id: 'crm.leadList',
  panels: ['crm'],
  permission: 'crm:lead:read',
  module: 'CRM',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await Lead.find({ stage: { $in: OPEN }, nextFollowUp: { $lte: ctx.day.end } })
      .select('leadNo name interest source stage nextFollowUp')
      .sort({ nextFollowUp: 1 })
      .limit(12)
      .lean();
    return {
      link: '/crm?tab=leads',
      columns: [
        { key: 'lead', kind: 'id' },
        { key: 'name', kind: 'text' },
        { key: 'interest', kind: 'text' },
        { key: 'due', kind: 'datetime' },
        { key: 'stage', kind: 'status' },
      ],
      rows: rows.map((r) => ({
        id: String(r._id),
        lead: r.leadNo,
        name: r.name,
        interest: r.interest,
        due: r.nextFollowUp,
        stage: status(r.stage, new Date(r.nextFollowUp) < ctx.day.start ? 'warning' : 'info'),
      })),
    };
  },
});
