import { z } from 'zod';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { numbering } from '../../setup/index.js';
import {
  Grn,
  Indent,
  InventorySettings,
  Item,
  PurchaseOrder,
  StockAdjustment,
  StockBatch,
  Store,
  Vendor,
} from '../models/inventory.models.js';
import { addStock, deduct, monthIST, pick, transfer, userName } from './stock.service.js';

const text = (max = 200) => z.string().trim().max(max);
const paise = z.number().int().min(0).max(1_00_00_000_00);
const ym = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function settingsDoc() {
  const found = await InventorySettings.findOne();
  if (found) return found;
  try {
    return (await InventorySettings.create([{}]))[0];
  } catch (e) {
    if (e?.code === 11000) return InventorySettings.findOne();
    throw e;
  }
}

// ---------------------------------------------------------------- masters

export const itemInput = z.object({
  code: text(30).min(2),
  name: text(120).min(2),
  kind: z.enum(['DRUG', 'CONSUMABLE', 'REAGENT', 'GENERAL', 'FOOD']).default('DRUG'),
  unit: text(20).default('unit'),
  packSize: z.number().int().min(1).max(10000).default(1),
  hsn: text(10).optional(),
  gstRate: z
    .union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)])
    .default(5),
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
  rack: text(20).optional(),
  drug: z
    .object({
      generic: text(120).optional(),
      form: text(30).optional(),
      strengthMg: z.number().positive().max(100000).optional(),
      schedule: z.enum(['OTC', 'H', 'H1', 'X', 'NARCOTIC']).default('H'),
      lifeSaving: z.boolean().default(false),
      maxMgPerKgDay: z.number().positive().max(1000).optional(),
    })
    .optional(),
  isActive: z.boolean().default(true),
});

export const itemOut = (i) => ({
  id: String(i._id),
  code: i.code,
  name: i.name,
  kind: i.kind,
  unit: i.unit,
  packSize: i.packSize,
  hsn: i.hsn ?? null,
  gstRate: i.gstRate,
  reorderLevel: i.reorderLevel,
  rack: i.rack ?? null,
  drug: i.kind === 'DRUG' && i.drug ? { ...i.drug } : null,
  isActive: i.isActive !== false,
});

export async function listItems({ q, kind } = {}) {
  const filter = {};
  if (kind) filter.kind = kind;
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ name: rx }, { code: rx }, { 'drug.generic': rx }];
  }
  const rows = await Item.find(filter).sort({ name: 1 }).limit(500).lean();
  return { items: rows.map(itemOut), total: rows.length, page: 1, limit: 500 };
}

export async function createItem(input) {
  // Life-saving medicines carry 0% GST (from 22 September 2025).
  const gstRate = input.kind === 'DRUG' && input.drug?.lifeSaving ? 0 : input.gstRate;
  try {
    const [i] = await Item.create([{ ...input, gstRate }]);
    return itemOut(i.toObject());
  } catch (e) {
    if (e?.code === 11000)
      throw errors.conflict('ITEM_CODE_TAKEN', 'An item with this code exists');
    throw e;
  }
}

export async function updateItem(id, input) {
  const i = await Item.findById(id);
  if (!i) throw errors.notFound('Item');
  const { code: _code, ...rest } = input;
  i.set(rest);
  if (i.kind === 'DRUG' && i.drug?.lifeSaving) i.gstRate = 0;
  await i.save();
  return itemOut(i.toObject());
}

const storeOut = (s) => ({
  id: String(s._id),
  code: s.code,
  name: s.name,
  kind: s.kind,
  isActive: s.isActive !== false,
});
export async function listStores() {
  const rows = await Store.find({ isActive: true }).sort({ kind: 1, name: 1 }).lean();
  return { items: rows.map(storeOut) };
}
export const storeInput = z.object({
  code: text(10).min(2),
  name: text(60).min(2),
  kind: z.enum(['MAIN', 'PHARMACY', 'WARD', 'OT', 'LAB', 'KITCHEN']),
});
export async function createStore(input) {
  try {
    return storeOut((await Store.create([input]))[0].toObject());
  } catch (e) {
    if (e?.code === 11000)
      throw errors.conflict('STORE_CODE_TAKEN', 'A store with this code exists');
    throw e;
  }
}

const vendorOut = (v) => ({
  id: String(v._id),
  code: v.code,
  name: v.name,
  gstin: v.gstin ?? null,
  phone: v.phone ?? null,
  drugLicence: v.drugLicence ?? null,
});
export async function listVendors() {
  const rows = await Vendor.find({ isActive: true }).sort({ name: 1 }).lean();
  return { items: rows.map(vendorOut) };
}
export const vendorInput = z.object({
  code: text(10).min(2),
  name: text(120).min(2),
  gstin: z
    .string()
    .trim()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN')
    .optional(),
  phone: text(15).optional(),
  drugLicence: text(40).optional(),
});
export async function createVendor(input) {
  try {
    return vendorOut((await Vendor.create([input]))[0].toObject());
  } catch (e) {
    if (e?.code === 11000)
      throw errors.conflict('VENDOR_CODE_TAKEN', 'A vendor with this code exists');
    throw e;
  }
}

// ---------------------------------------------------------------- purchase orders

const poOut = (p) => ({
  id: String(p._id),
  poNo: p.poNo ?? null,
  vendorId: String(p.vendorId),
  vendorName: p.vendorName,
  storeId: String(p.storeId),
  status: p.status,
  lines: p.lines.map((l) => ({
    itemId: String(l.itemId),
    name: l.name,
    qty: l.qty,
    rate: l.rate,
    received: l.received,
  })),
  total: p.total,
  notes: p.notes ?? null,
  approvalId: p.approvalId ? String(p.approvalId) : null,
  createdAt: p.createdAt,
});

export const poInput = z.object({
  vendorId: z.string(),
  storeId: z.string(),
  lines: z
    .array(
      z.object({ itemId: z.string(), qty: z.number().int().min(1).max(1_000_000), rate: paise }),
    )
    .min(1)
    .max(100),
  notes: text(300).optional(),
});

export async function listPos({ status } = {}) {
  const rows = await PurchaseOrder.find(status ? { status: { $in: status.split(',') } } : {})
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return { items: rows.map(poOut), total: rows.length, page: 1, limit: 200 };
}

/** A PO goes for approval (rule inventory.purchaseOrder); without a rule it is approved at once. */
export async function createPo(input, res) {
  const vendor = await Vendor.findById(input.vendorId).lean();
  if (!vendor) throw errors.validation([{ path: 'vendorId', message: 'Pick the vendor' }]);
  if (!(await Store.exists({ _id: input.storeId })))
    throw errors.validation([{ path: 'storeId', message: 'Pick the store' }]);
  const items = await Item.find({ _id: { $in: input.lines.map((l) => l.itemId) } })
    .select('name')
    .lean();
  if (items.length !== new Set(input.lines.map((l) => l.itemId)).size)
    throw errors.validation([{ path: 'lines', message: 'Pick items from the item master' }]);
  const name = new Map(items.map((i) => [String(i._id), i.name]));
  const total = input.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const [po] = await PurchaseOrder.create([
    {
      ...input,
      vendorName: vendor.name,
      lines: input.lines.map((l) => ({ ...l, name: name.get(l.itemId) })),
      total,
      status: 'PENDING_APPROVAL',
    },
  ]);
  const approval = await requestApproval({
    action: 'inventory.purchaseOrder',
    module: 'INV',
    entity: 'PurchaseOrder',
    entityId: po._id,
    title: `Purchase order · ${vendor.name} · ${input.lines.length} items`,
    before: {},
    after: { total },
    payload: { poId: String(po._id) },
    metrics: { amount: total },
    reason: input.notes || 'Purchase order',
  });
  if (approval) {
    po.approvalId = approval._id;
    await po.save();
    if (res) res.locals.status = 202;
    return { ...poOut(po.toObject()), approvalId: String(approval._id) };
  }
  await approvePo(po);
  return poOut(po.toObject());
}

async function approvePo(po) {
  po.poNo = await numbering.next('PO');
  po.status = 'APPROVED';
  po.approvedAt = new Date();
  await po.save();
  await publish('inventory.po.approved', { poId: String(po._id), poNo: po.poNo, total: po.total });
}

onApprovalDecided('inventory.purchaseOrder', async (req, outcome) => {
  const po = await PurchaseOrder.findById(req.payload.poId);
  if (!po || po.status !== 'PENDING_APPROVAL') return;
  if (outcome === 'APPROVED') await approvePo(po);
  else {
    po.status = 'CANCELLED';
    await po.save();
  }
});

export async function cancelPo(id) {
  const po = await PurchaseOrder.findById(id);
  if (!po) throw errors.notFound('Purchase order');
  if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(po.status))
    throw new AppError(409, 'INVALID_STATE', 'Goods are already received against this order.');
  po.status = 'CANCELLED';
  await po.save();
  return poOut(po.toObject());
}

// ---------------------------------------------------------------- goods receipt

const grnOut = (g) => ({
  id: String(g._id),
  grnNo: g.grnNo ?? null,
  poId: g.poId ? String(g.poId) : null,
  poNo: g.poNo ?? null,
  vendorName: g.vendorName,
  storeId: String(g.storeId),
  invoiceNo: g.invoiceNo ?? null,
  invoiceDate: g.invoiceDate ?? null,
  status: g.status,
  lines: g.lines.map((l) => ({ ...l, itemId: String(l.itemId) })),
  total: g.total,
  tax: g.tax,
  postedAt: g.postedAt ?? null,
  approvalId: g.approvalId ? String(g.approvalId) : null,
  createdAt: g.createdAt,
});

export const grnInput = z.object({
  poId: z.string().optional(),
  vendorId: z.string().optional(),
  storeId: z.string().optional(),
  invoiceNo: text(40).min(1),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string(),
        batchNo: text(30).min(1),
        expiry: ym,
        qty: z.number().int().min(1).max(1_000_000),
        freeQty: z.number().int().min(0).max(1_000_000).default(0),
        rate: paise,
        mrp: paise,
      }),
    )
    .min(1)
    .max(100),
});

export async function listGrns() {
  const rows = await Grn.find({}).sort({ createdAt: -1 }).limit(200).lean();
  return { items: rows.map(grnOut), total: rows.length, page: 1, limit: 200 };
}

async function postGrn(g) {
  const by = await userName();
  g.grnNo = await numbering.next('GRN');
  for (const l of g.lines)
    await addStock({
      storeId: g.storeId,
      itemId: l.itemId,
      batchNo: l.batchNo,
      expiry: l.expiry,
      mrp: l.mrp,
      // Free goods lower the cost per unit.
      cost: Math.round((l.rate * l.qty) / (l.qty + (l.freeQty ?? 0))),
      qty: l.qty + (l.freeQty ?? 0),
      kind: 'GRN',
      ref: g.grnNo,
      by,
    });
  if (g.poId) {
    const po = await PurchaseOrder.findById(g.poId);
    if (po) {
      for (const pl of po.lines) {
        const got = g.lines
          .filter((l) => String(l.itemId) === String(pl.itemId))
          .reduce((s, l) => s + l.qty, 0);
        pl.received += got;
      }
      po.status = po.lines.every((l) => l.received >= l.qty) ? 'RECEIVED' : 'PARTIAL';
      await po.save();
    }
  }
  g.status = 'POSTED';
  g.postedAt = new Date();
  g.postedBy = by;
  await g.save();
  // Finance (Phase 5) posts the payable from this event.
  await publish('inventory.grn.posted', {
    grnId: String(g._id),
    grnNo: g.grnNo,
    vendorId: String(g.vendorId),
    total: g.total,
    tax: g.tax,
  });
}

/**
 * Goods receipt: batches with expiry and MRP. Expired or already-expiring stock is refused; MRP
 * below the rate is refused; a rate above the PO rate by more than the set share waits for the
 * inventory.grnVariance approval before any stock is added.
 */
export async function createGrn(input, res) {
  let po = null;
  if (input.poId) {
    po = await PurchaseOrder.findById(input.poId).lean();
    if (!po) throw errors.notFound('Purchase order');
    if (!['APPROVED', 'PARTIAL'].includes(po.status))
      throw new AppError(409, 'PO_NOT_OPEN', 'Receive against an approved, open purchase order.');
  }
  const vendorId = po?.vendorId ?? input.vendorId;
  const storeId = po?.storeId ?? input.storeId;
  const vendor = vendorId ? await Vendor.findById(vendorId).lean() : null;
  if (!vendor) throw errors.validation([{ path: 'vendorId', message: 'Pick the vendor' }]);
  if (!storeId || !(await Store.exists({ _id: storeId })))
    throw errors.validation([{ path: 'storeId', message: 'Pick the store' }]);
  const items = await Item.find({ _id: { $in: input.lines.map((l) => l.itemId) } }).lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));
  const month = monthIST();
  const details = [];
  input.lines.forEach((l, i) => {
    if (!byId.has(l.itemId)) details.push({ path: `lines.${i}.itemId`, message: 'Pick an item' });
    if (l.expiry <= month)
      details.push({ path: `lines.${i}.expiry`, message: 'Expired or expiring this month' });
    if (l.mrp < l.rate)
      details.push({ path: `lines.${i}.mrp`, message: 'MRP is below the purchase rate' });
  });
  if (details.length) throw errors.validation(details);
  const s = await settingsDoc();
  const lines = input.lines.map((l) => {
    const poLine = po?.lines.find((p) => String(p.itemId) === l.itemId);
    return {
      ...l,
      name: byId.get(l.itemId).name,
      gstRate: byId.get(l.itemId).gstRate,
      poRate: poLine?.rate,
    };
  });
  const over = lines.filter((l) => l.poRate && l.rate > l.poRate * (1 + s.grnVariancePct / 100));
  const total = lines.reduce((sum, l) => sum + l.rate * l.qty, 0);
  const tax = lines.reduce((sum, l) => sum + Math.round((l.rate * l.qty * l.gstRate) / 100), 0);
  return withTransaction(async () => {
    const [g] = await Grn.create([
      {
        poId: po?._id,
        poNo: po?.poNo,
        vendorId,
        vendorName: vendor.name,
        storeId,
        invoiceNo: input.invoiceNo,
        invoiceDate: input.invoiceDate,
        lines,
        total,
        tax,
        status: over.length ? 'PENDING_APPROVAL' : 'POSTED',
      },
    ]);
    if (over.length) {
      const approval = await requestApproval({
        action: 'inventory.grnVariance',
        module: 'INV',
        entity: 'Grn',
        entityId: g._id,
        title: `Goods receipt above PO rate · ${vendor.name} · invoice ${input.invoiceNo}`,
        before: { rates: over.map((l) => `${l.name} ${l.poRate}`) },
        after: { rates: over.map((l) => `${l.name} ${l.rate}`) },
        payload: { grnId: String(g._id) },
        metrics: { amount: total },
        reason: `Rate above the PO by more than ${s.grnVariancePct}%`,
      });
      if (approval) {
        g.approvalId = approval._id;
        await g.save();
        if (res) res.locals.status = 202;
        return grnOut(g.toObject());
      }
    }
    await postGrn(g);
    return grnOut(g.toObject());
  });
}

onApprovalDecided('inventory.grnVariance', async (req, outcome) => {
  const g = await Grn.findById(req.payload.grnId);
  if (!g || g.status !== 'PENDING_APPROVAL') return;
  if (outcome === 'APPROVED') await withTransaction(() => postGrn(g));
  else {
    g.status = 'REJECTED';
    await g.save();
  }
});

// ---------------------------------------------------------------- indents and transfers

const indentOut = (n) => ({
  id: String(n._id),
  indentNo: n.indentNo,
  fromStoreId: String(n.fromStoreId),
  toStoreId: String(n.toStoreId),
  status: n.status,
  lines: n.lines.map((l) => ({
    itemId: String(l.itemId),
    name: l.name,
    qty: l.qty,
    issued: l.issued,
  })),
  note: n.note ?? null,
  raisedBy: n.raisedBy ?? null,
  issuedAt: n.issuedAt ?? null,
  issuedBy: n.issuedBy ?? null,
  createdAt: n.createdAt,
});

export const indentInput = z.object({
  fromStoreId: z.string(),
  toStoreId: z.string(),
  lines: z
    .array(z.object({ itemId: z.string(), qty: z.number().int().min(1).max(100000) }))
    .min(1)
    .max(50),
  note: text(300).optional(),
});

export async function listIndents({ status } = {}) {
  const rows = await Indent.find(status ? { status: { $in: status.split(',') } } : {})
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return { items: rows.map(indentOut), total: rows.length, page: 1, limit: 200 };
}

export async function createIndent(input) {
  if (input.fromStoreId === input.toStoreId)
    throw errors.validation([{ path: 'toStoreId', message: 'Pick a different store' }]);
  const items = await Item.find({ _id: { $in: input.lines.map((l) => l.itemId) } })
    .select('name')
    .lean();
  const name = new Map(items.map((i) => [String(i._id), i.name]));
  const [n] = await Indent.create([
    {
      ...input,
      indentNo: await documentNumber('IND'),
      lines: input.lines.map((l) => ({ ...l, name: name.get(l.itemId) })),
      raisedBy: await userName(),
    },
  ]);
  return indentOut(n.toObject());
}

/** Issue an indent: FEFO transfer of what is in stock; a shortfall leaves it partial. */
export async function issueIndent(id) {
  const n = await Indent.findById(id);
  if (!n) throw errors.notFound('Indent');
  if (!['OPEN', 'PARTIAL'].includes(n.status))
    throw new AppError(409, 'INVALID_STATE', 'This indent is closed.');
  return withTransaction(async () => {
    const by = await userName();
    for (const l of n.lines) {
      const want = l.qty - l.issued;
      if (want <= 0) continue;
      const have = (
        await StockBatch.find({
          storeId: n.fromStoreId,
          itemId: l.itemId,
          qty: { $gt: 0 },
          expiry: { $gte: monthIST() },
        }).lean()
      ).reduce((s, b) => s + b.qty, 0);
      const qty = Math.min(want, have);
      if (!qty) continue;
      await transfer({
        fromStoreId: n.fromStoreId,
        toStoreId: n.toStoreId,
        lines: [{ itemId: l.itemId, qty }],
        ref: n.indentNo,
        by,
      });
      l.issued += qty;
    }
    n.status = n.lines.every((l) => l.issued >= l.qty)
      ? 'ISSUED'
      : n.lines.some((l) => l.issued)
        ? 'PARTIAL'
        : 'OPEN';
    if (n.status !== 'OPEN') {
      n.issuedAt = new Date();
      n.issuedBy = by;
    }
    await n.save();
    return indentOut(n.toObject());
  });
}

export const transferInput = z.object({
  fromStoreId: z.string(),
  toStoreId: z.string(),
  lines: z
    .array(z.object({ itemId: z.string(), qty: z.number().int().min(1).max(100000) }))
    .min(1)
    .max(50),
});
export async function directTransfer(input) {
  return withTransaction(async () => {
    const ref = await documentNumber('TRF');
    return { ref, moved: await transfer({ ...input, ref }) };
  });
}

// ---------------------------------------------------------------- stock count adjustment

export const adjustInput = z.object({
  storeId: z.string(),
  itemId: z.string(),
  batchNo: text(30).min(1),
  countedQty: z.number().int().min(0).max(1_000_000),
  reason: text(300).min(3),
});

async function applyAdjustment(a) {
  const b = await StockBatch.findOne({ storeId: a.storeId, itemId: a.itemId, batchNo: a.batchNo });
  if (!b) throw errors.notFound('Batch');
  const delta = a.countedQty - b.qty;
  if (delta > 0)
    await addStock({
      storeId: a.storeId,
      itemId: a.itemId,
      batchNo: a.batchNo,
      expiry: b.expiry,
      mrp: b.mrp,
      cost: b.cost,
      qty: delta,
      kind: 'ADJUST',
      ref: a.adjNo,
    });
  else if (delta < 0)
    await deduct([{ batchId: b._id, batchNo: b.batchNo, qty: -delta }], {
      kind: 'ADJUST',
      ref: a.adjNo,
    });
  a.status = 'APPLIED';
  a.appliedAt = new Date();
  await a.save();
}

/** Physical count: the variance is applied after the stock-adjustment approval (maker-checker). */
export async function createAdjustment(input, res) {
  const b = await StockBatch.findOne({
    storeId: input.storeId,
    itemId: input.itemId,
    batchNo: input.batchNo,
  }).lean();
  if (!b) throw errors.notFound('Batch');
  const delta = input.countedQty - b.qty;
  if (!delta)
    throw errors.validation([{ path: 'countedQty', message: 'The count matches the system' }]);
  const item = await Item.findById(input.itemId).select('name').lean();
  const value = Math.abs(delta) * (b.cost ?? 0);
  const [a] = await StockAdjustment.create([
    {
      ...input,
      adjNo: await documentNumber('ADJ'),
      name: item?.name,
      systemQty: b.qty,
      delta,
      value,
    },
  ]);
  const approval = await requestApproval({
    action: 'inventory.stockAdjust',
    module: 'INV',
    entity: 'StockAdjustment',
    entityId: a._id,
    title: `Stock count · ${item?.name} · batch ${input.batchNo} · ${delta > 0 ? '+' : ''}${delta}`,
    before: { qty: b.qty },
    after: { qty: input.countedQty },
    payload: { adjustmentId: String(a._id) },
    metrics: { amount: value },
    reason: input.reason,
  });
  if (approval) {
    a.approvalId = approval._id;
    await a.save();
    if (res) res.locals.status = 202;
    return {
      id: String(a._id),
      adjNo: a.adjNo,
      status: a.status,
      delta,
      approvalId: String(approval._id),
    };
  }
  await withTransaction(() => applyAdjustment(a));
  return { id: String(a._id), adjNo: a.adjNo, status: a.status, delta };
}

onApprovalDecided('inventory.stockAdjust', async (req, outcome) => {
  const a = await StockAdjustment.findById(req.payload.adjustmentId);
  if (!a || a.status !== 'PENDING_APPROVAL') return;
  if (outcome === 'APPROVED') await withTransaction(() => applyAdjustment(a));
  else {
    a.status = 'REJECTED';
    await a.save();
  }
});

/** Reorder suggestions: items at or below their level in a store, with the last vendor rate. */
export async function reorderSuggestions({ storeId } = {}) {
  const items = await Item.find({ isActive: true, reorderLevel: { $gt: 0 } }).lean();
  const filter = { itemId: { $in: items.map((i) => i._id) }, expiry: { $gte: monthIST() } };
  if (storeId) filter.storeId = storeId;
  const batches = await StockBatch.find(filter).lean();
  const out = [];
  for (const it of items) {
    const qty = batches
      .filter((b) => String(b.itemId) === String(it._id))
      .reduce((s, b) => s + b.qty, 0);
    if (qty > it.reorderLevel) continue;
    const lastGrn = await Grn.findOne({ 'lines.itemId': it._id, status: 'POSTED' })
      .sort({ postedAt: -1 })
      .lean();
    const line = lastGrn?.lines.find((l) => String(l.itemId) === String(it._id));
    out.push({
      itemId: String(it._id),
      name: it.name,
      qty,
      reorderLevel: it.reorderLevel,
      suggest: Math.max(it.reorderLevel * 2 - qty, it.packSize ?? 1),
      lastRate: line?.rate ?? null,
      lastVendorId: lastGrn ? String(lastGrn.vendorId) : null,
      lastVendor: lastGrn?.vendorName ?? null,
    });
  }
  return { items: out };
}

export async function getSettings() {
  const s = await settingsDoc();
  return {
    grnVariancePct: s.grnVariancePct,
    nearExpiryDays: s.nearExpiryDays,
    deadStockDays: s.deadStockDays,
    version: s.version,
  };
}
export const settingsInput = z.object({
  grnVariancePct: z.number().min(0).max(50).optional(),
  deadStockDays: z.number().int().min(30).max(365).optional(),
});
export async function saveSettings(input) {
  const s = await settingsDoc();
  s.set(input);
  await s.save();
  return getSettings();
}
export { pick };
