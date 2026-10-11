import { CriticalCall, LabItem, LabSample, QcRun } from '../models/lab.models.js';
import { atIST, settingsDoc, ymdIST } from './common.js';

/** Lab analytics (LAB.md sections 8 and 9). */

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const pct = (n, d) => (d ? Math.round((n * 1000) / d) / 10 : null);
const minutes = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : NaN);

function range(period = 'today') {
  const to = ymdIST();
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 1;
  const start = new Date(atIST(to).getTime() - (days - 1) * 86_400_000);
  return { from: ymdIST(start), to, start, end: new Date(atIST(to).getTime() + 86_400_000) };
}

/** Turnaround: median minutes per stage and the share released within target, by test (R11). */
export async function tat({ period = 'today', department } = {}) {
  const { from, to, start, end } = range(period);
  const filter = { releasedAt: { $gte: start, $lt: end }, status: 'RELEASED' };
  if (department) filter.department = department;
  const items = await LabItem.find(filter).lean();
  const stage = (pick) => median(items.map(pick));
  const byTest = new Map();
  for (const i of items) {
    const k = i.code;
    if (!byTest.has(k)) byTest.set(k, { code: k, name: i.name, n: 0, inTarget: 0, mins: [] });
    const t = byTest.get(k);
    t.n += 1;
    if (i.dueAt && i.releasedAt <= i.dueAt) t.inTarget += 1;
    t.mins.push(minutes(i.source === 'IPD' ? i.collectedAt : i.receivedAt, i.releasedAt));
  }
  const s = await settingsDoc();
  return {
    period,
    from,
    to,
    released: items.length,
    withinTarget: pct(items.filter((i) => i.dueAt && i.releasedAt <= i.dueAt).length, items.length),
    stages: [
      {
        stage: 'COLLECT_TO_RECEIVE',
        medianMin: stage((i) => minutes(i.collectedAt, i.receivedAt)),
      },
      { stage: 'RECEIVE_TO_RESULT', medianMin: stage((i) => minutes(i.receivedAt, i.enteredAt)) },
      { stage: 'RESULT_TO_RELEASE', medianMin: stage((i) => minutes(i.enteredAt, i.releasedAt)) },
    ],
    byPriority: ['STAT', 'URGENT', 'ROUTINE'].map((p) => {
      const rows = items.filter((i) => i.priority === p);
      return {
        priority: p,
        released: rows.length,
        targetMin: p === 'ROUTINE' ? s.tatMin.ROUTINE : s.tatMin[p],
        withinTarget: pct(
          rows.filter((i) => i.dueAt && i.releasedAt <= i.dueAt).length,
          rows.length,
        ),
      };
    }),
    byTest: [...byTest.values()]
      .map((t) => ({
        code: t.code,
        name: t.name,
        released: t.n,
        medianMin: median(t.mins),
        withinTarget: pct(t.inTarget, t.n),
      }))
      .sort((a, b) => b.released - a.released),
  };
}

/** NABL quality indicators and volume for the period (LAB.md section 9). */
export async function indicators({ period = 'today' } = {}) {
  const { from, to, start, end } = range(period);
  const s = await settingsDoc();
  const [ordered, released, samples, calls, qc, pending] = await Promise.all([
    LabItem.find({ orderedAt: { $gte: start, $lt: end }, status: { $ne: 'CANCELLED' } })
      .select('department source priority')
      .lean(),
    LabItem.find({ releasedAt: { $gte: start, $lt: end } })
      .select('reportVersion')
      .lean(),
    LabSample.find({ collectedAt: { $gte: start, $lt: end } })
      .select('status rejectReason location')
      .lean(),
    CriticalCall.find({ createdAt: { $gte: start, $lt: end } }).lean(),
    QcRun.find({ at: { $gte: start, $lt: end } })
      .select('status analyser')
      .lean(),
    LabItem.aggregate([
      { $match: { status: { $in: ['ORDERED', 'COLLECTED', 'RECEIVED', 'RESULTED', 'VERIFIED'] } } },
      { $group: { _id: '$department', n: { $sum: 1 } } },
    ]),
  ]);
  const rejected = samples.filter((x) => x.status === 'REJECTED');
  const callsInTime = calls.filter(
    (c) => c.doneAt && minutes(c.createdAt, c.doneAt) <= s.criticalCallMin,
  );
  const count = (rows, key) => {
    const m = new Map();
    for (const r of rows) m.set(r[key] ?? 'OTHER', (m.get(r[key] ?? 'OTHER') ?? 0) + 1);
    return [...m.entries()]
      .map(([k, n]) => ({ key: k, count: n }))
      .sort((a, b) => b.count - a.count);
  };
  return {
    period,
    from,
    to,
    ordered: ordered.length,
    released: released.length,
    stat: ordered.filter((i) => i.priority === 'STAT').length,
    samples: samples.length,
    rejectionRate: pct(rejected.length, samples.length),
    rejected: rejected.length,
    rejectionsByReason: count(rejected, 'rejectReason'),
    rejectionsByLocation: count(rejected, 'location'),
    criticalCalls: calls.length,
    criticalInTime: pct(callsInTime.length, calls.length),
    criticalOpen: calls.filter((c) => c.status === 'OPEN').length,
    qcRuns: qc.length,
    qcRejectionRate: pct(qc.filter((r) => r.status === 'REJECTED').length, qc.length),
    amendedRate: pct(released.filter((r) => (r.reportVersion ?? 1) > 1).length, released.length),
    byDepartment: count(ordered, 'department'),
    bySource: count(ordered, 'source'),
    pendingByDepartment: pending.map((p) => ({ key: p._id, count: p.n })),
    targets: { criticalInTime: 100, rejectionRate: 1, qcRejectionRate: 2 },
  };
}
