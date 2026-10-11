import { Router } from 'express';
import { inventoryRoutes } from './inventory.routes.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages

/**
 * Inventory (spec "Inventory" and the pharmacy back-end): item master, stores, vendors, batch
 * stock with first-expiry-first-out picking and expired batches blocked, the stock ledger,
 * purchase orders and goods receipts with approvals, indents and transfers, physical counts with
 * approval, reorder, expiry and dead-stock reports. Pharmacy sells and issues through this engine.
 */
const router = Router();
router.use(inventoryRoutes);

export const inventoryModule = { name: 'inventory', router };
export { Grn, Item, Store, StockBatch, Vendor } from './models/inventory.models.js';
export { addStock, deduct, monthIST, pick, userName } from './services/stock.service.js';
