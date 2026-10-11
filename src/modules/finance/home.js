import { registerHome, status } from '../../core/home/registry.js';
import { FinanceSettings, Journal } from './models/finance.models.js';

/** Accounts widgets: the open period, vouchers waiting, manual journals, the day book. */
const month = (ctx) => ctx.today.slice(0, 7);

registerHome({
  id: 'fin.period',
  panels: ['accounts'],
  permission: 'finance:journal:read',
  module: 'FIN',
  kind: 'kpi',
  order: 1,
  build: async () => {
    const s = await FinanceSettings.findOne().select('lockedThrough').lean();
    return {
      value: s?.lockedThrough ?? null,
      format: 'month',
      params: s?.lockedThrough ? {} : { context: 'none' },
      link: '/finance?tab=period',
    };
  },
});

registerHome({
  id: 'fin.pending',
  panels: ['accounts'],
  permission: 'finance:journal:read',
  module: 'FIN',
  kind: 'kpi',
  order: 20,
  build: async () => {
    const n = await Journal.countDocuments({ status: 'PENDING_APPROVAL' });
    return { value: n, format: 'count', tone: n ? 'warning' : 'neutral', link: '/approvals' };
  },
});

registerHome({
  id: 'fin.manualJournals',
  panels: ['accounts', 'auditor'],
  permission: 'finance:journal:read',
  module: 'FIN',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => ({
    value: await Journal.countDocuments({
      type: 'JOURNAL',
      'source.kind': { $in: [null, 'MANUAL'] },
      date: { $gte: `${month(ctx)}-01`, $lte: ctx.today },
    }),
    format: 'count',
    link: '/finance',
  }),
});

registerHome({
  id: 'fin.recent',
  panels: ['accounts'],
  permission: 'finance:journal:read',
  module: 'FIN',
  kind: 'list',
  order: 100,
  build: async () => {
    const rows = await Journal.find()
      .select('voucherNo type date narration total status')
      .sort({ date: -1, createdAt: -1 })
      .limit(12)
      .lean();
    return {
      link: '/finance',
      columns: [
        { key: 'voucher', kind: 'id' },
        { key: 'date', kind: 'date' },
        { key: 'narration', kind: 'text' },
        { key: 'amount', kind: 'money' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((j) => ({
        id: String(j._id),
        voucher: j.voucherNo,
        date: j.date,
        narration: j.narration,
        amount: j.total ?? 0,
        status: status(
          j.status,
          j.status === 'POSTED'
            ? 'success'
            : j.status === 'PENDING_APPROVAL'
              ? 'warning'
              : 'neutral',
        ),
      })),
    };
  },
});
