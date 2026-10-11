import { z } from 'zod';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Admission, addCharge } from '../../ipd/index.js';
import { Service } from '../../setup/index.js';
import { DietNote, DietOrder, DietSettings, DietTray } from '../models/diet.models.js';

const ACTIVE_STAY = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`);

export async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

export async function settingsDoc() {
  return (await DietSettings.findOne()) ?? (await DietSettings.create([{}]))[0];
}

export async function getSettings() {
  const s = (await settingsDoc()).toObject({ flattenMaps: true });
  return {
    diets: s.diets,
    meals: s.meals,
    defaultDiet: s.defaultDiet,
    chargeCategories: s.chargeCategories,
    mealServiceCode: s.mealServiceCode,
    attendantServiceCode: s.attendantServiceCode,
  };
}

export const settingsInput = z.object({
  diets: z
    .array(
      z.object({
        code: z.string().trim().toUpperCase().min(2).max(20),
        name: z.string().trim().min(2).max(60),
        texture: z.enum(['REGULAR', 'SOFT', 'MINCED', 'LIQUID', 'TUBE']),
        notes: z.string().trim().max(200).optional(),
        active: z.boolean().default(true),
        calories: z.number().int().min(0).max(5000).optional(),
        restrictions: z.string().trim().max(200).optional(),
        menu: z.record(z.string().trim().toUpperCase(), z.string().trim().max(200)).optional(),
      }),
    )
    .min(1)
    .max(40)
    .optional(),
  meals: z
    .array(
      z.object({
        code: z.string().trim().toUpperCase().min(2).max(20),
        name: z.string().trim().min(2).max(40),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        cutoff: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .min(1)
    .max(8)
    .optional(),
  defaultDiet: z.string().trim().toUpperCase().optional(),
  chargeCategories: z.array(z.string().trim().toUpperCase()).max(20).optional(),
});

export async function saveSettings(input) {
  const s = await settingsDoc();
  const diets = input.diets ?? s.diets;
  if (input.defaultDiet && !diets.some((d) => d.code === input.defaultDiet))
    throw errors.validation([{ path: 'defaultDiet', message: 'Not one of the diet types' }]);
  Object.assign(s, input);
  await s.save();
  return getSettings();
}

// ---------------------------------------------------------------- orders

const nbmActive = (o, when = new Date()) =>
  Boolean(o.nbm?.from) && o.nbm.from <= when && (!o.nbm.to || o.nbm.to > when);

/** NBM now or later (not yet ended). */
const nbmPending = (o) => Boolean(o.nbm?.from) && (!o.nbm.to || o.nbm.to > new Date());

export const orderOut = (o, when) => ({
  id: String(o._id),
  admissionId: String(o.admissionId),
  ipNo: o.ipNo,
  patient: o.patient?.name,
  uhid: o.patient?.uhid,
  ward: o.ward ?? null,
  bed: o.bed ?? null,
  allergies: o.allergies ?? [],
  diet: o.diet,
  texture: o.texture ?? null,
  special: o.special ?? null,
  attendantMeals: Boolean(o.attendantMeals),
  nbm: o.nbm?.from
    ? { from: o.nbm.from, to: o.nbm.to ?? null, reason: o.nbm.reason ?? null }
    : null,
  nbmNow: nbmActive(o, when),
  status: o.status,
  from: o.from,
  orderedBy: o.orderedBy ?? null,
  source: o.source,
});

async function stayOf(admissionId) {
  const a = await Admission.findById(admissionId).lean();
  if (!a) throw errors.notFound('Admission');
  return a;
}

const base = (a) => ({
  admissionId: a._id,
  ipNo: a.ipNo,
  patient: { id: a.patient.id, uhid: a.patient.uhid, name: a.patient.name },
  ward: a.bed?.ward,
  wardCategory: a.bed?.category,
  bed: a.bed?.code,
  allergies: a.patient.allergies ?? [],
});

/** ipd.admitted: every in-patient starts on the hospital's default diet. */
export async function onAdmitted({ admissionId }) {
  if (await DietOrder.exists({ admissionId, status: 'ACTIVE' })) return null;
  const a = await Admission.findById(admissionId).lean();
  if (!a) return null;
  const s = await settingsDoc();
  const d = s.diets.find((x) => x.code === s.defaultDiet);
  const [o] = await DietOrder.create([
    {
      ...base(a),
      diet: s.defaultDiet,
      texture: d?.texture,
      source: 'DEFAULT',
      orderedBy: 'Default',
    },
  ]);
  return o;
}

/** ipd.transferred: the tray follows the patient to the new bed. */
export async function onTransferred({ admissionId }) {
  const a = await Admission.findById(admissionId).lean();
  if (!a) return;
  await DietOrder.updateOne(
    { admissionId, status: 'ACTIVE' },
    { $set: { ward: a.bed?.ward, wardCategory: a.bed?.category, bed: a.bed?.code } },
  );
}

/** ipd.discharged: no more trays. */
export async function onDischarged({ admissionId }) {
  await DietOrder.updateOne(
    { admissionId, status: 'ACTIVE' },
    { $set: { status: 'ENDED', endedAt: new Date() } },
  );
}

export async function listOrders({ ward } = {}) {
  const filter = { status: 'ACTIVE' };
  if (ward) filter.ward = ward;
  const rows = await DietOrder.find(filter).sort({ ward: 1, bed: 1 }).lean();
  return { items: rows.map((o) => orderOut(o)) };
}

export async function activeOrder(admissionId) {
  const o = await DietOrder.findOne({ admissionId, status: 'ACTIVE' }).lean();
  if (!o) throw errors.notFound('Diet order');
  return orderOut(o);
}

export const orderInput = z.object({
  diet: z.string().trim().toUpperCase().min(2).max(20),
  special: z.string().trim().max(200).optional(),
  attendantMeals: z.boolean().default(false),
  source: z.enum(['DOCTOR', 'DIETITIAN']).default('DOCTOR'),
});

/** A new diet for the stay; the old order ends (the kitchen sees the change at the next meal). */
export async function setOrder(admissionId, input) {
  const a = await stayOf(admissionId);
  if (!ACTIVE_STAY.includes(a.status))
    throw new AppError(409, 'INVALID_STATE', 'The patient is not admitted.');
  const s = await settingsDoc();
  const d = s.diets.find((x) => x.code === input.diet && x.active !== false);
  if (!d) throw errors.validation([{ path: 'diet', message: 'Unknown diet type' }]);
  const by = await userName();
  return withTransaction(async () => {
    const old = await DietOrder.findOne({ admissionId, status: 'ACTIVE' });
    if (old) {
      old.status = 'ENDED';
      old.endedAt = new Date();
      await old.save();
    }
    const [o] = await DietOrder.create([
      {
        ...base(a),
        diet: d.code,
        texture: d.texture,
        special: input.special,
        attendantMeals: input.attendantMeals,
        // A current or scheduled NBM window carries over to the new diet
        nbm: old && nbmPending(old) ? old.nbm : undefined,
        source: input.source,
        orderedBy: by,
      },
    ]);
    await publish('diet.order.changed', {
      admissionId: String(admissionId),
      diet: d.code,
      ward: o.ward,
    });
    return orderOut(o.toObject());
  });
}

export const nbmInput = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }).optional(),
  reason: z.string().trim().min(3).max(120),
});

/** Nil by mouth, e.g. "after 22:00 before surgery"; meals in the window are held. */
export async function setNbm(admissionId, input) {
  const o = await DietOrder.findOne({ admissionId, status: 'ACTIVE' });
  if (!o) throw errors.notFound('Diet order');
  const from = new Date(input.from);
  const to = input.to ? new Date(input.to) : undefined;
  if (to && to <= from)
    throw errors.validation([{ path: 'to', message: 'The end is before the start' }]);
  o.nbm = { from, to, reason: input.reason };
  await o.save();
  await publish('diet.order.changed', {
    admissionId: String(admissionId),
    nbm: true,
    ward: o.ward,
  });
  return orderOut(o.toObject());
}

export async function clearNbm(admissionId) {
  const o = await DietOrder.findOne({ admissionId, status: 'ACTIVE' });
  if (!o) throw errors.notFound('Diet order');
  o.nbm = undefined;
  await o.save();
  return orderOut(o.toObject());
}

// ---------------------------------------------------------------- production and trays

async function mealOf(code) {
  const s = await settingsDoc();
  const m = s.meals.find((x) => x.code === code);
  if (!m) throw errors.validation([{ path: 'meal', message: 'Unknown meal' }]);
  return m;
}

/**
 * Production sheet for a meal: counts by diet and ward, special requests, NBM patients held
 * (NBM at the meal's time), and attendant meals.
 */
export async function production({ date = todayIST(), meal }) {
  const m = await mealOf(meal);
  const when = at(date, m.time);
  const orders = await DietOrder.find({ status: 'ACTIVE', from: { $lte: when } })
    .sort({ ward: 1, bed: 1 })
    .lean();
  const s = await settingsDoc();
  const name = (c) => s.diets.find((d) => d.code === c)?.name ?? c;
  const counts = new Map();
  const trays = [];
  let held = 0;
  let attendants = 0;
  for (const o of orders) {
    const nbm = nbmActive(o, when);
    if (nbm) held += 1;
    else {
      const k = `${o.diet}|${o.ward}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (o.attendantMeals) attendants += 1;
    }
    trays.push({
      admissionId: String(o.admissionId),
      patient: o.patient?.name,
      uhid: o.patient?.uhid,
      ward: o.ward,
      bed: o.bed,
      diet: o.diet,
      dietName: name(o.diet),
      texture: o.texture,
      allergies: o.allergies ?? [],
      special: o.special ?? null,
      attendant: Boolean(o.attendantMeals),
      nbm,
      nbmReason: nbm ? o.nbm.reason : null,
    });
  }
  const byDiet = new Map();
  for (const [k, n] of counts) {
    const [diet, ward] = k.split('|');
    const row = byDiet.get(diet) ?? { diet, name: name(diet), total: 0, wards: {} };
    row.total += n;
    row.wards[ward ?? '-'] = n;
    byDiet.set(diet, row);
  }
  const prepared = await DietTray.find({ date, meal }).lean();
  return {
    date,
    meal: m.code,
    mealName: m.name,
    time: m.time,
    cutoff: m.cutoff,
    total: trays.length - held,
    held,
    attendants,
    byDiet: [...byDiet.values()].sort((a, b) => b.total - a.total),
    wards: [...new Set(orders.map((o) => o.ward))].filter(Boolean).sort(),
    trays,
    prepared: prepared.length > 0,
    delivered: prepared.filter((t) => t.status === 'DELIVERED').length,
  };
}

const trayOut = (t) => ({
  id: String(t._id),
  date: t.date,
  meal: t.meal,
  admissionId: String(t.admissionId),
  patient: t.patient,
  ward: t.ward,
  bed: t.bed,
  diet: t.diet,
  status: t.status,
  deliveredAt: t.deliveredAt ?? null,
  deliveredBy: t.deliveredBy ?? null,
  missedReason: t.missedReason ?? null,
  charged: t.charged,
});

/** The kitchen prepares the meal: one tray per patient (held trays for NBM); safe to repeat. */
export async function prepare({ date = todayIST(), meal }) {
  const sheet = await production({ date, meal });
  const orders = await DietOrder.find({
    admissionId: { $in: sheet.trays.map((t) => t.admissionId) },
    status: 'ACTIVE',
  })
    .select('_id admissionId')
    .lean();
  const orderOf = new Map(orders.map((o) => [String(o.admissionId), o._id]));
  for (const t of sheet.trays) {
    if (await DietTray.exists({ date, meal, admissionId: t.admissionId })) continue;
    await DietTray.create([
      {
        date,
        meal,
        admissionId: t.admissionId,
        orderId: orderOf.get(t.admissionId),
        patient: t.patient,
        ward: t.ward,
        bed: t.bed,
        diet: t.diet,
        status: t.nbm ? 'NBM' : 'PREPARED',
      },
    ]);
  }
  return trays({ date, meal });
}

export async function trays({ date = todayIST(), meal, ward }) {
  const filter = { date, meal };
  if (ward) filter.ward = ward;
  const rows = await DietTray.find(filter).sort({ ward: 1, bed: 1 }).lean();
  return { items: rows.map(trayOut) };
}

/** Charges a delivered meal to the running bill for chargeable wards (and the attendant's meal). */
async function chargeTray(t) {
  const s = await settingsDoc();
  const o = t.orderId ? await DietOrder.findById(t.orderId).lean() : null;
  if (!o || !s.chargeCategories.includes(o.wardCategory)) return false;
  const codes = [s.mealServiceCode, ...(o.attendantMeals ? [s.attendantServiceCode] : [])];
  const services = await Service.find({ code: { $in: codes }, status: 'ACTIVE' }).lean();
  if (!services.length) return false;
  services.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code)); // meal, then attendant
  const by = await userName();
  for (const svc of services)
    await addCharge(
      String(t.admissionId),
      { serviceId: String(svc._id), qty: 1, source: 'DIET' },
      by,
    );
  return true;
}

/** Ward staff confirm delivery (one tray, or every prepared tray of a ward for the meal). */
export async function deliver({ trayIds, date, meal, ward }) {
  const filter = trayIds?.length
    ? { _id: { $in: trayIds } }
    : { date, meal, ward, status: 'PREPARED' };
  if (!trayIds?.length && !(date && meal && ward))
    throw errors.validation([{ path: 'ward', message: 'Choose trays or a ward' }]);
  const rows = await DietTray.find(filter);
  const by = await userName();
  let delivered = 0;
  for (const t of rows) {
    if (t.status !== 'PREPARED') continue;
    t.status = 'DELIVERED';
    t.deliveredAt = new Date();
    t.deliveredBy = by;
    t.charged = await chargeTray(t);
    await t.save();
    delivered += 1;
  }
  return { delivered };
}

export async function markMissed(id, { reason }) {
  const t = await DietTray.findById(id);
  if (!t) throw errors.notFound('Tray');
  if (t.status !== 'PREPARED')
    throw new AppError(409, 'INVALID_STATE', 'Only a prepared tray can be missed.');
  t.status = 'MISSED';
  t.missedReason = reason;
  await t.save();
  return trayOut(t.toObject());
}

/** Missed meals for a day: marked missed, or still not delivered an hour after the meal time. */
export async function missedReport({ date = todayIST() }) {
  const s = await settingsDoc();
  const now = new Date();
  const rows = await DietTray.find({ date, status: { $in: ['PREPARED', 'MISSED'] } })
    .sort({ meal: 1, ward: 1 })
    .lean();
  const late = rows.filter((t) => {
    if (t.status === 'MISSED') return true;
    const m = s.meals.find((x) => x.code === t.meal);
    return m && at(date, m.time).getTime() + 3_600_000 < now.getTime();
  });
  return { date, items: late.map(trayOut) };
}

// ---------------------------------------------------------------- dietitian

export const noteInput = z.object({
  kind: z.enum(['ASSESSMENT', 'COUNSELLING', 'DISCHARGE_PLAN']),
  heightCm: z.number().min(30).max(250).optional(),
  weightKg: z.number().min(0.5).max(400).optional(),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  kcal: z.number().int().min(0).max(6000).optional(),
  proteinG: z.number().int().min(0).max(400).optional(),
  text: z.string().trim().min(3).max(2000),
});

export async function addNote(admissionId, input) {
  await stayOf(admissionId);
  const { kind, text, ...data } = input;
  if (data.heightCm && data.weightKg)
    data.bmi = Math.round((data.weightKg / (data.heightCm / 100) ** 2) * 10) / 10;
  const [n] = await DietNote.create([{ admissionId, kind, text, data, by: await userName() }]);
  return { id: String(n._id), kind, text, data: n.data, by: n.by, at: n.at };
}

export async function notes(admissionId) {
  const rows = await DietNote.find({ admissionId }).sort({ at: -1 }).lean();
  return {
    items: rows.map((n) => ({
      id: String(n._id),
      kind: n.kind,
      text: n.text,
      data: n.data ?? {},
      by: n.by,
      at: n.at,
    })),
  };
}

/**
 * Meal billing (board "Meal billing"): what went to running bills on a day, by stay: the
 * patient's meals and attendant meals for chargeable wards, at the tariff of the meal services.
 */
export async function mealBilling({ date }) {
  const s = await settingsDoc();
  const trays = await DietTray.find({ date, charged: true })
    .select('admissionId orderId patient ward bed meal')
    .lean();
  const orders = new Map(
    (
      await DietOrder.find({ _id: { $in: trays.map((t) => t.orderId).filter(Boolean) } })
        .select('attendantMeals ipNo')
        .lean()
    ).map((o) => [String(o._id), o]),
  );
  const services = await Service.find({
    code: { $in: [s.mealServiceCode, s.attendantServiceCode] },
  })
    .select('code rates')
    .lean();
  const rate = (code) => services.find((x) => x.code === code)?.rates?.[0]?.amount ?? 0;
  const mealRate = rate(s.mealServiceCode);
  const attendantRate = rate(s.attendantServiceCode);
  const by = new Map();
  for (const t of trays) {
    const o = orders.get(String(t.orderId));
    const r = by.get(String(t.admissionId)) ?? {
      admissionId: String(t.admissionId),
      ipNo: o?.ipNo,
      patient: t.patient,
      ward: t.ward,
      bed: t.bed,
      meals: 0,
      attendantMeals: 0,
    };
    r.meals += 1;
    if (o?.attendantMeals) r.attendantMeals += 1;
    by.set(String(t.admissionId), r);
  }
  const items = [...by.values()].map((r) => ({
    ...r,
    amount: r.meals * mealRate + r.attendantMeals * attendantRate,
  }));
  return {
    date,
    mealRate,
    attendantRate,
    items: items.sort((a, b) => String(a.bed).localeCompare(String(b.bed))),
    total: items.reduce((t, r) => t + r.amount, 0),
  };
}
