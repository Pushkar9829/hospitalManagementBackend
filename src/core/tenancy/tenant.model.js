import { Schema } from 'mongoose';
import { MODULE_CODES, TENANT_STATUS } from '@hms/shared';
import { defineModel } from '../db/model.js';

/** A hospital (or clinic group) on the platform. Lives outside tenant scoping. */
const moduleSub = new Schema(
  {
    code: { type: String, enum: MODULE_CODES, required: true },
    status: { type: String, enum: ['ACTIVE', 'TRIAL', 'CANCELLED'], default: 'ACTIVE' },
    validTill: Date,
  },
  { _id: false },
);

const schema = new Schema({
  name: { type: String, required: true, trim: true },
  subdomain: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/,
  },
  domains: { type: [String], default: [] },
  status: { type: String, enum: Object.keys(TENANT_STATUS), default: 'TRIAL' },
  plan: { type: String, default: 'trial' },
  trialEndsAt: Date,
  /** When the lifecycle state last changed (drives 7 / 15 / 90-day steps, spec 2.4). */
  statusChangedAt: { type: Date, default: Date.now },
  statusReason: String,
  billing: {
    contactName: String,
    email: String,
    mobile: String,
    gstin: String,
    legalName: String,
    city: String,
  },
  signup: { acceptedTermsVersion: String, ip: String, at: Date, beds: Number },
  modules: { type: [moduleSub], default: [] },
  limits: {
    users: { type: Number, default: 25 },
    branches: { type: Number, default: 1 },
    beds: { type: Number, default: 0 },
  },
  settings: {
    timezone: { type: String, default: 'Asia/Kolkata' },
    uhidPrefix: { type: String, default: 'CC', match: /^[A-Z]{1,4}$/ },
    idleTimeoutMin: { type: Number, min: 5, max: 120 },
    /** Role codes that must use two-factor sign-in (spec: privileged roles). */
    twoFactorRoles: {
      type: [String],
      default: ['superadmin', 'admin', 'billingmgr', 'accounts', 'payroll'],
    },
  },
});
schema.index({ subdomain: 1 }, { unique: true });
schema.index(
  { domains: 1 },
  { unique: true, partialFilterExpression: { 'domains.0': { $exists: true } } },
);

/** Codes of modules the hospital can use right now. CORE is always included. */
schema.methods.activeModules = function activeModules(now = new Date()) {
  const codes = this.modules
    .filter((m) => m.status !== 'CANCELLED' && (!m.validTill || m.validTill > now))
    .map((m) => m.code);
  return [...new Set(['CORE', ...codes])];
};

export const Tenant = defineModel('Tenant', schema, { tenant: false });
