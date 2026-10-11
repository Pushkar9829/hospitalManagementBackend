import { z } from 'zod';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { withTransaction } from '../../../core/db/model.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { Asset } from '../../facility/index.js';
import { DepreciationRun, FixedAsset } from '../models/treasury.models.js';
import { assertOpen, ensureChart, post, todayIST, userName } from './finance.service.js';

/**
 * Fixed asset register and depreciation (spec "Fixed assets"): capitalise an asset (from the
 * equipment register or on its own), charge depreciation month by month (straight line over the
 * Schedule II life, or written-down value), dispose with the gain or loss, and the schedule of
 * fixed assets for the year.
 */

/** Asset blocks: Companies Act Schedule II useful life (years) and the income-tax WDV rate. */
export const BLOCKS = {
  BUILDING: { name: 'Hospital building', life: 60, wdv: 10 },
  MEDICAL_EQUIPMENT: { name: 'Medical and surgical equipment', life: 13, wdv: 15 },
  ELECTRICAL: { name: 'Electrical installations', life: 10, wdv: 10 },
  FURNITURE: { name: 'Furniture and fittings', life: 10, wdv: 10 },
  COMPUTERS: { name: 'Computers', life: 3, wdv: 40 },
  VEHICLES: { name: 'Vehicles and ambulances', life: 8, wdv: 15 },
  OTHER: { name: 'Other plant', life: 15, wdv: 15 },
};

const monthOf = (d) => d.slice(0, 7);
const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const prevMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};
const daysIn = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
};
const lastDay = (m) => `${m}-${String(daysIn(m)).padStart(2, '0')}`;

const salvageOf = (a) => Math.round((a.cost * (a.salvagePct ?? 0)) / 100);
export const bookValue = (a) => a.cost - (a.accumulated ?? 0);

/**
 * One month's depreciation for an asset carrying `accumulated` so far. The month it is put to use
 * is charged for the days used. Never takes the book value below the salvage value.
 */
export function monthCharge(a, month, accumulated = a.accumulated ?? 0) {
  if (month < monthOf(a.putToUseOn)) return 0;
  const room = a.cost - salvageOf(a) - accumulated;
  if (room <= 0) return 0;
  let charge =
    a.method === 'WDV'
      ? ((a.cost - accumulated) * a.wdvRate) / 100 / 12
      : (a.cost - salvageOf(a)) / (a.usefulLifeYears * 12);
  if (month === monthOf(a.putToUseOn)) {
    const used = daysIn(month) - Number(a.putToUseOn.slice(8, 10)) + 1;
    charge = (charge * used) / daysIn(month);
  }
  return Math.min(room, Math.round(charge));
}

const assetOut = (a) => ({
  id: String(a._id),
  code: a.code,
  name: a.name,
  block: a.block,
  blockName: BLOCKS[a.block]?.name ?? a.block,
  equipmentId: a.equipmentId ? String(a.equipmentId) : null,
  department: a.department ?? null,
  putToUseOn: a.putToUseOn,
  cost: a.cost,
  salvagePct: a.salvagePct,
  method: a.method,
  usefulLifeYears: a.usefulLifeYears ?? null,
  wdvRate: a.wdvRate ?? null,
  accumulated: a.accumulated ?? 0,
  bookValue: bookValue(a),
  depreciatedThrough: a.depreciatedThrough ?? null,
  fundedFrom: a.fundedFrom,
  status: a.status,
  disposal: a.disposal?.on ? a.disposal : null,
  version: a.version ?? 0,
});

// ---------------------------------------------------------------- register

export const assetInput = z
  .object({
    code: z.string().trim().toUpperCase().min(2).max(20),
    name: z.string().trim().min(2).max(120),
    block: z.enum(Object.keys(BLOCKS)),
    equipmentId: z.string().optional(),
    department: z.string().trim().max(80).optional(),
    putToUseOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cost: z.number().int().min(100),
    salvagePct: z.number().min(0).max(50).default(5),
    method: z.enum(['SLM', 'WDV']).default('SLM'),
    usefulLifeYears: z.number().min(1).max(100).optional(),
    wdvRate: z.number().min(1).max(100).optional(),
    /** BANK: bought now (Dr Fixed assets, Cr Bank). EXISTING: already in the books. */
    fundedFrom: z.enum(['BANK', 'EXISTING']).default('BANK'),
    /** For an EXISTING asset: depreciation already charged, and the month it runs through. */
    openingAccumulated: z.number().int().min(0).default(0),
    depreciatedThrough: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  })
  .refine((v) => v.fundedFrom === 'EXISTING' || !v.openingAccumulated, {
    path: ['openingAccumulated'],
    message: 'Only an asset already in the books has depreciation charged before',
  })
  .refine((v) => v.openingAccumulated <= v.cost, {
    path: ['openingAccumulated'],
    message: 'More than the cost',
  });

/** Capitalises an asset. A purchase posts Dr Fixed assets, Cr Bank on the date put to use. */
export async function createAsset(input) {
  await ensureChart();
  if (await FixedAsset.exists({ code: input.code }))
    throw new AppError(409, 'DUPLICATE', `Asset ${input.code} is already in the register.`);
  if (input.equipmentId) {
    if (!(await Asset.exists({ _id: input.equipmentId }))) throw errors.notFound('Equipment');
    if (await FixedAsset.exists({ equipmentId: input.equipmentId }))
      throw new AppError(409, 'DUPLICATE', 'That equipment is already capitalised.');
  }
  if (input.fundedFrom === 'BANK') await assertOpen(input.putToUseOn);
  const block = BLOCKS[input.block];
  const { openingAccumulated, ...rest } = input;
  return withTransaction(async () => {
    const [a] = await FixedAsset.create([
      {
        ...rest,
        usefulLifeYears: input.method === 'SLM' ? (input.usefulLifeYears ?? block.life) : undefined,
        wdvRate: input.method === 'WDV' ? (input.wdvRate ?? block.wdv) : undefined,
        accumulated: openingAccumulated,
        depreciatedThrough: input.depreciatedThrough ?? prevMonth(monthOf(input.putToUseOn)),
      },
    ]);
    if (input.fundedFrom === 'BANK') {
      const j = await post({
        type: 'PAYMENT',
        date: input.putToUseOn,
        narration: `Asset capitalised: ${a.code} ${a.name}`,
        source: { kind: 'FIXED_ASSET', ref: String(a._id) },
        lines: [
          { key: 'FIXED_ASSETS', debit: a.cost },
          { key: 'BANK', credit: a.cost },
        ],
      });
      a.journalId = j._id;
      await a.save();
    }
    return assetOut(a.toObject());
  });
}

export async function listAssets({ status } = {}) {
  const rows = await FixedAsset.find(status ? { status } : {})
    .sort({ code: 1 })
    .lean();
  const items = rows.map(assetOut);
  const active = items.filter((a) => a.status === 'ACTIVE');
  return {
    blocks: Object.entries(BLOCKS).map(([code, b]) => ({ code, ...b })),
    items,
    totals: {
      cost: active.reduce((t, a) => t + a.cost, 0),
      accumulated: active.reduce((t, a) => t + a.accumulated, 0),
      bookValue: active.reduce((t, a) => t + a.bookValue, 0),
    },
  };
}

/** Equipment in the facility register that is not capitalised yet (to pick from). */
export async function uncapitalisedEquipment() {
  const done = (
    await FixedAsset.find({ equipmentId: { $ne: null } })
      .select('equipmentId')
      .lean()
  ).map((a) => a.equipmentId);
  const rows = await Asset.find({ _id: { $nin: done }, status: { $ne: 'CONDEMNED' } })
    .sort({ code: 1 })
    .limit(500)
    .lean();
  return {
    items: rows.map((e) => ({
      id: String(e._id),
      code: e.code,
      name: e.name,
      category: e.category,
      department: e.department ?? null,
      cost: e.cost ?? null,
      purchasedOn: e.purchasedOn ? new Date(e.purchasedOn).toISOString().slice(0, 10) : null,
    })),
  };
}

// ---------------------------------------------------------------- depreciation

export const runInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

/** What a month's run would charge each asset (catching up any month an asset missed). */
async function chargesThrough(month) {
  const assets = await FixedAsset.find({
    status: 'ACTIVE',
    putToUseOn: { $lte: lastDay(month) },
    $or: [{ depreciatedThrough: null }, { depreciatedThrough: { $lt: month } }],
  }).sort({ code: 1 });
  const lines = [];
  for (const a of assets) {
    let acc = a.accumulated ?? 0;
    let m = a.depreciatedThrough ? nextMonth(a.depreciatedThrough) : monthOf(a.putToUseOn);
    let amount = 0;
    for (; m <= month; m = nextMonth(m)) {
      const c = monthCharge(a, m, acc);
      acc += c;
      amount += c;
    }
    lines.push({ asset: a, amount });
  }
  return lines;
}

export async function previewDepreciation({ month }) {
  const lines = await chargesThrough(month);
  return {
    month,
    done: Boolean(await DepreciationRun.exists({ month })),
    lines: lines
      .filter((l) => l.amount > 0)
      .map((l) => ({
        code: l.asset.code,
        name: l.asset.name,
        block: l.asset.block,
        amount: l.amount,
      })),
    total: lines.reduce((t, l) => t + l.amount, 0),
  };
}

/**
 * Charges the month's depreciation: Dr Depreciation, Cr Accumulated depreciation, dated the last
 * day of the month. Once a month; the month must be open and not in the future.
 */
export async function runDepreciation({ month }) {
  await ensureChart();
  const today = todayIST();
  if (month > monthOf(today))
    throw new AppError(422, 'FUTURE_MONTH', 'Depreciation is charged for a month that has begun.');
  if (await DepreciationRun.exists({ month }))
    throw new AppError(409, 'ALREADY_RUN', `Depreciation for ${month} is already charged.`);
  const date = lastDay(month) < today ? lastDay(month) : today;
  await assertOpen(date);
  const lines = (await chargesThrough(month)).filter((l) => l.amount > 0);
  const total = lines.reduce((t, l) => t + l.amount, 0);
  return withTransaction(async () => {
    let journalId;
    if (total > 0) {
      const j = await post({
        type: 'JOURNAL',
        date,
        narration: `Depreciation for ${month}`,
        source: { kind: 'DEPRECIATION', ref: month },
        lines: [
          { key: 'DEPRECIATION', debit: total },
          { key: 'ACC_DEPRECIATION', credit: total },
        ],
      });
      journalId = j._id;
    }
    for (const l of lines) {
      l.asset.accumulated = (l.asset.accumulated ?? 0) + l.amount;
      l.asset.depreciatedThrough = month;
      await l.asset.save();
    }
    // Assets with nothing left to charge still move on, so a later run does not revisit them.
    await FixedAsset.updateMany(
      {
        status: 'ACTIVE',
        putToUseOn: { $lte: lastDay(month) },
        $or: [{ depreciatedThrough: null }, { depreciatedThrough: { $lt: month } }],
      },
      { $set: { depreciatedThrough: month } },
    );
    const [run] = await DepreciationRun.create([
      {
        month,
        journalId,
        total,
        lines: lines.map((l) => ({
          assetId: l.asset._id,
          code: l.asset.code,
          name: l.asset.name,
          block: l.asset.block,
          amount: l.amount,
        })),
        byName: await userName(),
      },
    ]);
    return {
      id: String(run._id),
      month,
      total,
      lines: run.lines.map((l) => ({ code: l.code, name: l.name, amount: l.amount })),
    };
  });
}

export async function listRuns() {
  const rows = await DepreciationRun.find({}).sort({ month: -1 }).limit(36).lean();
  return {
    items: rows.map((r) => ({
      id: String(r._id),
      month: r.month,
      total: r.total,
      assets: r.lines.length,
      byName: r.byName ?? null,
      createdAt: r.createdAt,
    })),
  };
}

// ---------------------------------------------------------------- disposal

export const disposeInput = z.object({
  version: z.number().int().min(0),
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proceeds: z.number().int().min(0),
  reason: z.string().trim().min(3).max(200),
});

/**
 * Sells or scraps an asset. Depreciation must be charged through the month before; Finance
 * approves; then Dr Accumulated depreciation and Bank (proceeds), Cr Fixed assets (cost), with
 * the profit or loss on sale.
 */
export async function disposeAsset(id, input, res) {
  const a = await FixedAsset.findById(id);
  if (!a) throw errors.notFound('Asset');
  if (a.version !== input.version) throw errors.versionConflict();
  if (a.status !== 'ACTIVE') throw new AppError(409, 'INVALID_STATE', 'Already disposed.');
  if (input.on < a.putToUseOn)
    throw errors.validation([{ path: 'on', message: 'Before the asset was put to use' }]);
  const before = prevMonth(monthOf(input.on));
  if (monthOf(a.putToUseOn) <= before && (a.depreciatedThrough ?? '') < before)
    throw new AppError(
      409,
      'DEPRECIATION_DUE',
      `Charge depreciation through ${before} before disposing of the asset.`,
    );
  await assertOpen(input.on);
  return withTransaction(async () => {
    const approval = await requestApproval({
      action: 'finance.assetDisposal',
      module: 'FIN',
      entity: 'FixedAsset',
      entityId: a._id,
      title: `Dispose of ${a.code} ${a.name} for ₹${(input.proceeds / 100).toLocaleString('en-IN')}`,
      before: { bookValue: bookValue(a) },
      after: { proceeds: input.proceeds },
      payload: {
        assetId: String(a._id),
        on: input.on,
        proceeds: input.proceeds,
        reason: input.reason,
      },
      metrics: { amount: bookValue(a) },
      reason: input.reason,
    });
    if (approval) {
      if (res) res.locals.status = 202;
      return {
        ...assetOut(a.toObject()),
        approvalId: String(approval._id),
        status: 'PENDING_APPROVAL',
      };
    }
    await applyDisposal(a, input);
    return assetOut(a.toObject());
  });
}

async function applyDisposal(a, { on, proceeds, reason }) {
  const gain = proceeds - bookValue(a);
  const j = await post({
    type: 'JOURNAL',
    date: on,
    narration: `Asset disposed: ${a.code} ${a.name}`,
    source: { kind: 'ASSET_DISPOSAL', ref: String(a._id) },
    lines: [
      { key: 'ACC_DEPRECIATION', debit: a.accumulated ?? 0 },
      { key: 'BANK', debit: proceeds },
      gain < 0
        ? { key: 'ASSET_GAIN_LOSS', debit: -gain }
        : { key: 'ASSET_GAIN_LOSS', credit: gain },
      { key: 'FIXED_ASSETS', credit: a.cost },
    ],
  });
  a.status = 'DISPOSED';
  a.disposal = { on, proceeds, gain, journalId: j._id, reason };
  await a.save();
}

onApprovalDecided('finance.assetDisposal', async (req, outcome) => {
  if (outcome !== 'APPROVED') return;
  const a = await FixedAsset.findById(req.payload.assetId);
  if (!a || a.status !== 'ACTIVE') return;
  await applyDisposal(a, req.payload);
});

// ---------------------------------------------------------------- schedule

const fyRange = (fy) => {
  const start = Number(fy.slice(0, 4));
  return {
    from: `${start}-04-01`,
    to: `${start + 1}-03-31`,
    months: [`${start}-04`, `${start + 1}-03`],
  };
};

/**
 * Schedule of fixed assets for a financial year, by block: gross block (opening, additions,
 * disposals, closing), depreciation (opening, for the year, on disposals, closing) and the net
 * block. Opening figures are rebuilt from the register and the year's runs.
 */
export async function schedule({ fy }) {
  const { from, to, months } = fyRange(fy);
  const assets = await FixedAsset.find({ putToUseOn: { $lte: to } }).lean();
  const runs = await DepreciationRun.find({ month: { $gte: months[0], $lte: months[1] } }).lean();
  const later = await DepreciationRun.find({ month: { $gt: months[1] } }).lean();
  const charged = (rs, assetId) =>
    rs.reduce(
      (t, r) =>
        t +
        r.lines
          .filter((l) => String(l.assetId) === String(assetId))
          .reduce((s, l) => s + l.amount, 0),
      0,
    );
  const rows = new Map();
  for (const a of assets) {
    if (a.disposal?.on && a.disposal.on < from) continue;
    const r =
      rows.get(a.block) ??
      Object.fromEntries(
        [
          'openingGross',
          'additions',
          'disposals',
          'closingGross',
          'openingDep',
          'forYear',
          'onDisposals',
          'closingDep',
        ].map((k) => [k, 0]),
      );
    const inYear = charged(runs, a._id);
    // Accumulated now, less what later years added, is the closing figure for this year.
    const disposedInYear = a.disposal?.on && a.disposal.on <= to;
    const closingAcc = (a.accumulated ?? 0) - charged(later, a._id);
    const openingAcc = closingAcc - inYear;
    if (a.putToUseOn < from) r.openingGross += a.cost;
    else r.additions += a.cost;
    r.openingDep += openingAcc;
    r.forYear += inYear;
    if (disposedInYear) {
      r.disposals += a.cost;
      r.onDisposals += closingAcc;
    } else {
      r.closingGross += a.cost;
      r.closingDep += closingAcc;
    }
    rows.set(a.block, r);
  }
  const items = [...rows.entries()].map(([block, r]) => ({
    block,
    name: BLOCKS[block]?.name ?? block,
    ...r,
    netBlock: r.closingGross - r.closingDep,
  }));
  const sum = (k) => items.reduce((t, r) => t + r[k], 0);
  return {
    fy,
    items,
    totals: Object.fromEntries(
      [
        'openingGross',
        'additions',
        'disposals',
        'closingGross',
        'openingDep',
        'forYear',
        'onDisposals',
        'closingDep',
        'netBlock',
      ].map((k) => [k, sum(k)]),
    ),
  };
}
