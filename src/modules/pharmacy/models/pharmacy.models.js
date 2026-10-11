import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

const patientSnap = {
  _id: false,
  id: { type: id, ref: 'Patient', required: true },
  uhid: String,
  name: String,
  gender: String,
  age: String,
  ageDays: Number,
  mobile: String,
};
const prescriber = { _id: false, id: { type: id, ref: 'Doctor' }, name: String, regNo: String };

/**
 * The pharmacy queue: OPD prescriptions (from the signed consultation) and ward medicine orders
 * (after the pharmacist verifies; STAT at once). PENDING → DISPENSED or PARTIAL; CANCELLED.
 */
const rxSchema = new Schema({
  rxNo: String,
  source: { type: String, enum: ['OPD', 'IPD'], required: true },
  visitId: { type: id, ref: 'OpdVisit' },
  admissionId: { type: id, ref: 'Admission' },
  location: String,
  patient: patientSnap,
  prescriber,
  stat: { type: Boolean, default: false },
  lines: [
    {
      _id: false,
      orderId: String, // IPD medicine order
      drugId: String,
      brand: String,
      generic: String,
      dose: String,
      frequency: String,
      days: Number,
      route: String,
      instructions: String,
      suggestedQty: Number,
      dispensedQty: { type: Number, default: 0 },
    },
  ],
  status: {
    type: String,
    enum: ['PENDING', 'PARTIAL', 'DISPENSED', 'CANCELLED'],
    default: 'PENDING',
  },
  cancelReason: String,
});
rxSchema.index({ tenantId: 1, status: 1, createdAt: 1 });
rxSchema.index({ tenantId: 1, visitId: 1 });
export const Prescription = defineModel('Prescription', rxSchema);

/**
 * A dispense: a counter or OPD sale (an OP bill with item lines at batch MRP) or a ward issue
 * (lines on the running IP bill). Each line keeps its batch for recalls and the registers.
 */
const lineSchema = new Schema(
  {
    itemId: { type: id, ref: 'Item', required: true },
    code: String,
    name: String,
    generic: String,
    schedule: String,
    batchNo: String,
    expiry: String,
    qty: Number,
    mrp: Number, // paise per unit, GST inclusive
    gstRate: Number,
    hsn: String,
    substituteFor: String, // brand prescribed, when a generic substitute was given
    returnedQty: { type: Number, default: 0 },
  },
  { _id: true },
);
const dispenseSchema = new Schema({
  dispNo: { type: String, required: true },
  kind: { type: String, enum: ['SALE', 'ISSUE'], required: true },
  rxId: { type: id, ref: 'Prescription' },
  storeId: { type: id, ref: 'Store', required: true },
  patient: patientSnap,
  admissionId: { type: id, ref: 'Admission' },
  location: String,
  prescriber,
  prescriptionCopy: Boolean, // counter sale of Schedule H1/X: copy kept
  weightKg: Number,
  overrideReason: String,
  lines: [lineSchema],
  total: Number,
  billId: { type: id, ref: 'Bill' },
  receiptNo: String,
  by: String,
  at: Date,
});
dispenseSchema.index({ tenantId: 1, at: -1 });
dispenseSchema.index({ tenantId: 1, admissionId: 1 });
dispenseSchema.index({ tenantId: 1, 'lines.schedule': 1, at: -1 });
export const Dispense = defineModel('Dispense', dispenseSchema);

/** A ward's return of unused medicines (rule R15: settled before the final bill). */
const returnSchema = new Schema({
  dispenseId: { type: id, ref: 'Dispense', required: true },
  dispNo: String,
  admissionId: { type: id, ref: 'Admission' },
  patientName: String,
  lines: [{ _id: false, lineId: String, name: String, batchNo: String, qty: Number }],
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED'], default: 'PENDING' },
  reason: String,
  requestedBy: String,
  decidedBy: String,
  decidedAt: Date,
});
returnSchema.index({ tenantId: 1, status: 1, admissionId: 1 });
export const PharmacyReturn = defineModel('PharmacyReturn', returnSchema);
