import { GROUPS, period, registerReport } from '../../core/reports/registry.js';
import { Campaign, Lead } from './models/crm.models.js';

/** CRM report: campaign reach and response. */

registerReport({
  code: 'campaign-response',
  name: 'Campaign response',
  group: GROUPS.SUPPORT,
  module: 'CRM',
  permission: 'reports:crm:read',
  description: 'Campaigns sent in the period: reach, opt-outs skipped, leads and conversions.',
  columns: [
    ['sentAt', 'Sent', 'datetime'],
    ['name', 'Campaign', 'text'],
    ['sent', 'Sent', 'count'],
    ['skipped', 'Opted out', 'count'],
    ['leads', 'Leads', 'count'],
    ['converted', 'Converted', 'count'],
    ['responsePct', 'Response', 'percent'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await Campaign.find({ sentAt: { $gte: p.from, $lte: p.to } })
      .sort({ sentAt: 1 })
      .lean();
    const leads = await Lead.find({ campaignId: { $in: rows.map((c) => c._id) } })
      .select('campaignId stage')
      .lean();
    const items = rows.map((c) => {
      const ls = leads.filter((l) => String(l.campaignId) === String(c._id));
      return {
        sentAt: c.sentAt,
        name: c.name,
        sent: c.sent,
        skipped: c.skippedOptOut,
        leads: ls.length,
        converted: ls.filter((l) => l.stage === 'CONVERTED').length,
        responsePct: c.sent ? Math.round((ls.length * 1000) / c.sent) / 10 : 0,
      };
    });
    return {
      kpis: [
        ['sent', 'Messages sent', items.reduce((t, i) => t + i.sent, 0), 'count'],
        ['leads', 'Leads from campaigns', leads.length, 'count'],
      ],
      items,
    };
  },
});
