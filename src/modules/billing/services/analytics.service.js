import { istDate, period } from '../../../core/reports/registry.js';
import { Bill, CashierShift, Payment, Refund } from '../models/billing.models.js';

/**
 * Billing analytics (design board "Billing analytics"): revenue by service group and payer,
 * collection efficiency and days to collect, receivables by age and payer, and the leakage checks
 * a billing manager reviews (discounts, cancellations, refunds, old drafts, shift variances).
 * Money in paise; dates are IST calendar days.
 */
const DAY = 86_400_000;
const BILLED = ['FINAL', 'PARTLY_PAID', 'PAID'];
const PAYERS = ['CASH', 'INSURANCE', 'CORPORATE', 'SCHEME'];
const BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'd90'];
const VARIANCE_PAISE = 10_000; // ₹100 a shift (board: "under ₹100 a shift")

const payerOf = (b) => (PAYERS.includes(b.payer?.kind) ? b.payer.kind : 'CASH');
const bucketOf = (days) =>
  days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90';
const pct = (part, whole) => (whole ? Math.round((part * 1000) / whole) / 10 : 0);
const sum = (rows, f) => rows.reduce((t, r) => t + (f(r) ?? 0), 0);

/** The same number of days just before `from` (for "up 8% vs last period"). */
function previousRange(from, to) {
  const days = Math.round((new Date(to) - new Date(from)) / DAY) + 1;
  const end = new Date(new Date(`${from}T00:00:00Z`).getTime() - DAY);
  const start = new Date(end.getTime() - (days - 1) * DAY);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

async function netBilled(range) {
  const p = period(range);
  const [r] = await Bill.aggregate([
    { $match: { status: { $in: BILLED }, finalizedAt: { $gte: p.from, $lte: p.to } } },
    { $group: { _id: null, net: { $sum: '$totals.total' } } },
  ]);
  return r?.net ?? 0;
}

export async function billingAnalytics({ from, to }) {
  const p = period({ from, to });
  const [bills, payments, refunds, shifts, cancelled, oldDrafts, outstanding, previousNet] =
    await Promise.all([
      Bill.find({ status: { $in: BILLED }, finalizedAt: { $gte: p.from, $lte: p.to } })
        .select('type payer totals lines.category lines.net finalizedAt status')
        .lean(),
      Payment.find({ status: 'CAPTURED', createdAt: { $gte: p.from, $lte: p.to } })
        .select('amount modeKind allocations createdAt istDate')
        .lean(),
      Refund.find({ status: 'PAID', paidAt: { $gte: p.from, $lte: p.to } })
        .select('amount')
        .lean(),
      CashierShift.find({ closedAt: { $gte: p.from, $lte: p.to } })
        .select('cashVariance varianceReason')
        .lean(),
      Bill.find({ status: 'CANCELLED', 'cancellation.at': { $gte: p.from, $lte: p.to } })
        .select('totals.total')
        .lean(),
      Bill.countDocuments({ status: 'DRAFT', createdAt: { $lte: new Date(Date.now() - DAY) } }),
      Bill.find({ status: { $in: ['FINAL', 'PARTLY_PAID'] }, finalizedAt: { $lte: p.to } })
        .select('payer totals.balance finalizedAt')
        .lean(),
      netBilled(previousRange(from, to)),
    ]);

  const gross = sum(bills, (b) => b.totals?.gross);
  const discount = sum(bills, (b) => b.totals?.discount);
  const net = sum(bills, (b) => b.totals?.total);
  const collected = sum(payments, (x) => x.amount);
  const refunded = sum(refunds, (x) => x.amount);

  // Revenue by service group (the line's category) and by payer.
  const groups = new Map();
  for (const b of bills)
    for (const l of b.lines ?? []) {
      const g = l.category || 'OTHER';
      groups.set(g, (groups.get(g) ?? 0) + (l.net ?? 0));
    }
  const payers = new Map(PAYERS.map((k) => [k, 0]));
  for (const b of bills) payers.set(payerOf(b), payers.get(payerOf(b)) + (b.totals?.total ?? 0));

  // Days to collect: final bill to the receipt that cleared it, for bills paid in full.
  const paidIds = new Set(bills.filter((b) => b.status === 'PAID').map((b) => String(b._id)));
  const lastReceipt = new Map();
  if (paidIds.size) {
    const clearing = await Payment.find({
      status: 'CAPTURED',
      'allocations.billId': { $in: [...paidIds] },
    })
      .select('allocations createdAt')
      .lean();
    for (const x of clearing)
      for (const a of x.allocations ?? []) {
        const k = String(a.billId);
        if (!paidIds.has(k)) continue;
        if (!lastReceipt.has(k) || lastReceipt.get(k) < x.createdAt)
          lastReceipt.set(k, x.createdAt);
      }
  }
  const lags = bills
    .filter((b) => lastReceipt.has(String(b._id)))
    .map((b) => Math.max(0, (lastReceipt.get(String(b._id)) - b.finalizedAt) / DAY));
  const daysToCollect = lags.length
    ? Math.round((lags.reduce((t, d) => t + d, 0) / lags.length) * 10) / 10
    : null;

  // Receivables on the end date, by payer and age.
  const ageing = new Map(
    ['PATIENT', 'INSURANCE', 'CORPORATE', 'SCHEME'].map((k) => [
      k,
      Object.fromEntries([...BUCKETS, 'total'].map((x) => [x, 0])),
    ]),
  );
  for (const b of outstanding) {
    const bal = b.totals?.balance ?? 0;
    if (bal <= 0) continue;
    const kind = payerOf(b) === 'CASH' ? 'PATIENT' : payerOf(b);
    const row = ageing.get(kind);
    row[bucketOf(Math.floor((p.to - b.finalizedAt) / DAY))] += bal;
    row.total += bal;
  }

  // Daily trend: billed and collected per IST day.
  const days = new Map();
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d = new Date(d.getTime() + DAY)
  )
    days.set(d.toISOString().slice(0, 10), {
      date: d.toISOString().slice(0, 10),
      billed: 0,
      collected: 0,
    });
  for (const b of bills) {
    const r = days.get(istDate(b.finalizedAt));
    if (r) r.billed += b.totals?.total ?? 0;
  }
  for (const x of payments) {
    const r = days.get(x.istDate ?? istDate(x.createdAt));
    if (r) r.collected += x.amount;
  }

  const variances = shifts.map((s) => Math.abs(s.cashVariance ?? 0));
  return {
    from,
    to,
    revenue: {
      bills: bills.length,
      op: bills.filter((b) => b.type === 'OP').length,
      ip: bills.filter((b) => b.type === 'IP').length,
      gross,
      discount,
      net,
      averageDay: Math.round(net / Math.max(1, days.size)),
      previousNet,
      change: previousNet ? pct(net - previousNet, previousNet) : null,
    },
    collection: {
      collected,
      refunded,
      efficiency: pct(collected, net),
      daysToCollect,
      patientDues: ageing.get('PATIENT').total,
    },
    byGroup: [...groups.entries()]
      .map(([group, amount]) => ({ group, amount }))
      .sort((a, b) => b.amount - a.amount),
    byPayer: [...payers.entries()].map(([payer, amount]) => ({ payer, amount })),
    ageing: [...ageing.entries()].map(([payer, row]) => ({ payer, ...row })),
    leakage: {
      discount: { amount: discount, percent: pct(discount, gross) },
      cancellations: { count: cancelled.length, amount: sum(cancelled, (b) => b.totals?.total) },
      refunds: { count: refunds.length, amount: refunded },
      oldDrafts,
      shiftVariance: {
        shifts: shifts.length,
        over: variances.filter((v) => v > VARIANCE_PAISE).length,
        total: variances.reduce((t, v) => t + v, 0),
        threshold: VARIANCE_PAISE,
      },
    },
    daily: [...days.values()],
  };
}
