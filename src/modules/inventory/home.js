import { registerHome, status } from '../../core/home/registry.js';
import { Indent, Item, PurchaseOrder, StockBatch, Store } from './models/inventory.models.js';
import { monthIST } from './services/stock.service.js';

/** Store and pharmacy stock widgets: reorder, expiry, indents, purchase orders. */
const DAY = 86_400_000;

/** Items at or below their reorder level (usable stock only). */
async function belowReorder() {
  const items = await Item.find({ isActive: true, reorderLevel: { $gt: 0 } })
    .select('reorderLevel')
    .lean();
  if (!items.length) return 0;
  const stock = await StockBatch.aggregate([
    { $match: { itemId: { $in: items.map((i) => i._id) }, expiry: { $gte: monthIST() } } },
    { $group: { _id: '$itemId', qty: { $sum: '$qty' } } },
  ]);
  const qty = new Map(stock.map((s) => [String(s._id), s.qty]));
  return items.filter((i) => (qty.get(String(i._id)) ?? 0) <= i.reorderLevel).length;
}

registerHome({
  id: 'inv.belowReorder',
  panels: ['store', 'pharmacy'],
  permission: 'inventory:stock:read',
  module: 'INV',
  kind: 'kpi',
  order: 20,
  build: async () => {
    const [n, onOrder] = await Promise.all([
      belowReorder(),
      PurchaseOrder.countDocuments({ status: { $in: ['APPROVED', 'PARTIAL'] } }),
    ]);
    return {
      value: n,
      format: 'count',
      params: { onOrder },
      tone: n ? 'warning' : 'neutral',
      link: '/inventory?tab=reports',
    };
  },
});

registerHome({
  id: 'inv.expiring',
  panels: ['store', 'pharmacy'],
  permission: 'inventory:stock:read',
  module: 'INV',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => {
    // Batches are usable to the end of their expiry month: this month and the next.
    const next = new Date(ctx.now.getTime() + 330 * 60_000 + 31 * DAY).toISOString().slice(0, 7);
    const n = await StockBatch.countDocuments({
      qty: { $gt: 0 },
      expiry: { $gte: monthIST(), $lte: next },
    });
    return {
      value: n,
      format: 'count',
      tone: n ? 'warning' : 'neutral',
      link: '/inventory?tab=reports',
    };
  },
});

registerHome({
  id: 'inv.indentsOpen',
  panels: ['store', 'wardincharge', 'pharmacy'],
  permission: 'inventory:stock:read',
  module: 'INV',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const open = await Indent.find({ status: { $in: ['OPEN', 'PARTIAL'] } })
      .select('createdAt')
      .lean();
    const oldest = open.reduce(
      (m, i) => Math.max(m, Math.floor((ctx.now - new Date(i.createdAt)) / DAY)),
      0,
    );
    return {
      value: open.length,
      format: 'count',
      params: { oldest },
      tone: oldest >= 2 ? 'warning' : 'neutral',
      link: '/inventory?tab=indents',
    };
  },
});

registerHome({
  id: 'inv.posOpen',
  panels: ['store'],
  permission: 'inventory:stock:read',
  module: 'INV',
  kind: 'kpi',
  order: 40,
  build: async () => {
    const [open, approval] = await Promise.all([
      PurchaseOrder.countDocuments({ status: { $in: ['APPROVED', 'PARTIAL'] } }),
      PurchaseOrder.countDocuments({ status: 'PENDING_APPROVAL' }),
    ]);
    return { value: open, format: 'count', params: { approval }, link: '/inventory?tab=po' };
  },
});

registerHome({
  id: 'inv.indentList',
  panels: ['store'],
  permission: 'inventory:stock:read',
  module: 'INV',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await Indent.find({ status: { $in: ['OPEN', 'PARTIAL'] } })
      .select('indentNo fromStoreId lines status createdAt')
      .sort({ createdAt: 1 })
      .limit(12)
      .lean();
    const stores = new Map(
      (
        await Store.find({ _id: { $in: rows.map((r) => r.fromStoreId) } })
          .select('name')
          .lean()
      ).map((s) => [String(s._id), s.name]),
    );
    return {
      link: '/inventory?tab=indents',
      columns: [
        { key: 'indent', kind: 'id' },
        { key: 'from', kind: 'text' },
        { key: 'items', kind: 'count' },
        { key: 'waited', kind: 'minutes' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((r) => ({
        id: String(r._id),
        indent: r.indentNo,
        from: stores.get(String(r.fromStoreId)) ?? '',
        items: r.lines?.length ?? 0,
        waited: Math.round((ctx.now - new Date(r.createdAt)) / 60_000),
        status: status(r.status, r.status === 'PARTIAL' ? 'warning' : 'info'),
      })),
    };
  },
});
