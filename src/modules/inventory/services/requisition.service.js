import { z } from 'zod';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { Item, PurchaseRequisition, StockMove, Store } from '../models/inventory.models.js';
import { createPo, reorderSuggestions } from './inventory.service.js';
import { userName } from './stock.service.js';

/** Purchase requisitions and the store transfer register (board Inventory). */
const text = (n) => z.string().trim().max(n);

export const requisitionInput = z.object({
  storeId: z.string(),
  reason: text(300).min(3, 'Say why the items are needed'),
  lines: z
    .array(z.object({ itemId: z.string(), qty: z.number().int().min(1).max(1_000_000) }))
    .min(1)
    .max(100),
});

const out = (r) => ({
  id: String(r._id),
  prNo: r.prNo,
  storeId: String(r.storeId),
  source: r.source,
  reason: r.reason,
  lines: (r.lines ?? []).map((l) => ({ ...l, itemId: String(l.itemId) })),
  estimate: r.estimate ?? 0,
  status: r.status,
  raisedBy: r.raisedBy,
  createdAt: r.createdAt,
  poId: r.poId ? String(r.poId) : null,
  decidedBy: r.decidedBy,
  rejectReason: r.rejectReason,
  version: r.version ?? 0,
});

export async function listRequisitions({ status } = {}) {
  const rows = await PurchaseRequisition.find(status ? { status } : {})
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return { items: rows.map(out) };
}

export async function createRequisition({ storeId, reason, lines }, source = 'MANUAL') {
  if (!(await Store.exists({ _id: storeId })))
    throw errors.validation([{ path: 'storeId', message: 'Pick the store' }]);
  const items = await Item.find({ _id: { $in: lines.map((l) => l.itemId) } })
    .select('name')
    .lean();
  if (items.length !== new Set(lines.map((l) => String(l.itemId))).size)
    throw errors.validation([{ path: 'lines', message: 'Pick items from the item master' }]);
  const name = new Map(items.map((i) => [String(i._id), i.name]));
  const priced = lines.map((l) => ({ ...l, name: name.get(String(l.itemId)), rate: l.rate ?? 0 }));
  const [r] = await PurchaseRequisition.create([
    {
      prNo: await documentNumber('PR'),
      storeId,
      source,
      reason,
      lines: priced,
      estimate: priced.reduce((t, l) => t + l.qty * (l.rate ?? 0), 0),
      raisedBy: await userName(),
    },
  ]);
  return out(r);
}

/** One requisition for everything at or below its reorder level in a store. */
export async function fromReorder({ storeId }) {
  const { items } = await reorderSuggestions({ storeId });
  if (!items.length)
    throw new AppError(409, 'NOTHING_TO_ORDER', 'No item in this store is at its reorder level');
  return createRequisition(
    {
      storeId,
      reason: 'Below reorder level',
      lines: items.map((i) => ({ itemId: i.itemId, qty: i.suggest, rate: i.lastRate ?? 0 })),
    },
    'REORDER',
  );
}

async function openOne(id, version) {
  const r = await PurchaseRequisition.findById(id);
  if (!r) throw errors.notFound('Requisition');
  if (r.version !== version) throw errors.versionConflict();
  if (r.status !== 'OPEN') throw new AppError(409, 'INVALID_STATE', 'This requisition is closed');
  return r;
}

/** Turns the requisition into a purchase order for a vendor (the PO has its own approval). */
export async function convertToPo(id, { version, vendorId, rates = {} }, res) {
  const r = await openOne(id, version);
  const po = await createPo(
    {
      vendorId,
      storeId: String(r.storeId),
      lines: r.lines.map((l) => ({
        itemId: String(l.itemId),
        qty: l.qty,
        rate: rates[String(l.itemId)] ?? l.rate ?? 0,
      })),
      notes: `From requisition ${r.prNo}`,
    },
    res,
  );
  r.set({ status: 'PO_CREATED', poId: po.id, decidedBy: await userName(), decidedAt: new Date() });
  await r.save();
  return { requisition: out(r.toObject()), po };
}

export async function rejectRequisition(id, { version, reason }) {
  const r = await openOne(id, version);
  r.set({
    status: 'REJECTED',
    rejectReason: reason,
    decidedBy: await userName(),
    decidedAt: new Date(),
  });
  await r.save();
  return out(r.toObject());
}

/** Store-to-store moves (direct transfers and indent issues), newest first. */
export async function listTransfers({ limit = 100 } = {}) {
  const moves = await StockMove.find({ kind: { $in: ['TRANSFER_OUT', 'TRANSFER_IN'] } })
    .select('at storeId itemId qty kind ref by value')
    .sort({ at: -1 })
    .limit(5000)
    .lean();
  const by = new Map();
  for (const m of moves) {
    const key = m.ref ?? String(m._id);
    const t = by.get(key) ?? { ref: key, at: m.at, by: m.by, items: new Set(), qty: 0, value: 0 };
    if (m.kind === 'TRANSFER_OUT') {
      t.fromStoreId = String(m.storeId);
      t.qty += -m.qty;
      t.value += Math.abs(m.value ?? 0);
      t.items.add(String(m.itemId));
    } else t.toStoreId = String(m.storeId);
    if (m.at > t.at) t.at = m.at;
    by.set(key, t);
  }
  const rows = [...by.values()].sort((a, b) => b.at - a.at).slice(0, limit);
  const stores = new Map(
    (
      await Store.find({
        _id: { $in: rows.flatMap((r) => [r.fromStoreId, r.toStoreId]).filter(Boolean) },
      })
        .select('name')
        .lean()
    ).map((s) => [String(s._id), s.name]),
  );
  return {
    items: rows.map((r) => ({
      ref: r.ref,
      at: r.at,
      by: r.by,
      from: stores.get(r.fromStoreId) ?? '',
      to: stores.get(r.toStoreId) ?? '',
      lines: r.items.size,
      qty: r.qty,
      value: r.value,
      kind: r.ref?.startsWith('TRF') ? 'TRANSFER' : 'INDENT',
    })),
  };
}
