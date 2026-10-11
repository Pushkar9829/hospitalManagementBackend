import { z } from 'zod';
import { MODULE_CODES, MODULES, PRICE_BOOK, unmetDependencies } from '@hms/shared';
import { AppError, errors } from '../../core/errors/index.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { PriceBook, Subscription } from '../models/platform.models.js';

/**
 * The live price book. Plans (which modules, price, limits) and module prices are edited in the
 * console and stored in the database; the defaults in @hms/shared seed it the first time. Reads
 * are synchronous (`book()`) from a cache that every entry point refreshes with `refreshBook()`
 * (at most every 10 seconds per process, and at once after an edit in this process).
 */
const TTL_MS = 10_000;
let cache = toBook(null);
let loadedAt = 0;

function toBook(doc) {
  if (!doc) {
    return {
      ...PRICE_BOOK,
      trialPlan: 'HOSPITAL',
      plans: Object.fromEntries(
        Object.entries(PRICE_BOOK.plans).map(([code, p], i) => [
          code,
          { code, ...p, isActive: true, isPublic: true, sortOrder: i },
        ]),
      ),
    };
  }
  return {
    version: doc.bookVersion,
    currency: doc.currency,
    gstRate: doc.gstRate,
    annualMonthsCharged: doc.annualMonthsCharged,
    trialDays: doc.trialDays,
    trialPlan: doc.trialPlan,
    plans: Object.fromEntries(
      [...doc.plans]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => [
          p.code,
          {
            code: p.code,
            name: p.name,
            description: p.description ?? null,
            monthly: p.monthly ?? null,
            modules: [...new Set(['CORE', ...(p.modules ?? [])])],
            limits: { ...p.limits },
            isActive: p.isActive !== false,
            isPublic: p.isPublic !== false,
            sortOrder: p.sortOrder ?? 0,
          },
        ]),
    ),
    modules: Object.fromEntries(
      doc.modules instanceof Map ? doc.modules : Object.entries(doc.modules ?? {}),
    ),
  };
}

async function loadDoc() {
  let doc = await PriceBook.findOne({ key: 'current' });
  if (doc) return doc;
  const seed = toBook(null);
  try {
    [doc] = await PriceBook.create([
      {
        key: 'current',
        bookVersion: PRICE_BOOK.version,
        currency: seed.currency,
        gstRate: seed.gstRate,
        annualMonthsCharged: seed.annualMonthsCharged,
        trialDays: seed.trialDays,
        trialPlan: 'HOSPITAL',
        plans: Object.values(seed.plans),
        modules: seed.modules,
      },
    ]);
  } catch (e) {
    if (e?.code !== 11000) throw e;
    doc = await PriceBook.findOne({ key: 'current' });
  }
  return doc;
}

/** Reloads the book from the database when the cache is older than the TTL (or when forced). */
export async function refreshBook({ force = false } = {}) {
  if (!force && Date.now() - loadedAt < TTL_MS) return cache;
  cache = toBook((await loadDoc()).toObject());
  loadedAt = Date.now();
  return cache;
}

/** The current book (call `refreshBook()` first in the entry point). */
export const book = () => cache;

/** A plan that exists; `forNew` also requires it to be on sale. */
export function planOf(code, { forNew = false } = {}) {
  const p = cache.plans[code];
  if (!p) throw errors.validation([{ path: 'plan', message: 'Unknown plan' }]);
  if (forNew && !p.isActive)
    throw errors.validation([{ path: 'plan', message: `${p.name} is no longer offered` }]);
  return p;
}

/** The public price book for the pricing page and signup (only plans on sale and public). */
export async function publicBook() {
  const b = await refreshBook();
  return {
    ...b,
    plans: Object.fromEntries(Object.entries(b.plans).filter(([, p]) => p.isActive && p.isPublic)),
  };
}

// ---------------------------------------------------------------- console edits

const limits = z.object({
  users: z.number().int().min(1).max(1_000_000),
  branches: z.number().int().min(1).max(10_000),
  beds: z.number().int().min(0).max(1_000_000),
  storageGb: z.number().int().min(1).max(100_000),
});
export const planInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Use 2 to 20 capital letters, digits or _'),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  monthly: z.number().int().min(0).max(10_00_00_000_00).nullable(),
  modules: z.array(z.enum(MODULE_CODES)).min(1).max(40),
  limits,
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export const planUpdate = planInput
  .omit({ code: true })
  .partial()
  .extend({
    applyToExisting: z.boolean().default(false),
    version: z.number().int().min(0),
  });
export const moduleInput = z.object({
  monthly: z.number().int().min(0).max(1_00_00_000_00),
  unit: z.enum(['FLAT', 'BRANCH', 'BED', 'ENTITY', 'EMPLOYEE', 'PAYSLIP']).optional(),
  minimum: z.number().int().min(0).max(10_000).optional(),
  version: z.number().int().min(0),
});
export const settingsInput = z.object({
  gstRate: z.number().min(0).max(28).optional(),
  annualMonthsCharged: z.number().int().min(6).max(12).optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  trialPlan: z.string().trim().toUpperCase().optional(),
  version: z.number().int().min(0),
});

function checkModules(modules) {
  const all = [...new Set(['CORE', ...modules])];
  const missing = unmetDependencies(all);
  if (missing.length)
    throw new AppError(
      422,
      'DEPENDENCY_MISSING',
      'Some modules need others in the same plan',
      missing.map((m) => ({
        path: 'modules',
        message: `${MODULES[m.module].name} needs ${MODULES[m.needs].name}`,
      })),
    );
  return all;
}

async function editable(version) {
  const doc = await loadDoc();
  if (version !== undefined && doc.version !== version) throw errors.versionConflict();
  return doc;
}

async function saved(doc, by) {
  doc.bookVersion += 1;
  doc.updatedBy = by;
  await doc.save();
  return refreshBook({ force: true });
}

/** Console view: every plan (with how many hospitals are on it) and every module price. */
export async function consoleBook() {
  const b = await refreshBook({ force: true });
  const doc = await loadDoc();
  const counts = await Subscription.aggregate([{ $group: { _id: '$plan', n: { $sum: 1 } } }]);
  const on = new Map(counts.map((c) => [c._id, c.n]));
  return {
    ...b,
    plans: Object.values(b.plans).map((p) => ({ ...p, hospitals: on.get(p.code) ?? 0 })),
    modules: MODULE_CODES.map((code) => ({
      code,
      name: MODULES[code]?.name ?? code,
      ...b.modules[code],
    })),
    docVersion: doc.version,
    updatedBy: doc.updatedBy ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

export async function createPlan(input, by) {
  const doc = await editable();
  if (doc.plans.some((p) => p.code === input.code))
    throw errors.conflict('PLAN_EXISTS', 'A plan with this code exists');
  doc.plans.push({ ...input, modules: checkModules(input.modules) });
  await saved(doc, by);
  return consoleBook();
}

/**
 * Edits a plan. New prices apply from each hospital's next invoice. `applyToExisting` also moves
 * hospitals already on the plan to its new modules and limits now (a module taken away is turned
 * off for them; their data stays).
 */
export async function updatePlan(code, { applyToExisting, version, ...input }, by) {
  const doc = await editable(version);
  const p = doc.plans.find((x) => x.code === code);
  if (!p) throw errors.notFound('Plan');
  if (input.modules) input.modules = checkModules(input.modules);
  if (input.isActive === false && doc.trialPlan === code)
    throw errors.validation([
      { path: 'isActive', message: 'This plan is the trial plan; pick another trial plan first' },
    ]);
  Object.assign(p, input);
  await saved(doc, by);
  let moved = 0;
  if (applyToExisting) moved = await resyncPlan(code);
  return { ...(await consoleBook()), moved };
}

export async function updateModulePrice(code, { version, ...input }, by) {
  if (!MODULE_CODES.includes(code)) throw errors.notFound('Module');
  const doc = await editable(version);
  const current = doc.modules.get(code) ?? {};
  doc.modules.set(code, { ...current, ...input });
  doc.markModified('modules');
  await saved(doc, by);
  return consoleBook();
}

export async function updateSettings({ version, ...input }, by) {
  const doc = await editable(version);
  if (input.trialPlan && !doc.plans.some((p) => p.code === input.trialPlan && p.isActive))
    throw errors.validation([{ path: 'trialPlan', message: 'Pick a plan on sale' }]);
  doc.set(input);
  await saved(doc, by);
  return consoleBook();
}

/** Sets every hospital on the plan to its modules (plus their add-ons) and limits. */
async function resyncPlan(code) {
  const { tenantModulesFor, applyPlanToTenant } = await import('./subscription.service.js');
  const subs = await Subscription.find({ plan: code });
  let n = 0;
  for (const sub of subs) {
    const tenant = await Tenant.findById(sub.tenantId).select('status').lean();
    if (!tenant || tenant.status === 'CLOSED') continue;
    await applyPlanToTenant(sub.tenantId, tenantModulesFor(sub), sub);
    n += 1;
  }
  return n;
}
