import { GROUPS, period, registerReport, tone } from '../../core/reports/registry.js';
import { RadStudy } from './models/rad.models.js';

/** Radiology reports. */
const mins = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null);
const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

registerReport({
  code: 'rad-tat',
  name: 'Radiology TAT',
  group: GROUPS.DIAGNOSTICS,
  module: 'RAD',
  permission: 'reports:rad:read',
  description: 'Median minutes from arrival to scan and scan to signed report, by modality.',
  columns: [
    ['modality', 'Modality', 'text'],
    ['studies', 'Signed', 'count'],
    ['toScan', 'Arrival to scan', 'minutes'],
    ['toReport', 'Scan to signed report', 'minutes'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await RadStudy.find({ signedAt: { $gte: p.from, $lte: p.to } }).lean();
    const by = new Map();
    for (const s of rows) by.set(s.modality ?? '—', [...(by.get(s.modality ?? '—') ?? []), s]);
    return {
      kpis: [
        [
          'median',
          'Median scan to report',
          median(rows.map((s) => mins(s.performedAt, s.signedAt))),
          'minutes',
        ],
      ],
      items: [...by.entries()].map(([modality, ss]) => ({
        modality,
        studies: ss.length,
        toScan: median(ss.map((s) => mins(s.arrivedAt, s.performedAt))),
        toReport: median(ss.map((s) => mins(s.performedAt, s.signedAt))),
      })),
    };
  },
});

registerReport({
  code: 'pcpndt-form-f',
  name: 'PCPNDT Form F register',
  group: GROUPS.DIAGNOSTICS,
  module: 'RAD',
  permission: 'reports:rad:read',
  description: 'Obstetric ultrasounds with Form F: weeks, indication, declaration (PCPNDT Act).',
  columns: [
    ['at', 'Date', 'datetime'],
    ['accessionNo', 'Accession', 'id'],
    ['patient', 'Patient', 'text'],
    ['weeks', 'Weeks', 'number'],
    ['indication', 'Indication', 'text'],
    ['doctor', 'Referred by', 'text'],
    ['form', 'Form F', 'status'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await RadStudy.find({ 'formF.at': { $gte: p.from, $lte: p.to } })
      .sort({ 'formF.at': 1 })
      .lean();
    return {
      kpis: [['forms', 'Form F filed', rows.length, 'count']],
      items: rows.map((s) => ({
        at: s.formF.at,
        accessionNo: s.accessionNo,
        patient: s.patient?.name ?? '',
        weeks: s.formF.weeks ?? null,
        indication: s.formF.indication ?? '',
        doctor: s.doctor?.name ?? '',
        form:
          s.formF.declaration && s.formF.patientSigned
            ? tone.ok('Complete')
            : tone.bad('Incomplete'),
      })),
    };
  },
});
