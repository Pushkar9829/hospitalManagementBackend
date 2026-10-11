import { registerHome, status } from '../../core/home/registry.js';
import { Bill, CashierShift, Payment, Refund } from './models/billing.models.js';

/** Billing widgets: the cashier's shift, the billing manager's checks, accounts and audit. */
const DAY = 86_400_000;
const monthStart = (ctx) => new Date(`${ctx.today.slice(0, 7)}-01T00:00:00+05:30`);
const sumAmount = async (match) =>
  (
    await Payment.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: '$amount' } } }])
  )[0]?.t ?? 0;

// ---- cashier

registerHome({
  id: 'bill.myShift',
  panels: ['cashier', 'clinic'],
  permission: 'billing:shift:read',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const shift = await CashierShift.findOne({ userId: ctx.userId, status: 'OPEN' })
      .select('_id openedAt counter')
      .lean();
    if (!shift)
      return {
        value: null,
        format: 'money',
        params: { context: 'closed' },
        tone: 'warning',
        link: '/billing/shift',
      };
    const collected = await sumAmount({ shiftId: shift._id, status: 'CAPTURED' });
    return {
      value: collected,
      format: 'money',
      params: { counter: shift.counter, since: shift.openedAt },
      link: '/billing/shift',
    };
  },
});

registerHome({
  id: 'bill.myBills',
  panels: ['cashier'],
  permission: 'billing:bill:read',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => ({
    value: await Bill.countDocuments({
      finalizedBy: ctx.userId,
      finalizedAt: { $gte: ctx.day.start, $lte: ctx.day.end },
    }),
    format: 'count',
    link: '/billing?tab=bills',
  }),
});

registerHome({
  id: 'bill.drafts',
  panels: ['cashier', 'billingmgr'],
  permission: 'billing:bill:read',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => {
    const [n, old] = await Promise.all([
      Bill.countDocuments({ status: 'DRAFT' }),
      Bill.countDocuments({
        status: 'DRAFT',
        createdAt: { $lt: new Date(ctx.now.getTime() - DAY) },
      }),
    ]);
    return {
      value: n,
      format: 'count',
      params: { old },
      tone: old ? 'warning' : 'neutral',
      link: '/billing?tab=bills',
    };
  },
});

registerHome({
  id: 'bill.myHolds',
  panels: ['cashier'],
  permission: 'billing:bill:read',
  kind: 'kpi',
  order: 40,
  build: async (ctx) => ({
    value: await Bill.countDocuments({
      createdBy: ctx.userId,
      hold: { $in: ['DISCOUNT', 'CANCELLATION'] },
    }),
    format: 'count',
    link: '/billing?tab=bills',
  }),
});

registerHome({
  id: 'bill.draftList',
  panels: ['cashier'],
  permission: 'billing:bill:read',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await Bill.find({ status: 'DRAFT' })
      .select('patient lines.name totals.total hold createdAt')
      .sort({ createdAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/billing?tab=bills',
      columns: [
        { key: 'patient', kind: 'text' },
        { key: 'charges', kind: 'text' },
        { key: 'amount', kind: 'money' },
        { key: 'waited', kind: 'minutes' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((b) => ({
        id: String(b._id),
        link: `/billing/bills/${b._id}`,
        patient: b.patient?.name,
        charges:
          (b.lines ?? [])
            .map((l) => l.name)
            .slice(0, 3)
            .join(', ') + ((b.lines?.length ?? 0) > 3 ? ' …' : ''),
        amount: b.totals?.total ?? 0,
        waited: Math.round((ctx.now - new Date(b.createdAt)) / 60_000),
        status: b.hold ? status(`HOLD_${b.hold}`, 'warning') : status('DRAFT', 'info'),
      })),
    };
  },
});

// ---- billing manager, accounts, admin

registerHome({
  id: 'bill.collectionToday',
  panels: ['billingmgr', 'accounts', 'admin', 'superadmin'],
  permission: 'reports:billing:read',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const [amount, counters] = await Promise.all([
      sumAmount({ istDate: ctx.today, status: 'CAPTURED' }),
      CashierShift.countDocuments({ status: 'OPEN' }),
    ]);
    return {
      value: amount,
      format: 'money',
      params: { counters },
      link: '/billing/analytics?period=today',
    };
  },
});

registerHome({
  id: 'bill.shiftsToVerify',
  panels: ['billingmgr'],
  permission: 'billing:shift:verify',
  kind: 'kpi',
  order: 20,
  build: async () => {
    const n = await CashierShift.countDocuments({ status: 'COUNTED' });
    return {
      value: n,
      format: 'count',
      tone: n ? 'warning' : 'neutral',
      link: '/billing/shift?tab=verify',
    };
  },
});

registerHome({
  id: 'bill.refundsToPay',
  panels: ['billingmgr', 'cashier'],
  permission: 'billing:refund:read',
  kind: 'kpi',
  order: 50,
  build: async () => {
    const rows = await Refund.find({ status: 'APPROVED' }).select('amount').lean();
    return {
      value: rows.length,
      format: 'count',
      params: { amount: rows.reduce((t, r) => t + r.amount, 0) },
      link: '/billing?tab=refunds',
    };
  },
});

registerHome({
  id: 'bill.shiftList',
  panels: ['billingmgr'],
  permission: 'billing:shift:verify',
  kind: 'list',
  order: 100,
  build: async () => {
    const rows = await CashierShift.find({ status: { $in: ['OPEN', 'COUNTED'] } })
      .select('userName counter status openedAt closedAt cashVariance')
      .sort({ status: 1, openedAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/billing/shift',
      columns: [
        { key: 'cashier', kind: 'text' },
        { key: 'counter', kind: 'text' },
        { key: 'opened', kind: 'time' },
        { key: 'variance', kind: 'money' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((s) => ({
        id: String(s._id),
        cashier: s.userName,
        counter: s.counter,
        opened: s.openedAt,
        variance: s.cashVariance ?? null,
        status: status(s.status, s.status === 'COUNTED' ? 'warning' : 'success'),
      })),
    };
  },
});

registerHome({
  id: 'bill.revenueMonth',
  panels: ['accounts', 'superadmin'],
  permission: 'reports:billing:read',
  kind: 'kpi',
  order: 5,
  build: async (ctx) => {
    const [r] = await Bill.aggregate([
      {
        $match: {
          status: { $in: ['FINAL', 'PARTLY_PAID', 'PAID'] },
          finalizedAt: { $gte: monthStart(ctx), $lte: ctx.day.end },
        },
      },
      { $group: { _id: null, net: { $sum: '$totals.total' }, n: { $sum: 1 } } },
    ]);
    return {
      value: r?.net ?? 0,
      format: 'money',
      params: { bills: r?.n ?? 0 },
      link: '/billing/analytics',
    };
  },
});

registerHome({
  id: 'bill.receivables60',
  panels: ['accounts', 'billingmgr'],
  permission: 'reports:billing:read',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => {
    const rows = await Bill.find({
      status: { $in: ['FINAL', 'PARTLY_PAID'] },
      finalizedAt: { $lt: new Date(ctx.now.getTime() - 60 * DAY) },
    })
      .select('totals.balance payer.kind')
      .lean();
    const due = rows.filter((b) => (b.totals?.balance ?? 0) > 0);
    return {
      value: due.reduce((t, b) => t + b.totals.balance, 0),
      format: 'money',
      params: { bills: due.length },
      tone: due.length ? 'warning' : 'neutral',
      link: '/billing/analytics',
    };
  },
});

// ---- auditor: unusual billing this month

registerHome({
  id: 'bill.auditDiscounts',
  panels: ['auditor'],
  permission: 'audit:log:read',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => {
    const bills = await Bill.find({
      finalizedAt: { $gte: monthStart(ctx), $lte: ctx.day.end },
      'totals.discount': { $gt: 0 },
    })
      .select('totals.gross totals.discount')
      .lean();
    const big = bills.filter((b) => b.totals.discount * 10 > b.totals.gross);
    return {
      value: big.length,
      format: 'count',
      tone: big.length ? 'warning' : 'neutral',
      link: '/audit',
    };
  },
});

registerHome({
  id: 'bill.auditCancelled',
  panels: ['auditor'],
  permission: 'audit:log:read',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => {
    const rows = await Bill.find({
      status: 'CANCELLED',
      'cancellation.at': { $gte: monthStart(ctx) },
    })
      .select('totals.total')
      .lean();
    return {
      value: rows.length,
      format: 'count',
      params: { amount: rows.reduce((t, b) => t + (b.totals?.total ?? 0), 0) },
      link: '/audit',
    };
  },
});
