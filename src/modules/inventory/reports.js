import { GROUPS, period, registerReport, registerTile, tone } from '../../core/reports/registry.js';
import { Grn, Item, StockBatch, StockMove, Store } from './models/inventory.models.js';

/** Stores reports: valuation, expiry, movement and purchases. */
const DAY = 86_400_000;
const stores = async () => (await Store.find({}).select('name').lean()).map((s) => s.name).sort();
const storeFilter = { key: 'store', label: 'Store', options: stores };
async function storeId(name) {
  return name ? (await Store.findOne({ name }).select('_id').lean())?._id : undefined;
}

registerReport({
  code: 'stock-valuation',
  name: 'Stock valuation',
  group: GROUPS.STOCK,
  module: 'INV',
  permission: 'reports:inventory:read',
  description: 'Stock on hand at cost and at MRP, by store and item.',
  filters: [storeFilter],
  columns: [
    ['store', 'Store', 'text'],
    ['item', 'Item', 'text'],
    ['qty', 'Qty', 'count'],
    ['cost', 'Value at cost', 'money'],
    ['mrp', 'Value at MRP', 'money'],
  ],
  run: async ({ filters }) => {
    const sid = await storeId(filters.store);
    const batches = await StockBatch.find({
      qty: { $gt: 0 },
      ...(sid ? { storeId: sid } : {}),
    }).lean();
    const [items, sts] = await Promise.all([
      Item.find({ _id: { $in: [...new Set(batches.map((b) => String(b.itemId)))] } })
        .select('name')
        .lean(),
      Store.find({}).select('name').lean(),
    ]);
    const itemName = new Map(items.map((i) => [String(i._id), i.name]));
    const storeName = new Map(sts.map((s) => [String(s._id), s.name]));
    const by = new Map();
    for (const b of batches) {
      const k = `${b.storeId}|${b.itemId}`;
      const r = by.get(k) ?? {
        store: storeName.get(String(b.storeId)) ?? '',
        item: itemName.get(String(b.itemId)) ?? '',
        qty: 0,
        cost: 0,
        mrp: 0,
      };
      r.qty += b.qty;
      r.cost += b.qty * (b.cost ?? 0);
      r.mrp += b.qty * (b.mrp ?? 0);
      by.set(k, r);
    }
    const rows = [...by.values()].sort((a, b) => b.cost - a.cost);
    return {
      kpis: [
        ['cost', 'Stock at cost', rows.reduce((t, r) => t + r.cost, 0), 'money'],
        ['mrp', 'Stock at MRP', rows.reduce((t, r) => t + r.mrp, 0), 'money'],
      ],
      items: rows.map((r) => ({ ...r, cost: Math.round(r.cost), mrp: Math.round(r.mrp) })),
    };
  },
});

registerReport({
  code: 'expiry-report',
  name: 'Expiry report',
  group: GROUPS.STOCK,
  module: 'INV',
  permission: 'reports:inventory:read',
  description: 'Batches expired or expiring within 90 days of the end date, by store.',
  filters: [storeFilter],
  columns: [
    ['expiry', 'Expiry', 'text'],
    ['store', 'Store', 'text'],
    ['item', 'Item', 'text'],
    ['batchNo', 'Batch', 'id'],
    ['qty', 'Qty', 'count'],
    ['value', 'Value at cost', 'money'],
    ['status', 'Status', 'status'],
  ],
  run: async ({ to, filters }) => {
    const sid = await storeId(filters.store);
    const limit = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 90 * DAY)
      .toISOString()
      .slice(0, 7);
    const now = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const batches = await StockBatch.find({
      qty: { $gt: 0 },
      expiry: { $lte: limit },
      ...(sid ? { storeId: sid } : {}),
    })
      .sort({ expiry: 1 })
      .lean();
    const names = new Map(
      (
        await Item.find({ _id: { $in: batches.map((b) => b.itemId) } })
          .select('name')
          .lean()
      ).map((i) => [String(i._id), i.name]),
    );
    const sts = new Map(
      (await Store.find({}).select('name').lean()).map((s) => [String(s._id), s.name]),
    );
    const items = batches.map((b) => ({
      expiry: b.expiry,
      store: sts.get(String(b.storeId)) ?? '',
      item: names.get(String(b.itemId)) ?? '',
      batchNo: b.batchNo,
      qty: b.qty,
      value: Math.round(b.qty * (b.cost ?? 0)),
      status: b.expiry < now ? tone.bad('Expired') : tone.warn('Expiring'),
    }));
    return {
      kpis: [
        [
          'expired',
          'Expired value',
          items.filter((i) => i.status.tone === 'critical').reduce((t, i) => t + i.value, 0),
          'money',
        ],
        [
          'expiring',
          'Expiring value',
          items.filter((i) => i.status.tone === 'warning').reduce((t, i) => t + i.value, 0),
          'money',
        ],
      ],
      items,
    };
  },
});

registerReport({
  code: 'fast-slow-moving',
  name: 'Fast and slow moving',
  group: GROUPS.STOCK,
  module: 'INV',
  permission: 'reports:inventory:read',
  description:
    'Quantity issued or sold in the period per item, with stock in hand and days of cover.',
  columns: [
    ['item', 'Item', 'text'],
    ['out', 'Used in period', 'count'],
    ['perDay', 'Per day', 'number'],
    ['inHand', 'In hand', 'count'],
    ['cover', 'Days of cover', 'days'],
    ['class', 'Movement', 'status'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const days = Math.max(1, Math.round((p.to - p.from) / DAY));
    const [moves, batches, items] = await Promise.all([
      StockMove.find({ at: { $gte: p.from, $lte: p.to }, kind: { $in: ['SALE', 'ISSUE'] } })
        .select('itemId qty')
        .lean(),
      StockBatch.find({ qty: { $gt: 0 } })
        .select('itemId qty')
        .lean(),
      Item.find({ isActive: { $ne: false } })
        .select('name')
        .lean(),
    ]);
    const used = new Map();
    for (const m of moves) used.set(String(m.itemId), (used.get(String(m.itemId)) ?? 0) - m.qty);
    const stock = new Map();
    for (const b of batches)
      stock.set(String(b.itemId), (stock.get(String(b.itemId)) ?? 0) + b.qty);
    const rows = items
      .map((i) => {
        const out = used.get(String(i._id)) ?? 0;
        const perDay = out / days;
        const inHand = stock.get(String(i._id)) ?? 0;
        return {
          item: i.name,
          out,
          perDay: Math.round(perDay * 10) / 10,
          inHand,
          cover: perDay > 0 ? Math.round(inHand / perDay) : null,
          class:
            out === 0 ? tone.bad('Not moving') : perDay >= 5 ? tone.ok('Fast') : tone.plain('Slow'),
        };
      })
      .filter((r) => r.out > 0 || r.inHand > 0)
      .sort((a, b) => b.out - a.out);
    return {
      kpis: [['notMoving', 'Items not moving', rows.filter((r) => r.out === 0).length, 'count']],
      items: rows,
    };
  },
});

registerReport({
  code: 'purchase-register',
  name: 'Purchase register',
  group: GROUPS.STOCK,
  module: 'INV',
  permission: 'reports:inventory:read',
  description: 'Goods receipts with vendor, invoice, value and GST.',
  columns: [
    ['postedAt', 'Received', 'datetime'],
    ['grnNo', 'GRN', 'id'],
    ['vendor', 'Vendor', 'text'],
    ['invoiceNo', 'Invoice', 'id'],
    ['lines', 'Lines', 'count'],
    ['value', 'Value', 'money'],
    ['tax', 'GST', 'money'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await Grn.find({ postedAt: { $gte: p.from, $lte: p.to } })
      .sort({ postedAt: 1 })
      .lean();
    return {
      kpis: [
        ['value', 'Purchases', rows.reduce((t, g) => t + (g.total ?? 0), 0), 'money'],
        ['tax', 'Input GST', rows.reduce((t, g) => t + (g.tax ?? 0), 0), 'money'],
      ],
      items: rows.map((g) => ({
        postedAt: g.postedAt,
        grnNo: g.grnNo,
        vendor: g.vendorName ?? '',
        invoiceNo: g.invoiceNo ?? '',
        lines: g.lines?.length ?? 0,
        value: g.total ?? 0,
        tax: g.tax ?? 0,
      })),
    };
  },
});

registerTile({
  key: 'stock-expiring',
  label: 'Stock expiring in 90 days',
  group: GROUPS.STOCK,
  module: 'INV',
  permission: 'reports:inventory:read',
  kind: 'money',
  report: 'expiry-report',
  run: async () => {
    const limit = new Date(Date.now() + 330 * 60_000 + 90 * DAY).toISOString().slice(0, 7);
    const rows = await StockBatch.find({ qty: { $gt: 0 }, expiry: { $lte: limit } })
      .select('qty cost')
      .lean();
    return {
      value: Math.round(rows.reduce((t, b) => t + b.qty * (b.cost ?? 0), 0)),
      note: `${rows.length} batches`,
    };
  },
});
