import mongoose, { Schema } from 'mongoose';
import { PLATFORM_MODELS } from '../../core/db/model.js';

/**
 * Platform data (spec 3.14). These collections are not tenant-scoped; hospital users can never
 * reach them because no hospital route reads them, and tenant queries cannot run without a
 * tenant context.
 */
const model = (name, schema) => {
  PLATFORM_MODELS.add(name);
  return mongoose.models[name] ?? mongoose.model(name, schema);
};

const subscriptionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    plan: String, // CLINIC | HOSPITAL | ENTERPRISE | null (a-la-carte)
    addOns: { type: [String], default: [] },
    cycle: { type: String, enum: ['MONTHLY', 'ANNUAL'], default: 'MONTHLY' },
    priceVersion: { type: Number, default: 1 },
    quantities: {
      branches: { type: Number, default: 1 },
      beds: { type: Number, default: 0 },
      entities: { type: Number, default: 1 },
      users: { type: Number, default: 10 },
    },
    /** Enterprise or negotiated monthly price in paise (overrides the plan price). */
    customMonthly: Number,
    currentPeriod: { start: Date, end: Date },
    /** Removals and downgrades wait for the renewal date (spec 3.6). */
    pending: {
      type: [{ _id: false, op: String, module: String, at: Date, by: String }],
      default: [],
    },
    paymentMethod: { provider: String, mandateId: String, status: String },
    converted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: 'version', optimisticConcurrency: true },
);
export const Subscription = model('Subscription', subscriptionSchema);

const invoiceSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    kind: { type: String, enum: ['PERIOD', 'PRORATION', 'CONVERSION'], required: true },
    period: { start: Date, end: Date },
    lines: [
      {
        _id: false,
        item: String,
        description: String,
        qty: Number,
        unitAmount: Number,
        amount: Number,
      },
    ],
    subtotal: Number,
    gst: Number,
    total: Number,
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['ISSUED', 'PAID', 'VOID'], default: 'ISSUED' },
    issuedAt: { type: Date, default: Date.now },
    dueAt: Date,
    paidAt: Date,
    payment: { provider: String, reference: String, amount: Number, recordedBy: String },
    /** What happens when this invoice is paid (e.g. modules switched on). */
    onPaid: { addModules: [String], convert: Schema.Types.Mixed },
    billTo: { legalName: String, gstin: String, city: String },
  },
  { timestamps: true },
);
invoiceSchema.index({ status: 1, dueAt: 1 });
export const PlatformInvoice = model('PlatformInvoice', invoiceSchema);

/** Platform-wide counters (platform invoices), separate from hospital counters. */
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
export const PlatformCounter = model('PlatformCounter', counterSchema);

/** Payment gateway webhooks, stored once by event id (spec 3.16 reference code). */
const webhookSchema = new Schema(
  {
    provider: String,
    eventId: String,
    type: String,
    payload: Schema.Types.Mixed,
    processedAt: Date,
    error: String,
    /** A delivery being processed holds the event; a failed one releases it for the retry. */
    lockedUntil: Date,
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);
webhookSchema.index({ provider: 1, eventId: 1 }, { unique: true });
export const WebhookEvent = model('WebhookEvent', webhookSchema);

/** Platform staff (spec 3.2); two-factor sign-in is mandatory. */
const platformUserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, unique: true },
    passwordHash: { type: String, select: false },
    roles: {
      type: [String],
      enum: ['PLATFORM_SUPER_ADMIN', 'SALES', 'FINANCE', 'SUPPORT'],
      default: ['SUPPORT'],
    },
    twoFactor: {
      secret: { type: String, select: false },
      enabled: { type: Boolean, default: false },
    },
    status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: Date,
  },
  { timestamps: true, versionKey: 'version' },
);
export const PlatformUser = model('PlatformUser', platformUserSchema);

/** Signups waiting for OTP or provisioning; also enforces one trial per mobile (spec 3.3). */
const signupSchema = new Schema(
  {
    mobile: { type: String, index: true },
    email: String,
    subdomain: String,
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    ip: String,
  },
  { timestamps: true },
);
export const SignupRecord = model('SignupRecord', signupSchema);

/**
 * The price book, edited in the console (one document, key "current"): plans with their modules,
 * price and limits, and the price of each module bought on its own. Each save bumps the version;
 * hospitals are charged from the version current at their next invoice.
 */
const priceBookSchema = new Schema(
  {
    key: { type: String, default: 'current', unique: true },
    bookVersion: { type: Number, default: 1 },
    currency: { type: String, default: 'INR' },
    gstRate: { type: Number, default: 18 },
    annualMonthsCharged: { type: Number, default: 10 },
    trialDays: { type: Number, default: 14 },
    trialPlan: { type: String, default: 'HOSPITAL' },
    plans: [
      {
        _id: false,
        code: { type: String, required: true },
        name: { type: String, required: true },
        description: String,
        monthly: Number, // paise; null = priced by quote (enterprise)
        modules: [String],
        limits: { users: Number, branches: Number, beds: Number, storageGb: Number },
        isActive: { type: Boolean, default: true }, // offered to new hospitals
        isPublic: { type: Boolean, default: true }, // shown on the pricing page
        sortOrder: { type: Number, default: 0 },
      },
    ],
    modules: { type: Map, of: Schema.Types.Mixed },
    updatedBy: String,
  },
  { timestamps: true, versionKey: 'version', optimisticConcurrency: true },
);
export const PriceBook = model('PriceBook', priceBookSchema);
