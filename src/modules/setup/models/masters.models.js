import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

/** Common shape: unique code per hospital, name, active flag. */
function master(name, fields, extraIndexes = []) {
  const schema = new Schema({
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    ...fields,
  });
  schema.index({ tenantId: 1, code: 1 }, { unique: true });
  schema.index({ tenantId: 1, isActive: 1, name: 1 });
  for (const idx of extraIndexes) schema.index(idx);
  return defineModel(name, schema);
}

export const PriceList = master('PriceList', {
  kind: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
});

export const TaxCode = master('TaxCode', {
  kind: { type: String, required: true },
  rate: { type: Number, required: true },
  hsnSac: String,
});

export const PaymentMode = master('PaymentMode', {
  kind: { type: String, required: true },
  requiresReference: { type: Boolean, default: false },
});

export const ReferralSource = master('ReferralSource', {
  kind: { type: String, required: true },
  phone: String,
});

export const Unit = master('Unit', { baseUnit: String, factor: { type: Number, default: 1 } });

export const Designation = master('Designation', { grade: String });

export const Holiday = master(
  'Holiday',
  {
    date: { type: Date, required: true },
    branchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
  },
  [{ tenantId: 1, date: 1 }],
);

/**
 * Every chargeable item (spec 5.3). Rates are per price list in paise. A rate change, and a new
 * service, wait for Super Admin approval (billing.tariffChange) before they are used in bills.
 */
export const Service = master(
  'Service',
  {
    category: { type: String, required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    taxCodeId: { type: Schema.Types.ObjectId, ref: 'TaxCode', required: true },
    revenueHead: String,
    rates: [
      {
        _id: false,
        priceListId: { type: Schema.Types.ObjectId, ref: 'PriceList' },
        amount: { type: Number, min: 0 },
      },
    ],
    /** Proposed rates waiting for approval; `rates` stay in use until it is approved. */
    pendingRates: {
      type: [
        {
          _id: false,
          priceListId: { type: Schema.Types.ObjectId, ref: 'PriceList' },
          amount: { type: Number, min: 0 },
        },
      ],
      default: undefined,
    },
    status: {
      type: String,
      enum: ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'INACTIVE'],
      default: 'PENDING_APPROVAL',
    },
    approvalId: { type: Schema.Types.ObjectId, ref: 'ApprovalRequest' },
  },
  [{ tenantId: 1, category: 1, status: 1 }],
);

/** Wards per branch (spec 5.2). The rate per day comes from the linked bed-day service. */
export const Ward = master(
  'Ward',
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    floor: String,
    category: { type: String, required: true },
    gender: { type: String, default: 'ANY' },
    bedServiceId: { type: Schema.Types.ObjectId, ref: 'Service' },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  },
  [{ tenantId: 1, branchId: 1, isActive: 1 }],
);

/** Beds. Occupancy (status) is owned by the IPD module; the master only describes the bed. */
export const Bed = master(
  'Bed',
  {
    wardId: { type: Schema.Types.ObjectId, ref: 'Ward', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    room: String,
    kind: { type: String, default: 'STANDARD' },
  },
  [{ tenantId: 1, wardId: 1, isActive: 1 }],
);

export const Package = master('Package', {
  kind: { type: String, required: true },
  price: { type: Number, min: 0, required: true }, // paise
  stayDays: { type: Number, default: 0 },
  wardCategory: String,
  includes: { type: [String], default: [] },
  excludes: { type: [String], default: [] },
  taxCodeId: { type: Schema.Types.ObjectId, ref: 'TaxCode', required: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
});

/** Insurers, TPAs, corporates and government schemes who pay for patients. */
export const Payer = master(
  'Payer',
  {
    kind: { type: String, required: true },
    priceListId: { type: Schema.Types.ObjectId, ref: 'PriceList' },
    creditLimit: { type: Number, default: 0 }, // paise
    creditDays: { type: Number, default: 30 },
    /** Billing puts a corporate on hold (no new credit bills) while payments are overdue. */
    creditHold: { on: { type: Boolean, default: false }, reason: String, at: Date, by: String },
    gstin: String,
    contactName: String,
    email: String,
    phone: String,
  },
  [{ tenantId: 1, kind: 1, isActive: 1 }],
);

export const Doctor = master(
  'Doctor',
  {
    kind: { type: String, required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    registrationNo: { type: String, required: true },
    council: String,
    qualification: String,
    specialisation: String,
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    consultationServiceId: { type: Schema.Types.ObjectId, ref: 'Service' },
  },
  [{ tenantId: 1, departmentId: 1, isActive: 1 }],
);
