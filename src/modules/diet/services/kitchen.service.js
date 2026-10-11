import { z } from 'zod';
import { withTransaction } from '../../../core/db/model.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { Item, StockBatch, Store, deduct, pick, userName } from '../../inventory/index.js';
import { Service } from '../../setup/index.js';
import { DietTray, KitchenConsumption } from '../models/diet.models.js';
import { settingsDoc } from './diet.service.js';

/**
 * Kitchen stock costing. Food stock lives in an inventory store of kind KITCHEN (filled by the
 * usual transfer from the main store). The kitchen records what it used each day; costing is
 * ingredients consumed at cost against trays served, and what the hospital recovered by
 * charging meals to bills.
 */

async function kitchenStore(storeId) {
  const s = storeId
    ? await Store.findOne({ _id: storeId, kind: 'KITCHEN', isActive: true }).lean()
    : await Store.findOne({ kind: 'KITCHEN', isActive: true }).sort({ createdAt: 1 }).lean();
  if (!s)
    throw new AppError(
      409,
      'NO_KITCHEN_STORE',
      'Set up a kitchen store in inventory (store kind Kitchen) first.',
    );
  return s;
}

/** What the kitchen store holds: per item, usable quantity and value at cost. */
export async function kitchenStock({ storeId } = {}) {
  const store = await kitchenStore(storeId);
  const batches = await StockBatch.find({ storeId: store._id, qty: { $gt: 0 } }).lean();
  const items = new Map(
    (
      await Item.find({ _id: { $in: [...new Set(batches.map((b) => String(b.itemId)))] } })
        .select('code name unit reorderLevel')
        .lean()
    ).map((i) => [String(i._id), i]),
  );
  const by = new Map();
  for (const b of batches) {
    const k = String(b.itemId);
    const row = by.get(k) ?? { itemId: k, qty: 0, value: 0, nearestExpiry: b.expiry };
    row.qty += b.qty;
    row.value += b.qty * (b.cost ?? 0);
    if (b.expiry < row.nearestExpiry) row.nearestExpiry = b.expiry;
    by.set(k, row);
  }
  const rows = [...by.values()].map((r) => {
    const i = items.get(r.itemId);
    return {
      ...r,
      code: i?.code,
      name: i?.name ?? '',
      unit: i?.unit ?? 'unit',
      low: (i?.reorderLevel ?? 0) > 0 && r.qty <= i.reorderLevel,
    };
  });
  return {
    store: { id: String(store._id), name: store.name },
    items: rows.sort((a, b) => a.name.localeCompare(b.name)),
    value: rows.reduce((t, r) => t + r.value, 0),
  };
}

export const consumptionInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.string().trim().max(20).optional(),
  storeId: z.string().optional(),
  note: z.string().trim().max(200).optional(),
  lines: z
    .array(z.object({ itemId: z.string(), qty: z.number().positive().max(100_000) }))
    .min(1)
    .max(100),
});

const consumptionOut = (c) => ({
  id: String(c._id),
  ref: c.ref,
  date: c.date,
  meal: c.meal ?? null,
  lines: (c.lines ?? []).map((l) => ({ ...l, itemId: String(l.itemId) })),
  total: c.total,
  note: c.note ?? null,
  by: c.by ?? null,
});

/** Records what the kitchen used: issued from the kitchen store oldest-expiry first, at cost. */
export async function recordConsumption(input) {
  const store = await kitchenStore(input.storeId);
  return withTransaction(async () => {
    const ref = await documentNumber('KC');
    const by = await userName();
    const lines = [];
    for (const l of input.lines) {
      const item = await Item.findById(l.itemId).select('name unit').lean();
      if (!item)
        throw errors.validation([{ path: 'lines', message: 'Pick items from the master' }]);
      const picks = await pick({ storeId: store._id, itemId: l.itemId, qty: l.qty });
      await deduct(picks, { kind: 'ISSUE', ref, by });
      lines.push({
        itemId: l.itemId,
        name: item.name,
        unit: item.unit,
        qty: l.qty,
        value: picks.reduce((t, p) => t + p.qty * (p.cost ?? 0), 0),
      });
    }
    const [c] = await KitchenConsumption.create([
      {
        ref,
        date: input.date,
        meal: input.meal,
        storeId: store._id,
        lines,
        total: lines.reduce((t, l) => t + l.value, 0),
        note: input.note,
        by,
      },
    ]);
    return consumptionOut(c.toObject());
  });
}

export async function listConsumption({ from, to }) {
  const rows = await KitchenConsumption.find({ date: { $gte: from, $lte: to } })
    .sort({ date: -1, createdAt: -1 })
    .limit(300)
    .lean();
  return { items: rows.map(consumptionOut) };
}

/**
 * Cost per meal for a period: ingredients consumed at cost against trays delivered, by day and
 * by meal, the items that cost most, and what was recovered from meals charged to bills.
 */
export async function costing({ from, to }) {
  const [used, trays, s] = await Promise.all([
    KitchenConsumption.find({ date: { $gte: from, $lte: to } }).lean(),
    DietTray.find({ date: { $gte: from, $lte: to }, status: 'DELIVERED' })
      .select('date meal charged')
      .lean(),
    settingsDoc(),
  ]);
  const mealService = await Service.findOne({ code: s.mealServiceCode }).lean();
  const mealRate = mealService?.rates?.[0]?.amount ?? 0;
  const cost = used.reduce((t, c) => t + c.total, 0);
  const charged = trays.filter((t) => t.charged).length;
  const perTray = trays.length ? Math.round(cost / trays.length) : null;

  const days = new Map();
  for (const c of used) {
    const d = days.get(c.date) ?? { date: c.date, cost: 0, trays: 0 };
    d.cost += c.total;
    days.set(c.date, d);
  }
  for (const tr of trays) {
    const d = days.get(tr.date) ?? { date: tr.date, cost: 0, trays: 0 };
    d.trays += 1;
    days.set(tr.date, d);
  }
  // Consumption recorded against a meal is costed to it; the rest is spread by trays.
  const meals = new Map();
  for (const m of s.meals) meals.set(m.code, { meal: m.code, name: m.name, cost: 0, trays: 0 });
  for (const tr of trays) if (meals.has(tr.meal)) meals.get(tr.meal).trays += 1;
  let unallocated = 0;
  for (const c of used) {
    if (c.meal && meals.has(c.meal)) meals.get(c.meal).cost += c.total;
    else unallocated += c.total;
  }
  for (const m of meals.values())
    m.cost += trays.length ? Math.round((unallocated * m.trays) / trays.length) : 0;

  const items = new Map();
  for (const c of used)
    for (const l of c.lines) {
      const k = String(l.itemId);
      const r = items.get(k) ?? { itemId: k, name: l.name, unit: l.unit, qty: 0, value: 0 };
      r.qty += l.qty;
      r.value += l.value;
      items.set(k, r);
    }
  return {
    from,
    to,
    cost,
    trays: trays.length,
    perTray,
    charged,
    recovered: charged * mealRate,
    days: [...days.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, perTray: d.trays ? Math.round(d.cost / d.trays) : null })),
    meals: [...meals.values()].map((m) => ({
      ...m,
      perTray: m.trays ? Math.round(m.cost / m.trays) : null,
    })),
    topItems: [...items.values()].sort((a, b) => b.value - a.value).slice(0, 10),
  };
}
