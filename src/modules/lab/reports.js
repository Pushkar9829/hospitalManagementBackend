import { GROUPS, period, registerReport, registerTile, tone } from '../../core/reports/registry.js';
import { CriticalCall, LabItem, LabSample } from './models/lab.models.js';

/** Laboratory reports (catalogue group "Diagnostics", critical values under "Clinical"). */
const mins = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null);
const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const departments = async () => (await LabItem.distinct('department')).filter(Boolean).sort();

registerReport({
  code: 'lab-turnaround',
  name: 'Lab TAT by stage',
  group: GROUPS.DIAGNOSTICS,
  module: 'LAB',
  permission: 'reports:lab:read',
  description: 'Median minutes order → collection → receipt → release, by test.',
  filters: [{ key: 'department', label: 'Department', options: departments }],
  columns: [
    ['test', 'Test', 'text'],
    ['count', 'Released', 'count'],
    ['toCollect', 'Order to collection', 'minutes'],
    ['toReceive', 'Collection to lab', 'minutes'],
    ['toRelease', 'Lab to release', 'minutes'],
    ['total', 'Order to release', 'minutes'],
  ],
  run: async ({ from, to, filters }) => {
    const p = period({ from, to });
    const q = { releasedAt: { $gte: p.from, $lte: p.to } };
    if (filters.department) q.department = filters.department;
    const rows = await LabItem.find(q)
      .select('name orderedAt collectedAt receivedAt releasedAt')
      .lean();
    const by = new Map();
    for (const i of rows) by.set(i.name, [...(by.get(i.name) ?? []), i]);
    const items = [...by.entries()]
      .map(([test, is]) => ({
        test,
        count: is.length,
        toCollect: median(is.map((i) => mins(i.orderedAt, i.collectedAt))),
        toReceive: median(is.map((i) => mins(i.collectedAt, i.receivedAt))),
        toRelease: median(is.map((i) => mins(i.receivedAt, i.releasedAt))),
        total: median(is.map((i) => mins(i.orderedAt, i.releasedAt))),
      }))
      .sort((a, b) => b.count - a.count);
    return {
      kpis: [
        ['released', 'Tests released', rows.length, 'count'],
        [
          'median',
          'Median order to release',
          median(rows.map((i) => mins(i.orderedAt, i.releasedAt))),
          'minutes',
        ],
      ],
      items,
    };
  },
});

registerReport({
  code: 'lab-sample-rejections',
  name: 'Sample rejections',
  group: GROUPS.DIAGNOSTICS,
  module: 'LAB',
  permission: 'reports:lab:read',
  description: 'Rejected samples with the reason, for recollection follow-up.',
  columns: [
    ['rejectedAt', 'Rejected', 'datetime'],
    ['sampleNo', 'Sample', 'id'],
    ['patient', 'Patient', 'text'],
    ['tests', 'Tests', 'text'],
    ['reason', 'Reason', 'text'],
    ['by', 'By', 'text'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const [rows, all] = await Promise.all([
      LabSample.find({ rejectedAt: { $gte: p.from, $lte: p.to } })
        .sort({ rejectedAt: 1 })
        .lean(),
      LabSample.countDocuments({ collectedAt: { $gte: p.from, $lte: p.to } }),
    ]);
    const byReason = new Map();
    for (const s of rows) byReason.set(s.rejectReason, (byReason.get(s.rejectReason) ?? 0) + 1);
    const top = [...byReason.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      kpis: [
        ['rejected', 'Rejected', rows.length, 'count'],
        [
          'rate',
          'Rejection rate',
          all ? Math.round((rows.length * 1000) / all) / 10 : 0,
          'percent',
        ],
        ['top', 'Commonest reason', top ? `${top[0]} (${top[1]})` : '—', 'text'],
      ],
      items: rows.map((s) => ({
        rejectedAt: s.rejectedAt,
        sampleNo: s.sampleNo,
        patient: s.patient?.name ?? '',
        tests: (s.tests ?? []).join(', '),
        reason: [s.rejectReason, s.rejectNote].filter(Boolean).join(' · '),
        by: s.rejectedBy ?? '',
      })),
    };
  },
});

registerReport({
  code: 'lab-test-volume',
  name: 'Test volume',
  group: GROUPS.DIAGNOSTICS,
  module: 'LAB',
  permission: 'reports:lab:read',
  description: 'Tests ordered by source (OPD, IPD, walk-in) and how many were released.',
  filters: [{ key: 'department', label: 'Department', options: departments }],
  columns: [
    ['test', 'Test', 'text'],
    ['department', 'Department', 'text'],
    ['OPD', 'OPD', 'count'],
    ['IPD', 'IPD', 'count'],
    ['WALKIN', 'Walk-in', 'count'],
    ['released', 'Released', 'count'],
  ],
  run: async ({ from, to, filters }) => {
    const p = period({ from, to });
    const q = { orderedAt: { $gte: p.from, $lte: p.to }, status: { $ne: 'CANCELLED' } };
    if (filters.department) q.department = filters.department;
    const rows = await LabItem.find(q).select('name department source status').lean();
    const by = new Map();
    for (const i of rows) {
      const r = by.get(i.name) ?? {
        test: i.name,
        department: i.department ?? '',
        OPD: 0,
        IPD: 0,
        WALKIN: 0,
        released: 0,
      };
      r[i.source] = (r[i.source] ?? 0) + 1;
      if (i.status === 'RELEASED') r.released += 1;
      by.set(i.name, r);
    }
    return {
      kpis: [['ordered', 'Tests ordered', rows.length, 'count']],
      items: [...by.values()].sort((a, b) => b.OPD + b.IPD + b.WALKIN - (a.OPD + a.IPD + a.WALKIN)),
    };
  },
});

registerReport({
  code: 'critical-value-log',
  name: 'Critical value log',
  group: GROUPS.CLINICAL,
  module: 'LAB',
  permission: 'reports:lab:read',
  description: 'Critical results, who was told, read-back, and minutes to inform (NABH).',
  columns: [
    ['at', 'Found', 'datetime'],
    ['patient', 'Patient', 'text'],
    ['test', 'Test', 'text'],
    ['value', 'Value', 'text'],
    ['informed', 'Informed', 'text'],
    ['minutes', 'Minutes to inform', 'minutes'],
    ['status', 'Status', 'status'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await CriticalCall.find({ createdAt: { $gte: p.from, $lte: p.to } })
      .sort({ createdAt: 1 })
      .lean();
    const items = rows.map((c) => {
      const reached = (c.attempts ?? []).find((a) => a.reached);
      const m = mins(c.createdAt, c.doneAt);
      return {
        at: c.createdAt,
        patient: c.patient?.name ?? '',
        test: [c.test, c.analyte].filter(Boolean).join(' · '),
        value: [c.value, c.flag].filter(Boolean).join(' '),
        informed: reached ? `${reached.to}${reached.readBack ? ' (read back)' : ''}` : '',
        minutes: m,
        status:
          c.status === 'OPEN'
            ? tone.bad('Not informed')
            : m <= 30
              ? tone.ok('Within 30 min')
              : tone.warn('Late'),
      };
    });
    return {
      kpis: [
        ['calls', 'Critical values', rows.length, 'count'],
        ['median', 'Median minutes to inform', median(items.map((i) => i.minutes)), 'minutes'],
      ],
      items,
    };
  },
});

registerTile({
  key: 'lab-pending',
  label: 'Lab tests in progress',
  group: GROUPS.DIAGNOSTICS,
  module: 'LAB',
  permission: 'reports:lab:read',
  report: 'lab-turnaround',
  run: async () => {
    const [pending, critical] = await Promise.all([
      LabItem.countDocuments({ status: { $nin: ['RELEASED', 'CANCELLED', 'ORDERED'] } }),
      CriticalCall.countDocuments({ status: 'OPEN' }),
    ]);
    return {
      value: pending,
      note: critical ? `${critical} critical not yet informed` : 'No critical value waiting',
      tone: critical ? 'critical' : null,
    };
  },
});
