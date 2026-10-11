import {
  GROUPS,
  istDate,
  period,
  registerReport,
  registerTile,
  tone,
} from '../../core/reports/registry.js';
import { Department } from '../setup/index.js';
import { Bill, Payment, Refund } from './models/billing.models.js';

/** Billing reports: collections, revenue, discounts and refunds, outstanding. */
const DAY = 86_400_000;
const BILLED = ['FINAL', 'PARTLY_PAID', 'PAID'];

registerReport({
  code: 'daily-collection',
  name: 'Daily collection by mode',
  group: GROUPS.BILLING,
  module: 'CORE',
  permission: 'reports:billing:read',
  description: 'Receipts by day and payment mode (cash, UPI, card, bank, wallet).',
  filters: [
    {
      key: 'mode',
      label: 'Payment mode',
      options: async () => (await Payment.distinct('mode')).sort(),
    },
  ],
  columns: [
    ['date', 'Date', 'date'],
    ['mode', 'Mode', 'text'],
    ['receipts', 'Receipts', 'count'],
    ['amount', 'Amount', 'money'],
  ],
  run: async ({ from, to, filters }) => {
    const q = { istDate: { $gte: from, $lte: to }, status: 'CAPTURED' };
    if (filters.mode) q.mode = filters.mode;
    const rows = await Payment.find(q).select('istDate mode amount').lean();
    const by = new Map();
    for (const p of rows) {
      const k = `${p.istDate}|${p.mode}`;
      const r = by.get(k) ?? { date: p.istDate, mode: p.mode, receipts: 0, amount: 0 };
      r.receipts += 1;
      r.amount += p.amount;
      by.set(k, r);
    }
    const total = rows.reduce((t, p) => t + p.amount, 0);
    const cash = rows.filter((p) => p.mode === 'CASH').reduce((t, p) => t + p.amount, 0);
    return {
      kpis: [
        ['total', 'Collected', total, 'money'],
        ['cash', 'Cash', cash, 'money'],
        ['digital', 'Digital', total - cash, 'money'],
      ],
      items: [...by.values()].sort((a, b) =>
        a.date === b.date ? a.mode.localeCompare(b.mode) : a.date.localeCompare(b.date),
      ),
    };
  },
});

registerReport({
  code: 'revenue-by-department',
  name: 'Revenue by department',
  group: GROUPS.BILLING,
  module: 'CORE',
  permission: 'reports:billing:read',
  description: 'Billed revenue (before tax) by department and service category.',
  columns: [
    ['department', 'Department', 'text'],
    ['category', 'Category', 'text'],
    ['lines', 'Lines', 'count'],
    ['gross', 'Gross', 'money'],
    ['discount', 'Discount', 'money'],
    ['taxable', 'Revenue', 'money'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const bills = await Bill.find({
      status: { $in: BILLED },
      finalizedAt: { $gte: p.from, $lte: p.to },
    })
      .select('lines')
      .lean();
    const depts = new Map(
      (await Department.find({}).select('name').lean()).map((d) => [String(d._id), d.name]),
    );
    const by = new Map();
    for (const b of bills)
      for (const l of b.lines) {
        const dept = l.departmentId ? (depts.get(String(l.departmentId)) ?? '—') : '—';
        const k = `${dept}|${l.category ?? 'OTHER'}`;
        const r = by.get(k) ?? {
          department: dept,
          category: l.category ?? 'OTHER',
          lines: 0,
          gross: 0,
          discount: 0,
          taxable: 0,
        };
        r.lines += 1;
        r.gross += l.gross ?? 0;
        r.discount += l.discount ?? 0;
        r.taxable += l.taxable ?? 0;
        by.set(k, r);
      }
    const items = [...by.values()].sort((a, b) => b.taxable - a.taxable);
    return {
      kpis: [
        ['revenue', 'Revenue', items.reduce((t, r) => t + r.taxable, 0), 'money'],
        ['bills', 'Bills', bills.length, 'count'],
      ],
      items,
    };
  },
});

registerReport({
  code: 'discount-refund-register',
  name: 'Discount and refund register',
  group: GROUPS.BILLING,
  module: 'CORE',
  permission: 'reports:billing:read',
  description: 'Every discount applied and refund paid, with the reason.',
  columns: [
    ['at', 'Date', 'datetime'],
    ['kind', 'Type', 'text'],
    ['ref', 'Bill / refund', 'id'],
    ['patient', 'Patient', 'text'],
    ['amount', 'Amount', 'money'],
    ['reason', 'Reason', 'text'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const [disc, refunds] = await Promise.all([
      Bill.find({ 'discount.status': 'APPLIED', finalizedAt: { $gte: p.from, $lte: p.to } })
        .select('billNo patient discount finalizedAt')
        .lean(),
      Refund.find({ createdAt: { $gte: p.from, $lte: p.to } }).lean(),
    ]);
    const items = [
      ...disc.map((b) => ({
        at: b.finalizedAt,
        kind: 'Discount',
        ref: b.billNo,
        patient: b.patient?.name ?? '',
        amount: b.discount.amount ?? 0,
        reason: b.discount.reason ?? '',
      })),
      ...refunds.map((r) => ({
        at: r.paidAt ?? r.createdAt,
        kind: r.status === 'PAID' ? 'Refund paid' : 'Refund approved',
        ref: r.refundNo ?? '',
        patient: r.patient?.name ?? '',
        amount: r.amount,
        reason: r.reason ?? '',
      })),
    ].sort((a, b) => a.at - b.at);
    return {
      kpis: [
        ['discounts', 'Discounts', disc.reduce((t, b) => t + (b.discount.amount ?? 0), 0), 'money'],
        ['refunds', 'Refunds', refunds.reduce((t, r) => t + r.amount, 0), 'money'],
      ],
      items,
    };
  },
});

registerReport({
  code: 'outstanding-ageing',
  name: 'Outstanding and ageing',
  group: GROUPS.BILLING,
  module: 'CORE',
  permission: 'reports:billing:read',
  description: 'Bills with a balance on the end date, aged 0-30, 31-60, 61-90 and over 90 days.',
  columns: [
    ['billNo', 'Bill', 'id'],
    ['patient', 'Patient', 'text'],
    ['payer', 'Payer', 'text'],
    ['date', 'Billed', 'date'],
    ['days', 'Age (days)', 'days'],
    ['balance', 'Balance', 'money'],
    ['bucket', 'Bucket', 'status'],
  ],
  run: async ({ to }) => {
    const end = new Date(`${to}T23:59:59+05:30`);
    const rows = await Bill.find({
      status: { $in: ['FINAL', 'PARTLY_PAID'] },
      finalizedAt: { $lte: end },
    }).lean();
    const bucket = (d) =>
      d <= 30
        ? tone.ok('0-30')
        : d <= 60
          ? tone.warn('31-60')
          : d <= 90
            ? tone.warn('61-90')
            : tone.bad('90+');
    const items = rows
      .map((b) => {
        const days = Math.floor((end - b.finalizedAt) / DAY);
        return {
          billNo: b.billNo,
          patient: b.patient?.name ?? '',
          payer: b.payer?.name ?? b.payer?.kind ?? 'CASH',
          date: istDate(b.finalizedAt),
          days,
          balance: b.totals?.balance ?? 0,
          bucket: bucket(days),
        };
      })
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.days - a.days);
    const sum = (f) => items.filter(f).reduce((t, r) => t + r.balance, 0);
    return {
      kpis: [
        ['total', 'Outstanding', sum(() => true), 'money'],
        ['over90', 'Over 90 days', sum((r) => r.days > 90), 'money'],
      ],
      items,
    };
  },
});

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

registerTile({
  key: 'billing-today',
  label: 'Billed today',
  group: GROUPS.BILLING,
  module: 'CORE',
  permission: 'reports:billing:read',
  kind: 'money',
  report: 'revenue-by-department',
  run: async () => {
    const from = new Date(`${istToday()}T00:00:00+05:30`);
    const bills = await Bill.find({ status: { $in: BILLED }, finalizedAt: { $gte: from } })
      .select('totals')
      .lean();
    return {
      value: bills.reduce((t, b) => t + (b.totals?.total ?? 0), 0),
      note: `${bills.length} bills`,
    };
  },
});

registerTile({
  key: 'collection-today',
  label: 'Collected today',
  group: GROUPS.BILLING,
  module: 'CORE',
  permission: 'reports:billing:read',
  kind: 'money',
  report: 'daily-collection',
  run: async () => {
    const rows = await Payment.find({ istDate: istToday(), status: 'CAPTURED' })
      .select('amount mode')
      .lean();
    const cash = rows.filter((p) => p.mode === 'CASH').reduce((t, p) => t + p.amount, 0);
    const total = rows.reduce((t, p) => t + p.amount, 0);
    return { value: total, note: total ? `${Math.round((cash * 100) / total)}% cash` : null };
  },
});

registerTile({
  key: 'outstanding',
  label: 'Outstanding bills',
  group: GROUPS.BILLING,
  module: 'CORE',
  permission: 'reports:billing:read',
  kind: 'money',
  report: 'outstanding-ageing',
  run: async () => {
    const rows = await Bill.find({ status: { $in: ['FINAL', 'PARTLY_PAID'] } })
      .select('totals')
      .lean();
    return {
      value: rows.reduce((t, b) => t + (b.totals?.balance ?? 0), 0),
      note: `${rows.length} bills`,
    };
  },
});
