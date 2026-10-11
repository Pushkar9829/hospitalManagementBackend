import { GROUPS, period, registerReport, registerTile, tone } from '../../core/reports/registry.js';
import { BirthRecord, DeathRecord, MrdRecord } from './models/mrd.models.js';

/** Medical records reports. */
const DAY = 86_400_000;

registerReport({
  code: 'clinical-morbidity-icd',
  name: 'Morbidity by ICD-10',
  group: GROUPS.CLINICAL,
  module: 'MRD',
  permission: 'reports:mrd:read',
  description: 'Primary diagnoses of coded discharges, most frequent first.',
  columns: [
    ['code', 'ICD-10', 'id'],
    ['name', 'Diagnosis', 'text'],
    ['cases', 'Cases', 'count'],
    ['deaths', 'Deaths', 'count'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await MrdRecord.find({
      status: 'CLOSED',
      dischargedAt: { $gte: p.from, $lte: p.to },
    }).lean();
    const by = new Map();
    for (const r of rows) {
      const d = r.diagnoses.find((x) => x.primary) ?? r.diagnoses[0];
      if (!d) continue;
      const x = by.get(d.code) ?? { code: d.code, name: d.name, cases: 0, deaths: 0 };
      x.cases += 1;
      if (r.outcome === 'DEATH') x.deaths += 1;
      by.set(d.code, x);
    }
    return {
      kpis: [['coded', 'Coded discharges', rows.length, 'count']],
      items: [...by.values()].sort((a, b) => b.cases - a.cases),
    };
  },
});

registerReport({
  code: 'record-deficiencies',
  name: 'Record deficiencies',
  group: GROUPS.SUPPORT,
  module: 'MRD',
  permission: 'reports:mrd:read',
  description: 'Discharged records still missing items, oldest first, by consultant.',
  columns: [
    ['ipNo', 'IP no.', 'id'],
    ['patient', 'Patient', 'text'],
    ['consultant', 'Consultant', 'text'],
    ['dischargedAt', 'Discharged', 'date'],
    ['days', 'Days open', 'days'],
    ['missing', 'Missing', 'text'],
  ],
  run: async () => {
    const rows = await MrdRecord.find({ status: 'DEFICIENT' }).sort({ dischargedAt: 1 }).lean();
    return {
      kpis: [
        ['records', 'Deficient records', rows.length, 'count'],
        [
          'over7',
          'Open over 7 days',
          rows.filter((r) => Date.now() - r.dischargedAt > 7 * DAY).length,
          'count',
        ],
      ],
      items: rows.map((r) => ({
        ipNo: r.ipNo,
        patient: r.patient?.name ?? '',
        consultant: r.consultant?.name ?? '',
        dischargedAt: r.dischargedAt,
        days: Math.floor((Date.now() - r.dischargedAt) / DAY),
        missing: r.checklist
          .filter((c) => !c.ok)
          .map((c) => c.label)
          .join(', '),
      })),
    };
  },
});

registerReport({
  code: 'births-deaths',
  name: 'Births and deaths',
  group: GROUPS.SUPPORT,
  module: 'MRD',
  permission: 'reports:mrd:read',
  description: 'Registers with the Civil Registration System report status.',
  columns: [
    ['at', 'Date', 'datetime'],
    ['kind', 'Event', 'text'],
    ['regNo', 'Register no.', 'id'],
    ['name', 'Mother / deceased', 'text'],
    ['detail', 'Details', 'text'],
    ['crs', 'CRS report', 'status'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const [births, deaths] = await Promise.all([
      BirthRecord.find({ bornAt: { $gte: p.from, $lte: p.to } }).lean(),
      DeathRecord.find({ diedAt: { $gte: p.from, $lte: p.to } }).lean(),
    ]);
    const crs = (x) =>
      x.reportedAt
        ? tone.ok(`Reported ${x.crsRefNo ?? ''}`.trim())
        : x.crsDueBy < new Date()
          ? tone.bad('Overdue')
          : tone.warn('Due');
    const items = [
      ...births.map((b) => ({
        at: b.bornAt,
        kind: 'Birth',
        regNo: b.regNo,
        name: b.mother?.name ?? '',
        detail: `${b.sex} · ${b.weightGrams ?? '–'} g · ${b.deliveryType}`,
        crs: crs(b),
      })),
      ...deaths.map((d) => ({
        at: d.diedAt,
        kind: 'Death',
        regNo: d.regNo,
        name: d.patient?.name ?? '',
        detail: `${d.cause?.immediate ?? ''}${d.mlc ? ' · MLC' : ''}`,
        crs: crs(d),
      })),
    ].sort((a, b) => a.at - b.at);
    return {
      kpis: [
        ['births', 'Births', births.length, 'count'],
        ['deaths', 'Deaths', deaths.length, 'count'],
      ],
      items,
    };
  },
});

registerTile({
  key: 'mrd-deficient',
  label: 'Records with deficiencies',
  group: GROUPS.SUPPORT,
  module: 'MRD',
  permission: 'reports:mrd:read',
  report: 'record-deficiencies',
  run: async () => {
    const n = await MrdRecord.countDocuments({ status: 'DEFICIENT' });
    const old = await MrdRecord.countDocuments({
      status: 'DEFICIENT',
      dischargedAt: { $lt: new Date(Date.now() - 7 * DAY) },
    });
    return { value: n, note: old ? `${old} over 7 days` : null, tone: old ? 'warning' : null };
  },
});
