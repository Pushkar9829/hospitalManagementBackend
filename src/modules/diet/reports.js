import { GROUPS, registerReport } from '../../core/reports/registry.js';
import { DietTray } from './models/diet.models.js';

/** Diet report: trays by meal and diet type. */

registerReport({
  code: 'meal-counts',
  name: 'Meal counts',
  group: GROUPS.SUPPORT,
  module: 'DIET',
  permission: 'reports:diet:read',
  description: 'Trays by day, meal and diet: delivered, held for nil by mouth, missed and charged.',
  columns: [
    ['date', 'Date', 'date'],
    ['meal', 'Meal', 'text'],
    ['diet', 'Diet', 'text'],
    ['delivered', 'Delivered', 'count'],
    ['held', 'Held (NBM)', 'count'],
    ['missed', 'Missed', 'count'],
    ['charged', 'Charged', 'count'],
  ],
  run: async ({ from, to }) => {
    const rows = await DietTray.find({ date: { $gte: from, $lte: to } }).lean();
    const by = new Map();
    for (const t of rows) {
      const k = `${t.date}|${t.meal}|${t.diet}`;
      const r = by.get(k) ?? {
        date: t.date,
        meal: t.meal,
        diet: t.diet,
        delivered: 0,
        held: 0,
        missed: 0,
        charged: 0,
      };
      if (t.status === 'DELIVERED') r.delivered += 1;
      if (t.status === 'NBM') r.held += 1;
      if (t.status === 'MISSED') r.missed += 1;
      if (t.charged) r.charged += 1;
      by.set(k, r);
    }
    return {
      kpis: [
        [
          'delivered',
          'Trays delivered',
          rows.filter((t) => t.status === 'DELIVERED').length,
          'count',
        ],
        ['missed', 'Missed', rows.filter((t) => t.status === 'MISSED').length, 'count'],
      ],
      items: [...by.values()].sort((a, b) =>
        `${a.date}${a.meal}`.localeCompare(`${b.date}${b.meal}`),
      ),
    };
  },
});
