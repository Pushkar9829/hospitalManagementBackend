import { GROUPS, istDate, period, registerReport } from '../../core/reports/registry.js';
import { Dispense } from './models/pharmacy.models.js';

/** Pharmacy reports: sales and the controlled-drug register. */

registerReport({
  code: 'pharmacy-daily-sales',
  name: 'Daily sales',
  group: GROUPS.STOCK,
  module: 'PHR',
  permission: 'reports:pharmacy:read',
  description: 'Counter sales and ward issues by day, at MRP.',
  columns: [
    ['date', 'Date', 'date'],
    ['sales', 'Counter sales', 'count'],
    ['salesValue', 'Counter value', 'money'],
    ['issues', 'Ward issues', 'count'],
    ['issueValue', 'Ward value', 'money'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await Dispense.find({ at: { $gte: p.from, $lte: p.to } })
      .select('at kind lines')
      .lean();
    const by = new Map();
    for (const d of rows) {
      const day = istDate(d.at);
      const r = by.get(day) ?? { date: day, sales: 0, salesValue: 0, issues: 0, issueValue: 0 };
      const value = d.lines.reduce((t, l) => t + (l.qty - (l.returnedQty ?? 0)) * (l.mrp ?? 0), 0);
      if (d.kind === 'SALE') {
        r.sales += 1;
        r.salesValue += value;
      } else {
        r.issues += 1;
        r.issueValue += value;
      }
      by.set(day, r);
    }
    const items = [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
    return {
      kpis: [
        [
          'value',
          'Total at MRP',
          items.reduce((t, r) => t + r.salesValue + r.issueValue, 0),
          'money',
        ],
        ['bills', 'Dispenses', rows.length, 'count'],
      ],
      items,
    };
  },
});

registerReport({
  code: 'schedule-h1-register',
  name: 'Schedule H1 register',
  group: GROUPS.STOCK,
  module: 'PHR',
  permission: 'reports:pharmacy:read',
  description:
    'Schedule H1, X and narcotic medicines with patient, prescriber and batch (Drugs Rules).',
  filters: [{ key: 'schedule', label: 'Schedule', options: ['H1', 'X', 'NARCOTIC'] }],
  columns: [
    ['at', 'Date', 'datetime'],
    ['dispNo', 'Bill', 'id'],
    ['patient', 'Patient', 'text'],
    ['prescriber', 'Prescriber', 'text'],
    ['regNo', 'Reg. no.', 'id'],
    ['item', 'Medicine', 'text'],
    ['batchNo', 'Batch', 'id'],
    ['qty', 'Qty', 'count'],
  ],
  run: async ({ from, to, filters }) => {
    const p = period({ from, to });
    const schedule = filters.schedule ?? 'H1';
    const rows = await Dispense.find({
      at: { $gte: p.from, $lte: p.to },
      'lines.schedule': schedule,
    })
      .sort({ at: 1 })
      .lean();
    const items = [];
    for (const d of rows)
      for (const l of d.lines.filter((x) => x.schedule === schedule))
        items.push({
          at: d.at,
          dispNo: d.dispNo,
          patient: d.patient?.name ?? '',
          prescriber: d.prescriber?.name ?? '',
          regNo: d.prescriber?.regNo ?? '',
          item: l.name,
          batchNo: l.batchNo,
          qty: l.qty,
        });
    return { kpis: [['entries', 'Entries', items.length, 'count']], items };
  },
});
