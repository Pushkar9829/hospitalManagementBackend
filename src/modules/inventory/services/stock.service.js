import { User } from '../../../core/auth/models/user.model.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Item, StockBatch, StockMove, Store } from '../models/inventory.models.js';

/** Current month in IST, "2026-10": a batch expiring this month is still usable this month. */
export const monthIST = (d = new Date()) =>
  new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7);
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

async function move(batch, qty, kind, ref, by) {
  await StockMove.create([
    {
      at: new Date(),
      storeId: batch.storeId,
      itemId: batch.itemId,
      batchNo: batch.batchNo,
      qty,
      kind,
      ref,
      value: Math.round(qty * (batch.cost ?? 0)),
      balance: batch.qty,
      by,
    },
  ]);
}

/** Adds stock to a batch (creating it on first receipt) and writes the ledger. */
export async function addStock({
  storeId,
  itemId,
  batchNo,
  expiry,
  mrp,
  cost = 0,
  qty,
  kind,
  ref,
  by,
}) {
  if (!(qty > 0)) return null;
  const who = by ?? (await userName());
  let b = await StockBatch.findOne({ storeId, itemId, batchNo });
  if (!b) {
    try {
      [b] = await StockBatch.create([{ storeId, itemId, batchNo, expiry, mrp, cost, qty: 0 }]);
    } catch (e) {
      if (e?.code !== 11000) throw e;
      b = await StockBatch.findOne({ storeId, itemId, batchNo });
    }
  }
  b.qty += qty;
  if (mrp) b.mrp = mrp;
  if (cost) b.cost = cost;
  b.lastMoveAt = new Date();
  await b.save();
  await move(b, qty, kind, ref, who);
  return b;
}

/**
 * First-expiry-first-out allocation of `qty` from usable batches (expiry this month or later).
 * A named batch is used when given (the pharmacist's override). Throws when stock is short.
 */
export async function pick({ storeId, itemId, qty, batchNo }) {
  const filter = { storeId, itemId, qty: { $gt: 0 }, expiry: { $gte: monthIST() } };
  if (batchNo) filter.batchNo = batchNo;
  const batches = await StockBatch.find(filter).sort({ expiry: 1, createdAt: 1 }).lean();
  const out = [];
  let left = qty;
  for (const b of batches) {
    if (!left) break;
    const take = Math.min(left, b.qty);
    out.push({
      batchId: b._id,
      batchNo: b.batchNo,
      expiry: b.expiry,
      mrp: b.mrp,
      cost: b.cost,
      qty: take,
    });
    left -= take;
  }
  if (left > 0) {
    const item = await Item.findById(itemId).select('name').lean();
    throw new AppError(
      409,
      'INSUFFICIENT_STOCK',
      `${item?.name ?? 'Item'}: only ${qty - left} in stock${batchNo ? ` in batch ${batchNo}` : ''}.`,
      { itemId: String(itemId), available: qty - left },
    );
  }
  return out;
}

/** Deducts allocated batches; a batch changed meanwhile fails the whole transaction. */
export async function deduct(allocations, { kind, ref, by }) {
  const who = by ?? (await userName());
  for (const a of allocations) {
    const b = await StockBatch.findOneAndUpdate(
      { _id: a.batchId, qty: { $gte: a.qty } },
      { $inc: { qty: -a.qty }, $set: { lastMoveAt: new Date() } },
      { new: true },
    );
    if (!b)
      throw new AppError(409, 'STOCK_CHANGED', `Batch ${a.batchNo} changed meanwhile. Try again.`);
    await move(b, -a.qty, kind, ref, who);
  }
}

// ---------------------------------------------------------------- views

/** Stock per item in a store (or all): usable quantity, nearest expiry, value, reorder flag. */
export async function stockLevels({ storeId, q, kind, low, page = 1, limit = 100 } = {}) {
  const itemFilter = { isActive: true };
  if (kind) itemFilter.kind = kind;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    itemFilter.$or = [{ name: rx }, { code: rx }, { 'drug.generic': rx }];
  }
  const items = await Item.find(itemFilter).sort({ name: 1 }).lean();
  const match = { itemId: { $in: items.map((i) => i._id) }, qty: { $gt: 0 } };
  if (storeId) match.storeId = storeId;
  const month = monthIST();
  const batches = await StockBatch.find(match).lean();
  const rows = items.map((it) => {
    const mine = batches.filter((b) => String(b.itemId) === String(it._id));
    const usable = mine.filter((b) => b.expiry >= month);
    const qty = usable.reduce((s, b) => s + b.qty, 0);
    return {
      itemId: String(it._id),
      code: it.code,
      name: it.name,
      kind: it.kind,
      unit: it.unit,
      generic: it.drug?.generic ?? null,
      schedule: it.kind === 'DRUG' ? (it.drug?.schedule ?? 'H') : null,
      qty,
      expiredQty: mine.filter((b) => b.expiry < month).reduce((s, b) => s + b.qty, 0),
      batches: usable.length,
      nearestExpiry: usable.map((b) => b.expiry).sort()[0] ?? null,
      value: usable.reduce((s, b) => s + b.qty * (b.cost ?? 0), 0),
      mrp: usable.sort((a, b) => a.expiry.localeCompare(b.expiry))[0]?.mrp ?? null,
      reorderLevel: it.reorderLevel ?? 0,
      low: qty <= (it.reorderLevel ?? 0),
    };
  });
  const filtered = low ? rows.filter((r) => r.low) : rows;
  const start = (page - 1) * limit;
  return {
    items: filtered.slice(start, start + limit),
    total: filtered.length,
    page,
    limit,
    value: filtered.reduce((s, r) => s + r.value, 0),
  };
}

export async function itemBatches({ itemId, storeId }) {
  const filter = { itemId, qty: { $gt: 0 } };
  if (storeId) filter.storeId = storeId;
  const [rows, stores] = await Promise.all([
    StockBatch.find(filter).sort({ expiry: 1 }).lean(),
    Store.find({}).select('code name').lean(),
  ]);
  const name = new Map(stores.map((s) => [String(s._id), s.name]));
  const month = monthIST();
  return {
    items: rows.map((b) => ({
      id: String(b._id),
      storeId: String(b.storeId),
      store: name.get(String(b.storeId)) ?? null,
      batchNo: b.batchNo,
      expiry: b.expiry,
      expired: b.expiry < month,
      mrp: b.mrp,
      cost: b.cost,
      qty: b.qty,
    })),
  };
}

export async function ledger({ itemId, storeId, limit = 100 }) {
  const filter = {};
  if (itemId) filter.itemId = itemId;
  if (storeId) filter.storeId = storeId;
  const rows = await StockMove.find(filter).sort({ at: -1 }).limit(limit).lean();
  const items = new Map(
    (
      await Item.find({ _id: { $in: [...new Set(rows.map((r) => String(r.itemId)))] } })
        .select('name')
        .lean()
    ).map((i) => [String(i._id), i.name]),
  );
  return {
    items: rows.map((r) => ({
      id: String(r._id),
      at: r.at,
      storeId: String(r.storeId),
      itemId: String(r.itemId),
      item: items.get(String(r.itemId)) ?? null,
      batchNo: r.batchNo,
      qty: r.qty,
      kind: r.kind,
      ref: r.ref ?? null,
      balance: r.balance,
      by: r.by,
    })),
  };
}

/** Batches expiring within `days` (or already expired), soonest first. */
export async function expiryReport({ days = 90, storeId } = {}) {
  const until = addMonths(monthIST(), Math.ceil(days / 30));
  const filter = { qty: { $gt: 0 }, expiry: { $lte: until } };
  if (storeId) filter.storeId = storeId;
  const rows = await StockBatch.find(filter).sort({ expiry: 1 }).lean();
  const [items, stores] = await Promise.all([
    Item.find({ _id: { $in: rows.map((r) => r.itemId) } })
      .select('name code')
      .lean(),
    Store.find({}).select('name').lean(),
  ]);
  const iname = new Map(items.map((i) => [String(i._id), i.name]));
  const sname = new Map(stores.map((s) => [String(s._id), s.name]));
  const month = monthIST();
  return {
    days,
    items: rows.map((b) => ({
      itemId: String(b.itemId),
      item: iname.get(String(b.itemId)),
      store: sname.get(String(b.storeId)),
      batchNo: b.batchNo,
      expiry: b.expiry,
      expired: b.expiry < month,
      qty: b.qty,
      value: b.qty * (b.cost ?? 0),
    })),
    value: rows.reduce((s, b) => s + b.qty * (b.cost ?? 0), 0),
  };
}

/** Items with stock and no movement out for `days` (dead and slow stock). */
export async function deadStock({ days = 90 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000);
  const moved = new Set(
    (await StockMove.distinct('itemId', { at: { $gte: since }, qty: { $lt: 0 } })).map(String),
  );
  const rows = await StockBatch.aggregate([
    { $match: { qty: { $gt: 0 } } },
    {
      $group: {
        _id: '$itemId',
        qty: { $sum: '$qty' },
        value: { $sum: { $multiply: ['$qty', '$cost'] } },
      },
    },
  ]);
  const dead = rows.filter((r) => !moved.has(String(r._id)));
  const items = new Map(
    (
      await Item.find({ _id: { $in: dead.map((d) => d._id) } })
        .select('name code')
        .lean()
    ).map((i) => [String(i._id), i]),
  );
  return {
    days,
    items: dead
      .map((d) => ({
        itemId: String(d._id),
        item: items.get(String(d._id))?.name,
        code: items.get(String(d._id))?.code,
        qty: d.qty,
        value: d.value,
      }))
      .sort((a, b) => b.value - a.value),
  };
}

/** Moves stock between stores batch by batch (FEFO from the source). */
export async function transfer({ fromStoreId, toStoreId, lines, ref, by }) {
  if (String(fromStoreId) === String(toStoreId))
    throw errors.validation([{ path: 'toStoreId', message: 'Pick a different store' }]);
  const who = by ?? (await userName());
  const moved = [];
  for (const l of lines) {
    const alloc = await pick({ storeId: fromStoreId, itemId: l.itemId, qty: l.qty });
    await deduct(alloc, { kind: 'TRANSFER_OUT', ref, by: who });
    for (const a of alloc) {
      await addStock({
        storeId: toStoreId,
        itemId: l.itemId,
        batchNo: a.batchNo,
        expiry: a.expiry,
        mrp: a.mrp,
        cost: a.cost,
        qty: a.qty,
        kind: 'TRANSFER_IN',
        ref,
        by: who,
      });
      moved.push({ itemId: String(l.itemId), batchNo: a.batchNo, qty: a.qty });
    }
  }
  return moved;
}
