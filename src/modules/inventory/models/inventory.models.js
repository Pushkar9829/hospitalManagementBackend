import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/**
 * Item master: medicines, consumables, lab reagents and general stores. Stock is kept in the base
 * unit (tablet, ml, piece); purchase packs are a display convenience. Money in paise per base unit.
 * GST: most medicines 5% and listed life-saving drugs 0% from 22 September 2025.
 */
const itemSchema = new Schema({
  code: { type: String, required: true }, // for medicines, the formulary id used on prescriptions
  name: { type: String, required: true },
  kind: {
    type: String,
    enum: ['DRUG', 'CONSUMABLE', 'REAGENT', 'GENERAL', 'FOOD'],
    default: 'DRUG',
  },
  unit: { type: String, default: 'unit' }, // tablet, ml, piece
  packSize: { type: Number, default: 1 },
  hsn: String,
  gstRate: { type: Number, default: 5 },
  reorderLevel: { type: Number, default: 0 },
  rack: String,
  drug: {
    generic: String,
    form: String,
    strengthMg: Number, // per base unit, for the weight-based check
    schedule: { type: String, enum: ['OTC', 'H', 'H1', 'X', 'NARCOTIC'], default: 'H' },
    lifeSaving: { type: Boolean, default: false },
    maxMgPerKgDay: Number, // children: daily dose above this needs the pharmacist's override
  },
  isActive: { type: Boolean, default: true },
});
itemSchema.index({ tenantId: 1, code: 1 }, { unique: true });
itemSchema.index({ tenantId: 1, 'drug.generic': 1 });
itemSchema.index({ tenantId: 1, name: 1 });
export const Item = defineModel('Item', itemSchema);

/** Stores: main store, pharmacy counters, ward and OT sub-stores, the lab store, the kitchen. */
const storeSchema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  kind: {
    type: String,
    enum: ['MAIN', 'PHARMACY', 'WARD', 'OT', 'LAB', 'KITCHEN'],
    default: 'MAIN',
  },
  wardId: { type: id, ref: 'Ward' },
  isActive: { type: Boolean, default: true },
});
storeSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const Store = defineModel('Store', storeSchema);

const vendorSchema = new Schema({
  code: { type: String, required: true },
  name: { type: String, required: true },
  gstin: String,
  phone: String,
  drugLicence: String,
  isActive: { type: Boolean, default: true },
});
vendorSchema.index({ tenantId: 1, code: 1 }, { unique: true });
export const Vendor = defineModel('Vendor', vendorSchema);

/**
 * Stock per store, item and batch. Quantity never goes below zero: every deduction is a
 * conditional update inside the same transaction as the sale or issue.
 */
const batchSchema = new Schema({
  storeId: { type: id, ref: 'Store', required: true },
  itemId: { type: id, ref: 'Item', required: true },
  batchNo: { type: String, required: true },
  expiry: { type: String, required: true }, // YYYY-MM; usable to the last day of the month
  mrp: { type: Number, required: true }, // paise per base unit, GST inclusive
  cost: { type: Number, default: 0 }, // paise per base unit
  qty: { type: Number, default: 0, min: 0 },
  lastMoveAt: Date,
});
batchSchema.index({ tenantId: 1, storeId: 1, itemId: 1, batchNo: 1 }, { unique: true });
batchSchema.index({ tenantId: 1, storeId: 1, itemId: 1, expiry: 1 });
batchSchema.index({ tenantId: 1, expiry: 1 });
export const StockBatch = defineModel('StockBatch', batchSchema);

/** Stock ledger: every movement, with the balance of that batch after it. */
const moveSchema = new Schema({
  at: { type: Date, required: true },
  storeId: { type: id, ref: 'Store', required: true },
  itemId: { type: id, ref: 'Item', required: true },
  batchNo: String,
  qty: { type: Number, required: true }, // + in, - out
  kind: {
    type: String,
    enum: [
      'GRN',
      'SALE',
      'ISSUE',
      'RETURN',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'ADJUST',
      'EXPIRY',
      'VENDOR_RETURN',
    ],
    required: true,
  },
  ref: String, // document number
  value: Number, // paise at cost
  balance: Number,
  by: String,
});
moveSchema.index({ tenantId: 1, itemId: 1, at: -1 });
moveSchema.index({ tenantId: 1, storeId: 1, at: -1 });
export const StockMove = defineModel('StockMove', moveSchema);

/**
 * Purchase order: DRAFT → PENDING_APPROVAL → APPROVED → PARTIAL → RECEIVED, CANCELLED from the
 * first three. Approval through the maker-checker rule inventory.purchaseOrder.
 */
const poSchema = new Schema({
  poNo: String,
  vendorId: { type: id, ref: 'Vendor', required: true },
  vendorName: String,
  storeId: { type: id, ref: 'Store', required: true },
  status: {
    type: String,
    enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CANCELLED'],
    default: 'DRAFT',
  },
  lines: [
    {
      _id: false,
      itemId: { type: id, ref: 'Item', required: true },
      name: String,
      qty: { type: Number, required: true },
      rate: { type: Number, required: true }, // paise per base unit
      received: { type: Number, default: 0 },
    },
  ],
  total: Number,
  notes: String,
  approvalId: { type: id, ref: 'ApprovalRequest' },
  approvedAt: Date,
});
poSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const PurchaseOrder = defineModel('PurchaseOrder', poSchema);

/**
 * Goods receipt against a PO or direct: batches with expiry and MRP. A rate above the PO rate by
 * more than the set share waits for the inventory.grnVariance approval before stock is added.
 */
const grnSchema = new Schema({
  grnNo: String,
  poId: { type: id, ref: 'PurchaseOrder' },
  poNo: String,
  vendorId: { type: id, ref: 'Vendor', required: true },
  vendorName: String,
  storeId: { type: id, ref: 'Store', required: true },
  invoiceNo: String,
  invoiceDate: String,
  status: { type: String, enum: ['PENDING_APPROVAL', 'POSTED', 'REJECTED'], default: 'POSTED' },
  lines: [
    {
      _id: false,
      itemId: { type: id, ref: 'Item', required: true },
      name: String,
      batchNo: String,
      expiry: String,
      qty: Number,
      freeQty: { type: Number, default: 0 },
      rate: Number,
      mrp: Number,
      gstRate: Number,
      poRate: Number,
    },
  ],
  total: Number, // at rate, before GST
  tax: Number,
  postedAt: Date,
  postedBy: String,
  approvalId: { type: id, ref: 'ApprovalRequest' },
});
grnSchema.index({ tenantId: 1, createdAt: -1 });
export const Grn = defineModel('Grn', grnSchema);

/** Indent: a ward or department asks a store for items; the store issues (a transfer). */
const indentSchema = new Schema({
  indentNo: String,
  fromStoreId: { type: id, ref: 'Store', required: true }, // the store that issues
  toStoreId: { type: id, ref: 'Store', required: true }, // the store that asked
  status: { type: String, enum: ['OPEN', 'ISSUED', 'PARTIAL', 'CANCELLED'], default: 'OPEN' },
  lines: [
    {
      _id: false,
      itemId: { type: id, ref: 'Item', required: true },
      name: String,
      qty: Number,
      issued: { type: Number, default: 0 },
    },
  ],
  note: String,
  raisedBy: String,
  issuedAt: Date,
  issuedBy: String,
});
indentSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const Indent = defineModel('Indent', indentSchema);

/** Physical count variance: applied after the inventory.stockAdjust approval. */
const adjustSchema = new Schema({
  adjNo: String,
  storeId: { type: id, ref: 'Store', required: true },
  itemId: { type: id, ref: 'Item', required: true },
  name: String,
  batchNo: String,
  systemQty: Number,
  countedQty: Number,
  delta: Number,
  value: Number, // paise at cost
  reason: String,
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'APPLIED', 'REJECTED'],
    default: 'PENDING_APPROVAL',
  },
  approvalId: { type: id, ref: 'ApprovalRequest' },
  appliedAt: Date,
});
export const StockAdjustment = defineModel('StockAdjustment', adjustSchema);

/** One per hospital. */
const settingsSchema = new Schema({
  grnVariancePct: { type: Number, default: 5 },
  nearExpiryDays: { type: [Number], default: [90, 60, 30] },
  deadStockDays: { type: Number, default: 90 },
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const InventorySettings = defineModel('InventorySettings', settingsSchema);

/**
 * Purchase requisition (board Inventory, "Requisitions"): a department or the reorder check asks
 * the store to buy; the store turns it into a purchase order (which has its own approval) or
 * rejects it with a reason.
 */
const requisitionSchema = new Schema({
  prNo: { type: String, required: true },
  storeId: { type: id, ref: 'Store', required: true },
  source: { type: String, enum: ['MANUAL', 'REORDER'], default: 'MANUAL' },
  reason: String,
  lines: [
    {
      _id: false,
      itemId: { type: id, ref: 'Item', required: true },
      name: String,
      qty: { type: Number, required: true },
      rate: Number, // estimated, paise
    },
  ],
  estimate: Number,
  status: { type: String, enum: ['OPEN', 'PO_CREATED', 'REJECTED'], default: 'OPEN' },
  raisedBy: String,
  poId: { type: id, ref: 'PurchaseOrder' },
  decidedBy: String,
  decidedAt: Date,
  rejectReason: String,
});
requisitionSchema.index({ tenantId: 1, prNo: 1 }, { unique: true });
requisitionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
export const PurchaseRequisition = defineModel('PurchaseRequisition', requisitionSchema);
