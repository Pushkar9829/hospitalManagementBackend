from kit import *


def story():
    s = []
    s += H1("Reference Source Code")
    s.append(P("The code below is the reference implementation of the parts every module "
               "depends on: configuration, tenancy, authentication, subscription gating, "
               "permissions, maker-checker, numbering, and the transaction-heavy flows "
               "(bed allocation, pharmacy dispensing, billing, payroll). Developers build "
               "each module on these building blocks. The codebase is JavaScript (ES modules); "
               "the listings keep type annotations to document shapes, and the running "
               "implementation lives in apps/api/src with the same file names ending in .js."))

    s += H2("Backend foundation")
    s += code("""
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_PRIVATE_KEY: z.string().min(100),          // RS256 PEM, from Secrets Manager
  JWT_PUBLIC_KEY: z.string().min(100),
  AWS_REGION: z.string().default('ap-south-1'),
  S3_DOCS_BUCKET: z.string(),
  ROOT_DOMAIN: z.string().default('example.com'),
  SMS_PROVIDER: z.enum(['msg91', 'twilio', 'console']).default('console'),
});

export const env = Env.parse(process.env);   // crash on boot if config is wrong
""", "apps/api/src/config/env.ts")

    s += code("""
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClientSession } from 'mongoose';

export interface RequestContext {
  tenantId: string;
  branchId?: string;
  userId?: string;
  permissions: Set<string>;
  modules: Set<string>;
  requestId: string;
  session?: ClientSession;            // set inside withTransaction()
}

export const ctx = new AsyncLocalStorage<RequestContext>();

export function current(): RequestContext {
  const c = ctx.getStore();
  if (!c) throw new Error('No request context. Call inside a request or runAs().');
  return c;
}
""", "apps/api/src/core/tenancy/context.ts")

    s += code("""
import { Schema } from 'mongoose';
import { current } from './context';

/** Adds tenantId to every document and forces it into every query. */
export function tenantPlugin(schema: Schema) {
  schema.add({ tenantId: { type: Schema.Types.ObjectId, required: true, index: true } });

  const scoped = ['find', 'findOne', 'countDocuments', 'findOneAndUpdate',
    'updateOne', 'updateMany', 'deleteOne', 'deleteMany'] as const;

  for (const op of scoped) {
    schema.pre(op, function () {
      const { tenantId } = current();
      const filter = this.getFilter();
      if (filter.tenantId && String(filter.tenantId) !== tenantId) {
        throw new Error('Cross-tenant query blocked');
      }
      this.where({ tenantId });
    });
  }
  schema.pre('aggregate', function () {
    this.pipeline().unshift({ $match: { tenantId: toObjectId(current().tenantId) } });
  });
  schema.pre('validate', function () {
    if (!this.get('tenantId')) this.set('tenantId', current().tenantId);
  });
}
""", "apps/api/src/core/tenancy/tenant.plugin.ts")

    s += code("""
import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { ctx } from './context';
import { tenantRegistry } from './tenant.registry';   // Redis-cached lookup, 60 s TTL
import { AppError } from '../errors';

const READ_ONLY_OK = new Set(['GET', 'HEAD', 'OPTIONS']);

export const tenantResolver: RequestHandler = async (req, _res, next) => {
  const host = req.hostname.toLowerCase();
  const tenant = await tenantRegistry.byHost(host);
  if (!tenant) return next(new AppError(404, 'TENANT_NOT_FOUND', 'Unknown hospital'));

  if (tenant.status === 'SUSPENDED' && !req.path.startsWith('/api/v1/subscription')) {
    return next(new AppError(402, 'TENANT_SUSPENDED', 'Subscription suspended'));
  }
  if (tenant.status === 'READ_ONLY' && !READ_ONLY_OK.has(req.method)) {
    return next(new AppError(402, 'TENANT_READ_ONLY', 'Subscription is read-only'));
  }

  const modules = new Set(tenant.modules
    .filter((m) => m.status === 'ACTIVE' && (!m.validTill || m.validTill > new Date()))
    .map((m) => m.code));

  ctx.run({ tenantId: String(tenant._id), modules, permissions: new Set(),
    requestId: String(req.headers['x-request-id'] ?? randomUUID()) }, () => next());
};
""", "apps/api/src/core/tenancy/tenantResolver.ts")

    s += code("""
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { current } from '../tenancy/context';
import { AppError } from '../errors';
import { permissionCache } from '../rbac/permission.cache';
import { tokenBlacklist } from './token.blacklist';

interface AccessClaims { sub: string; tid: string; bid?: string; jti: string; }

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.access_token
    ?? req.headers.authorization?.replace(/^Bearer /, '');
  if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Login required'));
  try {
    const claims = jwt.verify(token, env.JWT_PUBLIC_KEY,
      { algorithms: ['RS256'] }) as AccessClaims;
    const c = current();
    if (claims.tid !== c.tenantId) throw new Error('tenant mismatch');
    if (await tokenBlacklist.has(claims.jti)) throw new Error('revoked');
    c.userId = claims.sub;
    c.branchId = String(req.headers['x-branch-id'] ?? claims.bid ?? '');
    c.permissions = await permissionCache.forUser(c.tenantId, claims.sub);
    next();
  } catch {
    next(new AppError(401, 'TOKEN_INVALID', 'Session expired, please log in again'));
  }
};
""", "apps/api/src/core/auth/authenticate.ts")

    s += code("""
import type { RequestHandler } from 'express';
import { current } from '../tenancy/context';
import { AppError } from '../errors';

export type ModuleCode = 'CORE' | 'OPD' | 'IPD' | 'NUR' | 'LAB' | 'RAD' | 'PHR'
  | 'INV' | 'HRM' | 'PAY' | 'FIN' | 'MRD' | 'DIET' | 'FAC' | 'QLT' | 'CRM';

/** 402 if the hospital has not subscribed to the module. */
export const requireModule = (code: ModuleCode): RequestHandler => (_req, _res, next) =>
  current().modules.has(code)
    ? next()
    : next(new AppError(402, 'MODULE_NOT_SUBSCRIBED',
        `The ${code} module is not part of your subscription`));

/** 403 unless the user has the permission, e.g. 'billing:invoice:create'. */
export const authorize = (permission: string): RequestHandler => (_req, _res, next) => {
  const { permissions } = current();
  const [mod, res] = permission.split(':');
  const ok = permissions.has(permission)
    || permissions.has(`${mod}:${res}:*`) || permissions.has(`${mod}:*`);
  return ok ? next() : next(new AppError(403, 'FORBIDDEN', `Missing ${permission}`));
};
""", "apps/api/src/core/rbac/guards.ts")

    s += code("""
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { rateLimiter } from './core/security/rateLimiter';
import { tenantResolver } from './core/tenancy/tenantResolver';
import { authenticate } from './core/auth/authenticate';
import { errorHandler } from './core/errors';
import { authRoutes } from './core/auth/auth.routes';
import { mountModules } from './modules';
import { openApiRouter } from './core/openapi';

export function createApp() {
  const app = express();
  app.set('trust proxy', 2);                       // CloudFront + ALB
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.headers.cookie'] }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api', rateLimiter, tenantResolver);
  app.use('/api/v1/auth', authRoutes);             // login, refresh, logout, 2FA
  app.use('/api/docs', openApiRouter);
  app.use('/api/v1', authenticate);
  mountModules(app);                               // each module mounts its own router
  app.use(errorHandler);                           // { error: { code, message, details } }
  return app;
}
""", "apps/api/src/app.ts")

    s += code("""
import { Router } from 'express';
import { requireModule, authorize } from '../../core/rbac/guards';
import { validate } from '../../core/http/validate';
import * as c from './billing.controller';
import * as s from './billing.schemas';

export const billingRoutes = Router();
billingRoutes.use(requireModule('CORE'));

billingRoutes.get('/bills', authorize('billing:bill:read'),
  validate({ query: s.ListBillsQuery }), c.listBills);
billingRoutes.post('/bills', authorize('billing:bill:create'),
  validate({ body: s.CreateBillBody }), c.createBill);
billingRoutes.post('/bills/:id/payments', authorize('billing:payment:create'),
  validate({ params: s.IdParam, body: s.PaymentBody }), c.addPayment);
billingRoutes.post('/bills/:id/discount', authorize('billing:discount:request'),
  validate({ params: s.IdParam, body: s.DiscountBody }), c.requestDiscount);
billingRoutes.post('/bills/:id/cancel', authorize('billing:bill:cancel'),
  validate({ params: s.IdParam, body: s.ReasonBody }), c.requestCancel);
billingRoutes.get('/bills/:id/pdf', authorize('billing:bill:print'), c.billPdf);
""", "apps/api/src/modules/billing/billing.routes.ts")

    s += H2("Numbering, transactions and approvals")
    s += code("""
import mongoose from 'mongoose';
import { current } from '../tenancy/context';

const Counter = mongoose.model('Counter',
  new mongoose.Schema({ _id: String, seq: Number }), 'counters');

/** Atomic, gap-free per series. e.g. next('BILL_OP', 'OP/{FY}/{SEQ:6}') -> OP/26-27/000154 */
export async function nextNumber(series: string, pattern: string, at = new Date()) {
  const { tenantId, branchId, session } = current();
  const fy = financialYear(at);                       // '26-27'
  const key = `${tenantId}:${branchId}:${series}:${fy}`;
  const doc = await Counter.findOneAndUpdate(
    { _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true, session },
  );
  return pattern
    .replace('{FY}', fy)
    .replace(/\\{SEQ:(\\d+)\\}/, (_, w) => String(doc!.seq).padStart(Number(w), '0'));
}

function financialYear(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;  // April start
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}
""", "apps/api/src/core/sequences/sequence.service.ts")

    s += code("""
import mongoose from 'mongoose';
import { ctx, current } from '../tenancy/context';
import { outbox } from '../events/outbox';

/** Runs fn in a MongoDB transaction; events are published only after commit. */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await ctx.run({ ...current(), session }, fn);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    await outbox.flush(session.id);                 // publish queued domain events
    return result;
  } finally {
    await session.endSession();
  }
}
""", "apps/api/src/core/db/withTransaction.ts")

    s += code("""
import { ApprovalRule, ApprovalRequest } from './approval.models';
import { current } from '../tenancy/context';
import { AppError } from '../errors';
import { events } from '../events/bus';

/** Returns null if no approval needed, otherwise creates a pending request. */
export async function requireApproval(input: {
  action: string;               // e.g. 'billing.discount'
  entity: string; entityId: string;
  amount?: number; percent?: number;
  before: unknown; after: unknown; reason: string;
}) {
  const rule = await ApprovalRule.findOne({ action: input.action, active: true });
  if (!rule) return null;
  const levels = rule.levels.filter((l) =>
    (l.minAmount == null || (input.amount ?? 0) > l.minAmount) &&
    (l.minPercent == null || (input.percent ?? 0) > l.minPercent));
  if (levels.length === 0) return null;

  const req = await ApprovalRequest.create({
    ...input, maker: current().userId, status: 'PENDING', levelIndex: 0,
    levels: levels.map((l) => ({ role: l.role })),
    expiresAt: new Date(Date.now() + rule.expiryHours * 3600_000),
  });
  await events.publish('approval.requested', { id: req.id, role: levels[0].role });
  return req;
}

export async function decide(id: string, decision: 'APPROVE' | 'REJECT', comment?: string) {
  const { userId, permissions } = current();
  const req = await ApprovalRequest.findById(id);
  if (!req || req.status !== 'PENDING') throw new AppError(409, 'NOT_PENDING', 'Not pending');
  if (req.expiresAt < new Date()) throw new AppError(409, 'EXPIRED', 'Request expired');
  if (String(req.maker) === userId) {
    throw new AppError(403, 'MAKER_CANNOT_CHECK', 'You cannot approve your own request');
  }
  const level = req.levels[req.levelIndex];
  if (!permissions.has(`approvals:${level.role}:decide`)) {
    throw new AppError(403, 'FORBIDDEN', 'Not an approver for this level');
  }
  if (decision === 'REJECT' && !comment) {
    throw new AppError(422, 'REASON_REQUIRED', 'Reason required');
  }

  level.decidedBy = userId; level.decision = decision; level.at = new Date();
  level.comment = comment;
  if (decision === 'REJECT') req.status = 'REJECTED';
  else if (req.levelIndex + 1 < req.levels.length) req.levelIndex += 1;
  else req.status = 'APPROVED';
  await req.save();
  // The owning module listens and applies the change (or notifies the maker).
  await events.publish('approval.decided', { id: req.id, action: req.action,
    status: req.status, entityId: req.entityId });
  return req;
}
""", "apps/api/src/core/approvals/approval.service.ts")

    s += H2("Patient, bed and pharmacy services")
    s += code("""
import { Schema, model } from 'mongoose';
import { tenantPlugin } from '../../../core/tenancy/tenant.plugin';
import { auditPlugin } from '../../../core/audit/audit.plugin';

const PatientSchema = new Schema({
  uhid: { type: String, required: true },
  name: {
    title: String, first: { type: String, required: true }, middle: String, last: String,
    searchKey: { type: String, index: true },        // lower-case 'first last' for prefix search
  },
  gender: { type: String, enum: ['M', 'F', 'O'], required: true },
  dob: { type: Date, required: true },
  dobEstimated: { type: Boolean, default: false },
  mobile: { type: String, required: true },
  email: String,
  address: { line1: String, city: String, state: String, pin: String },
  ids: [{ type: { type: String }, number: String, fileId: Schema.Types.ObjectId }],
  bloodGroup: String,
  allergies: [{ substance: String, reaction: String, severity: String }],
  flags: { vip: Boolean, mlc: Boolean },
  category: { type: String, default: 'GENERAL' },
  priceListId: Schema.Types.ObjectId,
  emergencyContact: { name: String, relation: String, mobile: String },
  photoFileId: Schema.Types.ObjectId,
  mergedInto: Schema.Types.ObjectId,
}, { timestamps: true, optimisticConcurrency: true });

PatientSchema.plugin(tenantPlugin);
PatientSchema.plugin(auditPlugin, { entity: 'patient' });
PatientSchema.index({ tenantId: 1, uhid: 1 }, { unique: true });
PatientSchema.index({ tenantId: 1, mobile: 1 });
PatientSchema.pre('save', function () {
  this.name.searchKey = `${this.name.first} ${this.name.last ?? ''}`.trim().toLowerCase();
});

export const Patient = model('Patient', PatientSchema);
""", "apps/api/src/modules/patients/models/patient.model.ts")

    s += code("""
export async function registerPatient(input: RegisterPatientInput) {
  const dupes = await findLikelyDuplicates(input);         // mobile + name, or ID number
  if (dupes.length && !input.confirmNotDuplicate) {
    throw new AppError(409, 'POSSIBLE_DUPLICATE', 'Similar patients found', { dupes });
  }
  return withTransaction(async () => {
    const uhid = await nextNumber('UHID', 'CC{SEQ:7}');
    const [patient] = await Patient.create([{ ...input, uhid }], { session: current().session });
    outbox.add('patient.registered', { patientId: patient.id, uhid });
    return patient;
  });
}
""", "apps/api/src/modules/patients/patient.service.ts (excerpt)")

    s += code("""
/** Allocates a bed atomically: only succeeds if the bed is still AVAILABLE or RESERVED for us. */
export async function allocateBed(bedId: string, admissionId: string, reservationId?: string) {
  const bed = await Bed.findOneAndUpdate(
    {
      _id: bedId,
      $or: [{ status: 'AVAILABLE' },
            { status: 'RESERVED', reservationId: reservationId ?? '__none__' }],
    },
    { $set: { status: 'OCCUPIED', currentAdmissionId: admissionId,
              statusChangedAt: new Date(), reservationId: null } },
    { new: true, session: current().session },
  );
  if (!bed) throw new AppError(409, 'BED_NOT_AVAILABLE', 'Bed was just taken, pick another');
  outbox.add('bed.statusChanged', { bedId, wardId: bed.wardId, status: bed.status });
  return bed;
}

// Worker: pushes bed changes to every open bed board of the tenant in < 1 s
events.on('bed.statusChanged', async (e, meta) => {
  io.to(`tenant:${meta.tenantId}:beds`).emit('bed:update', e);
});
""", "apps/api/src/modules/ipd/bed.service.ts (excerpt)")

    s += code("""
/** Dispenses items using First-Expiry-First-Out across batches, in one transaction. */
export async function dispense(storeId: string, lines: { itemId: string; qty: number }[],
                               ref: { type: 'OPD_SALE' | 'IPD_ISSUE'; id: string }) {
  return withTransaction(async () => {
    const { session } = current();
    const picked: PickedBatch[] = [];
    for (const line of lines) {
      let remaining = line.qty;
      const batches = await StockBatch.find({
        storeId, itemId: line.itemId, qty: { $gt: 0 }, expiry: { $gt: new Date() },
      }).sort({ expiry: 1 }).session(session!);

      for (const b of batches) {
        if (remaining === 0) break;
        const take = Math.min(b.qty, remaining);
        // conditional decrement protects against a concurrent sale of the same batch
        const res = await StockBatch.updateOne(
          { _id: b._id, qty: { $gte: take } }, { $inc: { qty: -take } }, { session });
        if (res.modifiedCount !== 1) throw new AppError(409, 'STOCK_CHANGED', 'Retry');
        await StockLedger.create([{ batchId: b._id, itemId: line.itemId, storeId,
          qty: -take, refType: ref.type, refId: ref.id }], { session });
        picked.push({ itemId: line.itemId, batchId: b.id, batchNo: b.batchNo,
          expiry: b.expiry, qty: take, mrp: b.mrp, cost: b.cost });
        remaining -= take;
      }
      if (remaining > 0) {
        throw new AppError(422, 'INSUFFICIENT_STOCK', 'Not enough stock',
          { itemId: line.itemId, short: remaining });
      }
    }
    outbox.add('pharmacy.issued', { ref, picked });
    return picked;
  });
}
""", "apps/api/src/modules/pharmacy/dispense.service.ts")

    s += H2("Billing and payroll services")
    s += code("""
export async function addPayment(billId: string, input: PaymentInput) {
  return withTransaction(async () => {
    const { session, userId } = current();
    const shift = await CashierShift.findOne({ userId, status: 'OPEN' }).session(session!);
    if (!shift) throw new AppError(409, 'NO_OPEN_SHIFT', 'Open your cashier shift first');

    const bill = await Bill.findById(billId).session(session!);
    if (!bill || !['FINAL', 'PARTLY_PAID'].includes(bill.status)) {
      throw new AppError(409, 'BILL_NOT_PAYABLE', 'Bill is not open for payment');
    }
    const due = bill.totals.net - bill.totals.paid;
    const amount = input.modes.reduce((sum, m) => sum + m.amount, 0);  // paise
    if (amount <= 0 || amount > due) throw new AppError(422, 'BAD_AMOUNT', `Due is ${due}`);

    const receiptNo = await nextNumber('RECEIPT', 'RC/{FY}/{SEQ:6}');
    const [payment] = await Payment.create([{ billId, receiptNo, modes: input.modes,
      amount, shiftId: shift.id }], { session });

    bill.totals.paid += amount;
    bill.status = bill.totals.paid === bill.totals.net ? 'PAID' : 'PARTLY_PAID';
    await bill.save({ session });
    await CashierShift.updateOne({ _id: shift.id },
      { $inc: Object.fromEntries(input.modes.map((m) => [`collected.${m.mode}`, m.amount])) },
      { session });

    outbox.add('billing.payment.received', { billId, paymentId: payment.id, amount });
    return { bill, payment };
  });
}
""", "apps/api/src/modules/billing/payment.service.ts")

    s += code("""
/** Pure function: one employee's salary for one month. Rates come from config tables. */
export function computePayslip(emp: EmployeeSalary, att: MonthAttendance,
                               inputs: VariableInputs, rules: StatutoryRules): PayslipLines {
  const ratio = att.payableDays / att.calendarDays;
  const earnings: Line[] = emp.components
    .filter((c) => c.kind === 'EARNING')
    .map((c) => ({ code: c.code, amount: round(evalFormula(c, emp) * (c.prorate ? ratio : 1)) }));

  earnings.push({ code: 'OT', amount: round(inputs.otHours * emp.otRatePerHour) });
  earnings.push({ code: 'NIGHT', amount: inputs.nightShifts * emp.nightAllowance });
  const gross = sum(earnings);

  const basicDa = amountOf(earnings, 'BASIC') + amountOf(earnings, 'DA');
  const pfWage = Math.min(basicDa, rules.pf.wageCeiling);
  const deductions: Line[] = [
    { code: 'PF', amount: emp.pfApplicable ? round(pfWage * rules.pf.employeeRate) : 0 },
    { code: 'ESI', amount: gross <= rules.esi.wageLimit
        ? Math.ceil(gross * rules.esi.employeeRate) : 0 },
    { code: 'PT', amount: professionalTax(gross, emp.state, att.month, rules.pt) },
    { code: 'TDS', amount: monthlyTds(emp, gross, rules.tds) },
    { code: 'LOAN', amount: inputs.loanEmi },
    ...inputs.otherDeductions,
  ];
  const employer = {
    pf: emp.pfApplicable ? round(pfWage * rules.pf.employerRate) : 0,
    esi: gross <= rules.esi.wageLimit ? Math.ceil(gross * rules.esi.employerRate) : 0,
  };
  return { earnings, deductions, gross, net: gross - sum(deductions), employer };
}
""", "apps/api/src/modules/payroll/compute.ts")

    s += code("""
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: env.AWS_REGION });   // IAM task role, no keys in code

export async function uploadUrl(kind: FileKind, mime: string, size: number) {
  if (!ALLOWED_MIME[kind].includes(mime) || size > MAX_BYTES[kind]) {
    throw new AppError(422, 'FILE_REJECTED', 'File type or size not allowed');
  }
  const { tenantId } = current();
  const file = await FileRecord.create({ kind, mime, size, status: 'PENDING' });
  const key = `tenants/${tenantId}/${kind}/${file.id}`;
  file.key = key; await file.save();
  const url = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: env.S3_DOCS_BUCKET, Key: key, ContentType: mime,
    ServerSideEncryption: 'aws:kms',
  }), { expiresIn: 300 });
  return { fileId: file.id, url };                   // browser PUTs the file directly
}

export async function downloadUrl(fileId: string) {
  const file = await FileRecord.findById(fileId);     // tenant plugin scopes this
  if (!file) throw new AppError(404, 'NOT_FOUND', 'File not found');
  await audit('file.download', file.id);
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_DOCS_BUCKET, Key: file.key }),
    { expiresIn: 300 });
}
""", "apps/api/src/core/files/s3.service.ts")

    s += H2("Frontend foundation")
    s += code("""
import { createApi, fetchBaseQuery, type BaseQueryFn } from '@reduxjs/toolkit/query/react';
import { Mutex } from 'async-mutex';

const mutex = new Mutex();
const raw = fetchBaseQuery({
  baseUrl: '/api/v1',                                   // same origin through CloudFront
  credentials: 'include',                               // httpOnly cookies
  prepareHeaders: (h, { getState }) => {
    const branch = (getState() as RootState).session.branchId;
    if (branch) h.set('x-branch-id', branch);
    return h;
  },
});

/** Refreshes the access token once on 401 and retries; logs out if refresh fails. */
const baseQuery: BaseQueryFn = async (args, api, extra) => {
  await mutex.waitForUnlock();
  let res = await raw(args, api, extra);
  if (res.error?.status === 401) {
    if (!mutex.isLocked()) {
      const release = await mutex.acquire();
      try {
        const r = await raw({ url: '/auth/refresh', method: 'POST' }, api, extra);
        if (r.error) api.dispatch(sessionExpired());
      } finally { release(); }
    } else {
      await mutex.waitForUnlock();
    }
    res = await raw(args, api, extra);
  }
  if (res.error?.status === 402) api.dispatch(showUpgradeDialog(res.error.data));
  return res;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['Patient', 'Appointment', 'Bed', 'Bill', 'Approval', 'Stock', 'Payroll'],
  endpoints: () => ({}),                                // each module injects endpoints
});
""", "apps/web/src/app/api.ts")

    s += code("""
export const patientsApi = api.injectEndpoints({
  endpoints: (b) => ({
    searchPatients: b.query<Page<PatientSummary>, { q: string; page?: number }>({
      query: (params) => ({ url: '/patients', params }),
      providesTags: ['Patient'],
    }),
    registerPatient: b.mutation<Patient, RegisterPatientInput>({
      query: (body) => ({ url: '/patients', method: 'POST', body }),
      invalidatesTags: ['Patient'],
    }),
  }),
});
export const { useSearchPatientsQuery, useRegisterPatientMutation } = patientsApi;
""", "apps/web/src/modules/patients/patients.api.ts")

    s += code("""
import { useSession } from '@/app/session';

/** Renders children only if the module is subscribed and the user holds the permission. */
export function Can({ module, perm, children, fallback = null }: CanProps) {
  const { modules, permissions } = useSession();
  if (module && !modules.includes(module)) return fallback;
  if (perm && !hasPermission(permissions, perm)) return fallback;
  return <>{children}</>;
}

// Menu is data; items disappear when the module or permission is missing.
export const MENU: MenuItem[] = [
  { label: 'Patients', icon: PeopleIcon, path: '/patients', module: 'CORE',
    perm: 'patients:patient:read' },
  { label: 'Appointments', icon: EventIcon, path: '/opd/appointments', module: 'OPD',
    perm: 'opd:appointment:read' },
  { label: 'Bed Board', icon: BedIcon, path: '/ipd/beds', module: 'IPD', perm: 'ipd:bed:read' },
  { label: 'Pharmacy', icon: PharmacyIcon, path: '/pharmacy', module: 'PHR',
    perm: 'pharmacy:sale:read' },
  { label: 'Payroll', icon: PaymentsIcon, path: '/payroll', module: 'PAY',
    perm: 'payroll:run:read' },
  // ...
];

// Route-level guard (React Router 6 data routes)
{ path: '/pharmacy/*', element: <ModuleRoute module="PHR"><PharmacyRoutes /></ModuleRoute> }
""", "apps/web/src/app/access.tsx")

    s += code("""
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { api } from '@/app/api';

/** Keeps the RTK Query bed cache in sync with server pushes. */
export function useLiveBeds(wardId?: string) {
  const dispatch = useAppDispatch();
  const query = useGetBedsQuery({ wardId });
  useEffect(() => {
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.emit('subscribe', { channel: 'beds' });
    socket.on('bed:update', (e: BedUpdate) => {
      dispatch(bedsApi.util.updateQueryData('getBeds', { wardId }, (draft) => {
        const bed = draft.items.find((b) => b.id === e.bedId);
        if (bed) Object.assign(bed, e);
      }));
    });
    socket.on('connect', () => query.refetch());       // resync after reconnect
    return () => { socket.disconnect(); };
  }, [wardId]);
  return query;
}
""", "apps/web/src/modules/ipd/useLiveBeds.ts")
    return s
