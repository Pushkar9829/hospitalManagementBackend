import { MODULES, MODULE_CODES, missingDependencies } from './modules.js';

/**
 * Platform price book v1 (spec 2.2 "Plans and indicative pricing"). Amounts are monthly, in
 * paise, before GST; the business finalises them in the console, which saves a new version.
 * Existing subscriptions keep their version until renewal (spec 3.5).
 *
 * Units: FLAT (once), BRANCH, BED (licensed beds), USER (extra users above the included ones),
 * ENTITY (legal entities), EMPLOYEE and PAYSLIP (metered, billed in arrears).
 */
export const PRICE_BOOK = Object.freeze({
  version: 1,
  currency: 'INR',
  gstRate: 18,
  annualMonthsCharged: 10, // annual billing: two months free
  trialDays: 14,
  plans: {
    CLINIC: {
      name: 'Clinic',
      monthly: 6_000_00,
      modules: ['CORE', 'OPD', 'PHR', 'LAB'],
      limits: { users: 15, branches: 1, beds: 20, storageGb: 25 },
    },
    HOSPITAL: {
      name: 'Hospital',
      monthly: 35_000_00,
      modules: MODULE_CODES,
      limits: { users: 100, branches: 3, beds: 150, storageGb: 250 },
    },
    ENTERPRISE: {
      name: 'Enterprise',
      monthly: null,
      modules: MODULE_CODES,
      limits: { users: 100000, branches: 1000, beds: 100000, storageGb: 1024 },
    },
  },
  modules: {
    CORE: { unit: 'FLAT', monthly: 3_000_00, includedUsers: 10, extraUser: 150_00 },
    OPD: { unit: 'BRANCH', monthly: 2_000_00 },
    IPD: { unit: 'BED', monthly: 40_00, minimum: 10 },
    NUR: { unit: 'BED', monthly: 20_00 },
    LAB: { unit: 'BRANCH', monthly: 2_500_00 },
    RAD: { unit: 'BRANCH', monthly: 2_500_00 },
    PHR: { unit: 'BRANCH', monthly: 2_500_00 },
    INV: { unit: 'BRANCH', monthly: 2_500_00 },
    HRM: { unit: 'EMPLOYEE', monthly: 30_00, metered: true },
    PAY: { unit: 'PAYSLIP', monthly: 25_00, metered: true },
    FIN: { unit: 'ENTITY', monthly: 3_000_00 },
    MRD: { unit: 'BRANCH', monthly: 1_500_00 },
    DIET: { unit: 'BRANCH', monthly: 1_500_00 },
    QLT: { unit: 'BRANCH', monthly: 1_500_00 },
    FAC: { unit: 'BRANCH', monthly: 2_000_00 },
    CRM: { unit: 'BRANCH', monthly: 2_000_00 },
  },
});

const UNIT_QTY = {
  FLAT: () => 1,
  BRANCH: (q) => q.branches,
  BED: (q) => q.beds,
  ENTITY: (q) => q.entities,
};

/**
 * Advance (fixed) charges for one billing period: the plan, plus modules bought on top of it
 * a-la-carte, plus extra users on a-la-carte CORE. Metered modules are billed in arrears.
 * quantities: { branches, beds, entities, users }.
 */
export function quote({ plan, addOns = [], cycle = 'MONTHLY', quantities }, book = PRICE_BOOK) {
  const months = cycle === 'ANNUAL' ? book.annualMonthsCharged : 1;
  const lines = [];
  const planDef = plan ? book.plans[plan] : null;
  if (plan && !planDef) throw new Error(`Unknown plan ${plan}`);
  if (planDef) {
    if (planDef.monthly == null) throw new Error('This plan is priced by quote');
    lines.push({
      item: `PLAN:${plan}`,
      description: `${planDef.name} plan`,
      qty: 1,
      unitAmount: planDef.monthly * months,
      amount: planDef.monthly * months,
    });
  }
  const included = new Set(planDef?.modules ?? []);
  for (const code of addOns) {
    if (included.has(code)) continue;
    const m = book.modules[code];
    if (!m) throw new Error(`Unknown module ${code}`);
    if (m.metered) continue;
    const qty = Math.max(UNIT_QTY[m.unit](quantities) ?? 1, m.minimum ?? 0);
    lines.push({
      item: `MODULE:${code}`,
      description: `${MODULES[code].name} (${m.unit.toLowerCase()} x ${qty})`,
      qty,
      unitAmount: m.monthly * months,
      amount: m.monthly * months * qty,
    });
    if (code === 'CORE' && quantities.users > m.includedUsers) {
      const extra = quantities.users - m.includedUsers;
      lines.push({
        item: 'ADDON:USERS',
        description: `Extra users x ${extra}`,
        qty: extra,
        unitAmount: m.extraUser * months,
        amount: m.extraUser * months * extra,
      });
    }
  }
  return withGst(lines, book.gstRate);
}

export function withGst(lines, rate = PRICE_BOOK.gstRate) {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const gst = Math.round((subtotal * rate) / 100);
  return { lines, subtotal, gst, total: subtotal + gst };
}

/** Days in [start, end] counting the first day, in IST calendar days. */
export function periodDays(start, end) {
  const d = (x) => Math.floor((new Date(x).getTime() + 330 * 60_000) / 86_400_000);
  return d(end) - d(start) + 1;
}

/**
 * Proration (spec 3.5 example): an addition is charged for the days left in the period including
 * today. ₹2,500 a month added on day 11 of a 30-day period: 2,500 x 20 / 30 = ₹1,666.67.
 */
export function prorate(amount, { periodStart, periodEnd, at = new Date() }) {
  const total = periodDays(periodStart, periodEnd);
  const left = Math.max(0, periodDays(at, periodEnd));
  return Math.round((amount * left) / total);
}

/** Modules a target set is missing for its dependencies, e.g. PAY without HRM. */
export function unmetDependencies(target) {
  const set = new Set(target);
  return target.flatMap((code) =>
    missingDependencies(code, set).map((dep) => ({ module: code, needs: dep })),
  );
}

/** Subdomains nobody can take (spec 3.3). */
export const RESERVED_SUBDOMAINS = Object.freeze([
  'www',
  'api',
  'console',
  'admin',
  'app',
  'status',
  'mail',
  'help',
  'support',
  'docs',
  'static',
  'cdn',
  'my',
  'book',
]);
