import mongoose, { Schema } from 'mongoose';
import { financialYear, formatSequence, formatUhid } from '@hms/shared';
import { tenantPlugin } from '../tenancy/tenant.plugin.js';
import { current } from '../tenancy/context.js';

/**
 * Atomic counters per tenant, branch, series and financial year (spec "Data design rules").
 * One findOneAndUpdate with $inc: two cashiers can never get the same bill number.
 * Inside a transaction a rolled-back write also rolls back its number, so series stay gap-free.
 */
const schema = new Schema(
  {
    series: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    fy: { type: String, default: null },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);
schema.plugin(tenantPlugin);
schema.index({ tenantId: 1, series: 1, branchId: 1, fy: 1 }, { unique: true });
export const Counter = mongoose.models.Counter ?? mongoose.model('Counter', schema);

export async function nextNumber(series, { branchId = null, fy = null } = {}) {
  const filter = { series, branchId, fy };
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await Counter.findOneAndUpdate(
        filter,
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      );
      return doc.seq;
    } catch (err) {
      // Two first-ever calls can race on the upsert; the loser retries and increments.
      if (err?.code === 11000 && attempt < 3) continue;
      throw err;
    }
  }
}

/** e.g. documentNumber('OP') -> "OP/26-27/000154" for the current branch and financial year. */
export async function documentNumber(prefix, { perBranch = true, date = new Date() } = {}) {
  const fy = financialYear(date);
  const n = await nextNumber(prefix, {
    branchId: perBranch ? (current().branchId ?? null) : null,
    fy,
  });
  return formatSequence(prefix, fy, n);
}

/** Hospital-wide UHID, never reset: "CC0000123". */
export async function nextUhid() {
  const prefix = current().tenant?.settings?.uhidPrefix ?? 'CC';
  return formatUhid(prefix, await nextNumber('UHID'));
}

/** Period part of a number: "26-27" (yearly), "2610" (monthly) or none. */
export function periodLabel(reset, date = new Date()) {
  if (reset === 'NEVER') return null;
  const fy = financialYear(date);
  if (reset === 'YEARLY') return fy;
  const ist = new Date(new Date(date).getTime() + 330 * 60_000);
  return `${String(ist.getUTCFullYear()).slice(-2)}${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Next number in a configured series: { prefix, reset, width, perBranch } decides the format:
 * yearly "OP/26-27/000154", monthly "OP/2610/000154", never reset "CC0000123".
 */
export async function nextInSeries(
  series,
  { prefix, reset, width, perBranch },
  { date = new Date() } = {},
) {
  const period = periodLabel(reset, date);
  const n = await nextNumber(series, {
    branchId: perBranch ? (current().branchId ?? null) : null,
    fy: period,
  });
  return period ? formatSequence(prefix, period, n, width) : formatUhid(prefix, n, width);
}
