import { registerHome } from '../../core/home/registry.js';
import { DietOrder, DietTray } from './models/diet.models.js';

/** Kitchen widgets: patients to feed, special diets, nil by mouth, missed meals, diet mix. */
const REGULAR = ['NORMAL', 'REGULAR', 'GENERAL'];

registerHome({
  id: 'diet.patients',
  panels: ['kitchen'],
  permission: 'diet:order:read',
  module: 'DIET',
  kind: 'kpi',
  order: 10,
  build: async () => {
    const orders = await DietOrder.find({ status: 'ACTIVE' }).select('attendantMeals').lean();
    return {
      value: orders.length,
      format: 'count',
      params: { attendants: orders.filter((o) => o.attendantMeals).length },
      link: '/diet',
    };
  },
});

registerHome({
  id: 'diet.special',
  panels: ['kitchen'],
  permission: 'diet:order:read',
  module: 'DIET',
  kind: 'kpi',
  order: 20,
  build: async () => {
    const orders = await DietOrder.find({ status: 'ACTIVE' }).select('diet').lean();
    const special = orders.filter((o) => !REGULAR.includes(String(o.diet).toUpperCase()));
    return {
      value: special.length,
      format: 'count',
      params: { types: new Set(special.map((o) => o.diet)).size },
      link: '/diet?tab=orders',
    };
  },
});

registerHome({
  id: 'diet.nbm',
  panels: ['kitchen', 'nurse'],
  permission: 'diet:order:read',
  module: 'DIET',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => {
    const n = await DietOrder.countDocuments({
      status: 'ACTIVE',
      'nbm.from': { $lte: ctx.now },
      $or: [{ 'nbm.to': null }, { 'nbm.to': { $gte: ctx.now } }],
    });
    return { value: n, format: 'count', tone: n ? 'warning' : 'neutral', link: '/diet?tab=orders' };
  },
});

registerHome({
  id: 'diet.missed',
  panels: ['kitchen'],
  permission: 'diet:order:read',
  module: 'DIET',
  kind: 'kpi',
  order: 40,
  build: async (ctx) => {
    const n = await DietTray.countDocuments({ date: ctx.today, status: 'MISSED' });
    return { value: n, format: 'count', tone: n ? 'warning' : 'neutral', link: '/diet?tab=missed' };
  },
});

registerHome({
  id: 'diet.mix',
  panels: ['kitchen'],
  permission: 'diet:order:read',
  module: 'DIET',
  kind: 'list',
  order: 100,
  build: async () => {
    const rows = await DietOrder.aggregate([
      { $match: { status: 'ACTIVE' } },
      { $group: { _id: { diet: '$diet', texture: '$texture' }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 12 },
    ]);
    return {
      link: '/diet',
      columns: [
        { key: 'diet', kind: 'text' },
        { key: 'texture', kind: 'text' },
        { key: 'patients', kind: 'count' },
      ],
      rows: rows.map((r) => ({
        id: `${r._id.diet}|${r._id.texture}`,
        diet: r._id.diet,
        texture: r._id.texture ?? '',
        patients: r.n,
      })),
    };
  },
});
