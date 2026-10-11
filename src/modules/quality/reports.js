import { GROUPS, registerReport, registerTile, tone } from '../../core/reports/registry.js';
import { indicators, infectionRates, overview } from './services/quality.service.js';

/** Quality reports: NABH indicators and infection rates (per calendar month). */
const monthsIn = (from, to) => {
  const out = [];
  let m = from.slice(0, 7);
  while (m <= to.slice(0, 7) && out.length < 13) {
    out.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  return out;
};

const LABELS = {
  opdWaitMin: ['OPD waiting time', 'minutes'],
  dischargeTatMin: ['Discharge turnaround', 'minutes'],
  labTatMin: ['Lab turnaround', 'minutes'],
  criticalCallMin: ['Critical value reporting', 'minutes'],
  medErrorsPer1000: ['Medication errors per 1,000 patient days', 'number'],
  fallsPer1000: ['Falls per 1,000 patient days', 'number'],
  bedOccupancyPct: ['Bed occupancy', 'percent'],
  icuReturn48h: ['Return to ICU within 48 h', 'count'],
  nps: ['Net Promoter Score', 'number'],
  complaintsOnTimePct: ['Complaints resolved on time', 'percent'],
};

registerReport({
  code: 'nabh-indicators',
  name: 'NABH indicators',
  group: GROUPS.SUPPORT,
  module: 'QLT',
  permission: 'reports:quality:read',
  description: 'Monthly quality indicators computed from system data against targets.',
  columns: [
    ['month', 'Month', 'text'],
    ['indicator', 'Indicator', 'text'],
    ['value', 'Value', 'number'],
    ['target', 'Target', 'number'],
    ['status', 'Status', 'status'],
  ],
  run: async ({ from, to }) => {
    const items = [];
    for (const month of monthsIn(from, to)) {
      const r = await indicators({ month });
      for (const i of r.items)
        items.push({
          month,
          indicator: LABELS[i.key]?.[0] ?? i.key,
          value: i.value,
          target: i.target ?? null,
          status:
            i.met == null ? tone.plain('No data') : i.met ? tone.ok('Met') : tone.bad('Not met'),
        });
    }
    return {
      kpis: [
        [
          'missed',
          'Indicators not met',
          items.filter((i) => i.status.tone === 'critical').length,
          'count',
        ],
      ],
      items,
    };
  },
});

registerReport({
  code: 'infection-rates',
  name: 'Infection rates',
  group: GROUPS.CLINICAL,
  module: 'QLT',
  permission: 'reports:quality:read',
  description: 'CAUTI, CLABSI and VAP per 1,000 device days and SSI per 100 surgeries, by month.',
  columns: [
    ['month', 'Month', 'text'],
    ['infection', 'Infection', 'text'],
    ['cases', 'Cases', 'count'],
    ['exposure', 'Device days / surgeries', 'count'],
    ['rate', 'Rate', 'number'],
  ],
  run: async ({ from, to }) => {
    const items = [];
    for (const month of monthsIn(from, to)) {
      const r = await infectionRates({ month });
      for (const [k, label] of [
        ['cauti', 'CAUTI'],
        ['clabsi', 'CLABSI'],
        ['vap', 'VAP'],
        ['ssi', 'SSI'],
      ])
        items.push({
          month,
          infection: label,
          cases: r[k].cases,
          exposure: r[k].deviceDays ?? r[k].surgeries ?? 0,
          rate: r[k].rate,
        });
    }
    return {
      kpis: [['cases', 'HAI cases', items.reduce((t, i) => t + i.cases, 0), 'count']],
      items,
    };
  },
});

registerTile({
  key: 'quality-open',
  label: 'Open incidents · complaints',
  group: GROUPS.SUPPORT,
  module: 'QLT',
  permission: 'reports:quality:read',
  kind: 'text',
  report: 'nabh-indicators',
  run: async () => {
    const o = await overview();
    return {
      value: `${o.incidentsOpen} · ${o.complaintsOpen}`,
      note: o.complaintsOverdue ? `${o.complaintsOverdue} complaints past TAT` : null,
      tone: o.complaintsOverdue ? 'critical' : null,
    };
  },
});
