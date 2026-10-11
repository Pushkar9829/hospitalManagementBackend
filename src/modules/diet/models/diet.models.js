import { Schema } from 'mongoose';
import { defineModel } from '../../../core/db/model.js';

const id = Schema.Types.ObjectId;

/** Diet types, meals and charging rules for the hospital (one document). */
const settingsSchema = new Schema({
  diets: {
    type: [
      {
        _id: false,
        code: String,
        name: String,
        texture: { type: String, enum: ['REGULAR', 'SOFT', 'MINCED', 'LIQUID', 'TUBE'] },
        notes: String,
        active: { type: Boolean, default: true },
        /** Diet master (board "Menu and diet master"): energy, restrictions, the day's menu. */
        calories: Number,
        restrictions: String,
        menu: { type: Map, of: String }, // meal code -> what is served
      },
    ],
    default: [
      { code: 'NORMAL', name: 'Normal', texture: 'REGULAR' },
      { code: 'SOFT', name: 'Soft', texture: 'SOFT' },
      { code: 'LIQUID', name: 'Clear liquid', texture: 'LIQUID' },
      { code: 'DIABETIC', name: 'Diabetic', texture: 'REGULAR' },
      { code: 'RENAL', name: 'Renal', texture: 'REGULAR' },
      { code: 'CARDIAC', name: 'Cardiac (low fat)', texture: 'REGULAR' },
      { code: 'LOW_SALT', name: 'Low salt', texture: 'REGULAR' },
      { code: 'HIGH_PROTEIN', name: 'High protein', texture: 'REGULAR' },
      { code: 'TUBE_FEED', name: 'Tube feed (Ryle’s tube)', texture: 'TUBE' },
    ],
  },
  meals: {
    type: [{ _id: false, code: String, name: String, time: String, cutoff: String }],
    default: [
      { code: 'BREAKFAST', name: 'Breakfast', time: '08:00', cutoff: '06:30' },
      { code: 'LUNCH', name: 'Lunch', time: '12:30', cutoff: '10:30' },
      { code: 'SNACK', name: 'Evening snack', time: '16:30', cutoff: '15:00' },
      { code: 'DINNER', name: 'Dinner', time: '19:30', cutoff: '17:30' },
    ],
  },
  defaultDiet: { type: String, default: 'NORMAL' },
  // Meals are charged to the running bill for these ward categories (spec: private rooms).
  chargeCategories: { type: [String], default: ['PRIVATE', 'DELUXE'] },
  mealServiceCode: { type: String, default: 'DIET-MEAL' },
  attendantServiceCode: { type: String, default: 'DIET-ATTENDANT' },
});
settingsSchema.index({ tenantId: 1 }, { unique: true });
export const DietSettings = defineModel('DietSettings', settingsSchema);

/**
 * The diet a patient is on. One ACTIVE order per stay; a new order ends the old one. Nil by
 * mouth (NBM) has a start and an optional end; meals inside the window are not served.
 */
const orderSchema = new Schema({
  admissionId: { type: id, ref: 'Admission', required: true },
  ipNo: String,
  patient: { _id: false, id: { type: id, ref: 'Patient' }, uhid: String, name: String },
  ward: String,
  wardCategory: String,
  bed: String,
  allergies: [String],
  diet: { type: String, required: true },
  texture: String,
  special: String, // e.g. "no onion", "extra fruit"
  attendantMeals: { type: Boolean, default: false },
  nbm: { from: Date, to: Date, reason: String },
  status: { type: String, enum: ['ACTIVE', 'ENDED'], default: 'ACTIVE' },
  from: { type: Date, default: () => new Date() },
  endedAt: Date,
  orderedBy: String,
  source: { type: String, enum: ['DEFAULT', 'DOCTOR', 'DIETITIAN'], default: 'DOCTOR' },
});
orderSchema.index(
  { tenantId: 1, admissionId: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);
orderSchema.index({ tenantId: 1, status: 1, ward: 1 });
export const DietOrder = defineModel('DietOrder', orderSchema);

/** A tray for one patient for one meal: prepared, delivered (with time), missed or held (NBM). */
const traySchema = new Schema({
  date: { type: String, required: true }, // YYYY-MM-DD (IST)
  meal: { type: String, required: true },
  admissionId: { type: id, ref: 'Admission', required: true },
  orderId: { type: id, ref: 'DietOrder' },
  patient: String,
  ward: String,
  bed: String,
  diet: String,
  status: {
    type: String,
    enum: ['PREPARED', 'DELIVERED', 'MISSED', 'NBM'],
    default: 'PREPARED',
  },
  deliveredAt: Date,
  deliveredBy: String,
  missedReason: String,
  charged: { type: Boolean, default: false },
});
traySchema.index({ tenantId: 1, date: 1, meal: 1, admissionId: 1 }, { unique: true });
traySchema.index({ tenantId: 1, date: 1, meal: 1, ward: 1 });
export const DietTray = defineModel('DietTray', traySchema);

/** Dietitian's assessment, counselling and discharge diet plan. */
const noteSchema = new Schema({
  admissionId: { type: id, ref: 'Admission', required: true },
  kind: { type: String, enum: ['ASSESSMENT', 'COUNSELLING', 'DISCHARGE_PLAN'], required: true },
  data: {
    heightCm: Number,
    weightKg: Number,
    bmi: Number,
    risk: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'] },
    kcal: Number,
    proteinG: Number,
  },
  text: { type: String, required: true },
  by: String,
  at: { type: Date, default: () => new Date() },
});
noteSchema.index({ tenantId: 1, admissionId: 1, at: -1 });
export const DietNote = defineModel('DietNote', noteSchema);
