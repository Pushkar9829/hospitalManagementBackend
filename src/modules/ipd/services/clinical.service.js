import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Bed, Ward } from '../../setup/index.js';
import { Admission } from '../models/ipd.models.js';
import { IoEntry, IpdNote, IpdVitals, MarDose, MedOrder } from '../models/clinical.models.js';
import { markUnderTreatment, userName } from './admission.service.js';
import { atIST, daysBetween, ymdIST } from './common.js';

const ACTIVE = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];

async function activeStay(id) {
  const a = await Admission.findById(id).lean();
  if (!a) throw errors.notFound('Admission');
  if (!ACTIVE.includes(a.status)) throw new AppError(409, 'INVALID_STATE', 'The stay is closed.');
  return a;
}

// ---------------------------------------------------------------- NEWS2

const band = (v, rules) => {
  if (v == null || Number.isNaN(v)) return 0;
  for (const [test, score] of rules) if (test(v)) return score;
  return 0;
};

/** NEWS2 (Royal College of Physicians, 2017), SpO2 scale 1. */
export function news2({ rr, spo2, onOxygen, tempC, sbp, hr, consciousness }) {
  const parts = [
    band(rr, [
      [(x) => x <= 8, 3],
      [(x) => x <= 11, 1],
      [(x) => x <= 20, 0],
      [(x) => x <= 24, 2],
      [() => true, 3],
    ]),
    band(spo2, [
      [(x) => x <= 91, 3],
      [(x) => x <= 93, 2],
      [(x) => x <= 95, 1],
      [() => true, 0],
    ]),
    onOxygen ? 2 : 0,
    band(sbp, [
      [(x) => x <= 90, 3],
      [(x) => x <= 100, 2],
      [(x) => x <= 110, 1],
      [(x) => x <= 219, 0],
      [() => true, 3],
    ]),
    band(hr, [
      [(x) => x <= 40, 3],
      [(x) => x <= 50, 1],
      [(x) => x <= 90, 0],
      [(x) => x <= 110, 1],
      [(x) => x <= 130, 2],
      [() => true, 3],
    ]),
    consciousness && consciousness !== 'A' ? 3 : 0,
    band(tempC, [
      [(x) => x <= 35, 3],
      [(x) => x <= 36, 1],
      [(x) => x <= 38, 0],
      [(x) => x <= 39, 1],
      [() => true, 2],
    ]),
  ];
  const score = parts.reduce((s, x) => s + x, 0);
  const risk =
    score >= 7 ? 'HIGH' : score >= 5 ? 'MEDIUM' : parts.some((x) => x === 3) ? 'LOW_MEDIUM' : 'LOW';
  return { score, risk };
}

export async function recordVitals(admissionId, body) {
  const a = await activeStay(admissionId);
  const { score, risk } = news2(body);
  const [v] = await IpdVitals.create([
    {
      ...body,
      admissionId,
      at: body.at ? new Date(body.at) : new Date(),
      news2: score,
      risk,
      by: await userName(),
    },
  ]);
  if (risk === 'HIGH' || risk === 'MEDIUM')
    await publish('ipd.news2.alert', {
      admissionId: String(admissionId),
      ipNo: a.ipNo,
      bed: a.bed.code,
      score,
      risk,
    });
  return vitalsOut(v);
}

const vitalsOut = (v) => ({
  id: String(v._id),
  at: v.at,
  rr: v.rr ?? null,
  spo2: v.spo2 ?? null,
  onOxygen: Boolean(v.onOxygen),
  tempC: v.tempC ?? null,
  sbp: v.sbp ?? null,
  dbp: v.dbp ?? null,
  hr: v.hr ?? null,
  consciousness: v.consciousness,
  painScore: v.painScore ?? null,
  sugar: v.sugar ?? null,
  news2: v.news2,
  risk: v.risk,
  by: v.by,
});

export async function listVitals(admissionId, { limit = 50 } = {}) {
  const items = await IpdVitals.find({ admissionId }).sort({ at: -1 }).limit(limit).lean();
  return { items: items.map(vitalsOut), total: items.length, page: 1, limit };
}

// ---------------------------------------------------------------- intake and output

export async function recordIo(admissionId, body) {
  await activeStay(admissionId);
  const [e] = await IoEntry.create([
    { ...body, admissionId, at: body.at ? new Date(body.at) : new Date(), by: await userName() },
  ]);
  return {
    id: String(e._id),
    at: e.at,
    kind: e.kind,
    route: e.route,
    ml: e.ml,
    note: e.note ?? null,
    by: e.by,
  };
}

/** Today's (IST) intake, output and balance, with the entries. */
export async function ioToday(admissionId, { date = ymdIST() } = {}) {
  const from = atIST(date);
  const to = new Date(from.getTime() + 86_400_000);
  const items = await IoEntry.find({ admissionId, at: { $gte: from, $lt: to } })
    .sort({ at: 1 })
    .lean();
  const sum = (k) => items.filter((e) => e.kind === k).reduce((s, e) => s + e.ml, 0);
  return {
    date,
    intake: sum('INTAKE'),
    output: sum('OUTPUT'),
    balance: sum('INTAKE') - sum('OUTPUT'),
    items: items.map((e) => ({
      id: String(e._id),
      at: e.at,
      kind: e.kind,
      route: e.route,
      ml: e.ml,
      note: e.note ?? null,
      by: e.by,
    })),
  };
}

// ---------------------------------------------------------------- notes and assessments

const noteOut = (n) => ({
  id: String(n._id),
  kind: n.kind,
  text: n.text ?? '',
  data: n.data ?? null,
  by: n.by,
  at: n.at,
  addenda: (n.addenda ?? []).map((x) => ({ text: x.text, by: x.by, at: x.at })),
});

export async function addNote(admissionId, { kind, text, data }) {
  await activeStay(admissionId);
  const [n] = await IpdNote.create([
    {
      admissionId,
      kind,
      text,
      data,
      by: await userName(),
      byUserId: current().userId,
      at: new Date(),
    },
  ]);
  if (['DOCTOR_INITIAL', 'PROGRESS'].includes(kind)) await markUnderTreatment(admissionId);
  return noteOut(n);
}

export async function listNotes(admissionId, { kind } = {}) {
  const filter = { admissionId };
  if (kind) filter.kind = { $in: kind.split(',') };
  const items = await IpdNote.find(filter).sort({ at: -1 }).limit(200).lean();
  return { items: items.map(noteOut), total: items.length, page: 1, limit: 200 };
}

/** Notes are signed when saved; changes are addenda (rule R13). */
export async function addNoteAddendum(noteId, { text }) {
  const n = await IpdNote.findById(noteId);
  if (!n) throw errors.notFound('Note');
  n.addenda.push({ text, by: await userName(), at: new Date() });
  await n.save();
  return noteOut(n);
}

/** Rule R10: nursing assessment within 2 h and the doctor's initial assessment within 24 h. */
export async function assessmentsDue(a, now = new Date()) {
  const kinds = new Set(await IpdNote.distinct('kind', { admissionId: a._id }));
  const out = [];
  const nurseDue = new Date(a.admittedAt.getTime() + 2 * 3_600_000);
  const doctorDue = new Date(a.admittedAt.getTime() + 24 * 3_600_000);
  if (!kinds.has('NURSING_ADMISSION'))
    out.push({ kind: 'NURSING_ADMISSION', dueAt: nurseDue, overdue: now > nurseDue });
  if (!kinds.has('DOCTOR_INITIAL'))
    out.push({ kind: 'DOCTOR_INITIAL', dueAt: doctorDue, overdue: now > doctorDue });
  return out;
}

// ---------------------------------------------------------------- medicine orders and the MAR

const DEFAULT_TIMES = {
  OD: ['09:00'],
  BD: ['09:00', '21:00'],
  TDS: ['08:00', '14:00', '20:00'],
  QID: ['06:00', '12:00', '18:00', '22:00'],
  Q6H: ['00:00', '06:00', '12:00', '18:00'],
  Q8H: ['06:00', '14:00', '22:00'],
  HS: ['21:00'],
  SOS: [],
  STAT: [],
};
/** Rule R12: medicines that need a second nurse's check at every dose. */
const HIGH_ALERT =
  /insulin|heparin|enoxaparin|potassium chloride|\bkcl\b|methotrexate|cyclophosphamide|cisplatin|carboplatin|vincristine|morphine|fentanyl|midazolam|magnesium sulphate|warfarin/i;

const orderOut = (o) => ({
  id: String(o._id),
  admissionId: String(o.admissionId),
  drug: o.drug,
  dose: o.dose,
  route: o.route,
  frequency: o.frequency,
  times: o.times ?? [],
  prn: o.prn,
  stat: o.stat,
  highAlert: o.highAlert,
  instructions: o.instructions ?? null,
  startAt: o.startAt,
  endAt: o.endAt ?? null,
  status: o.status,
  orderedBy: o.orderedBy,
  verifiedBy: o.verifiedBy ?? null,
  stopReason: o.stopReason ?? null,
});

export async function orderMedicine(admissionId, body) {
  const a = await activeStay(admissionId);
  const stat = body.frequency === 'STAT';
  const prn = body.frequency === 'SOS';
  const highAlert =
    Boolean(body.highAlert) || HIGH_ALERT.test(`${body.drug.brand} ${body.drug.generic ?? ''}`);
  return withTransaction(async () => {
    const [o] = await MedOrder.create([
      {
        admissionId,
        patientId: a.patient.id,
        drug: body.drug,
        dose: body.dose,
        route: body.route,
        frequency: body.frequency,
        times: body.times?.length ? body.times : (DEFAULT_TIMES[body.frequency] ?? []),
        prn,
        stat,
        highAlert,
        instructions: body.instructions,
        startAt: body.startAt ? new Date(body.startAt) : new Date(),
        endAt: body.days ? new Date(Date.now() + body.days * 86_400_000) : undefined,
        orderedBy: await userName(),
      },
    ]);
    // A STAT dose can be given before the pharmacist verifies (rule R11).
    if (stat) await MarDose.create([{ orderId: o._id, admissionId, dueAt: new Date() }]);
    await publish('ipd.medicine.ordered', {
      orderId: String(o._id),
      admissionId: String(admissionId),
      stat,
      drug: o.drug.brand,
      // A STAT dose goes to the pharmacy at once; others after the pharmacist verifies.
      line: stat ? medLine(o) : undefined,
    });
    await markUnderTreatment(admissionId);
    return orderOut(o);
  });
}

export async function listOrders(admissionId, { status } = {}) {
  const filter = { admissionId };
  if (status) filter.status = { $in: status.split(',') };
  const items = await MedOrder.find(filter).sort({ createdAt: -1 }).lean();
  return { items: items.map(orderOut), total: items.length, page: 1, limit: 200 };
}

/** Pharmacist verification (rule R11): the doses for the next two days go on the MAR. */
/** The order as a pharmacy line (what to issue for the stay). */
const medLine = (o) => ({
  orderId: String(o._id),
  drugId: o.drug.drugId,
  brand: o.drug.brand,
  generic: o.drug.generic,
  dose: o.dose,
  frequency: o.frequency,
  days: o.endAt ? Math.max(1, Math.round((o.endAt - o.startAt) / 86_400_000)) : undefined,
  route: o.route,
});

export async function verifyOrder(orderId, { decision = 'VERIFY', reason }) {
  const o = await MedOrder.findById(orderId);
  if (!o) throw errors.notFound('Medicine order');
  if (o.status !== 'ORDERED')
    throw new AppError(409, 'INVALID_STATE', `This order is ${o.status.toLowerCase()}.`);
  if (decision === 'REJECT') {
    if (!reason)
      throw errors.validation([{ path: 'reason', message: 'Give the reason for rejecting' }]);
    o.status = 'REJECTED';
    o.stopReason = reason;
    o.verifiedBy = await userName();
    o.verifiedAt = new Date();
    await o.save();
    await publish('ipd.medicine.rejected', {
      orderId: String(o._id),
      admissionId: String(o.admissionId),
      reason,
    });
    return orderOut(o);
  }
  o.status = 'VERIFIED';
  o.verifiedBy = await userName();
  o.verifiedAt = new Date();
  await o.save();
  await scheduleDoses(o, new Date(Date.now() + 48 * 3_600_000));
  if (!o.stat)
    await publish('ipd.medicine.verified', {
      orderId: String(o._id),
      admissionId: String(o.admissionId),
      line: medLine(o),
    });
  return orderOut(o);
}

export async function stopOrder(orderId, { reason }) {
  const o = await MedOrder.findById(orderId);
  if (!o) throw errors.notFound('Medicine order');
  if (['STOPPED', 'REJECTED'].includes(o.status))
    throw new AppError(409, 'INVALID_STATE', 'This order has already ended.');
  o.status = 'STOPPED';
  o.stoppedBy = await userName();
  o.stopReason = reason;
  o.endAt = new Date();
  await o.save();
  await MarDose.deleteMany({ orderId: o._id, status: 'DUE', dueAt: { $gt: new Date() } });
  return orderOut(o);
}

/** Puts the scheduled doses of a verified order on the MAR up to `until` (never twice). */
async function scheduleDoses(o, until) {
  if (o.prn || o.stat || !o.times?.length) return;
  const start = new Date(Math.max(o.startAt.getTime(), Date.now() - 60 * 60_000));
  const end = o.endAt && o.endAt < until ? o.endAt : until;
  const docs = [];
  for (
    let d = ymdIST(start);
    atIST(d) <= end;
    d = ymdIST(new Date(atIST(d).getTime() + 86_400_000))
  )
    for (const t of o.times) {
      const at = atIST(d, t);
      if (at >= start && at <= end)
        docs.push({ orderId: o._id, admissionId: o.admissionId, dueAt: at });
    }
  if (!docs.length) return;
  try {
    await MarDose.insertMany(docs, { ordered: false });
  } catch (e) {
    if (e?.code !== 11000 && !e?.writeErrors) throw e;
  }
}

/** MAR for a day: the stay's verified orders with their doses (late after 30 minutes). */
export async function mar(admissionId, { date = ymdIST() } = {}) {
  const from = atIST(date);
  const to = new Date(from.getTime() + 86_400_000);
  const orders = await MedOrder.find({
    admissionId,
    status: { $in: ['ORDERED', 'VERIFIED', 'STOPPED'] },
  }).lean();
  for (const o of orders) if (o.status === 'VERIFIED') await scheduleDoses(o, to);
  const doses = await MarDose.find({ admissionId, dueAt: { $gte: from, $lt: to } })
    .sort({ dueAt: 1 })
    .lean();
  const now = Date.now();
  return {
    date,
    orders: orders.map((o) => ({
      ...orderOut(o),
      doses: doses
        .filter((d) => String(d.orderId) === String(o._id))
        .map((d) => ({
          id: String(d._id),
          dueAt: d.dueAt,
          status: d.status,
          late: d.status === 'DUE' && now - d.dueAt.getTime() > 30 * 60_000,
          givenAt: d.givenAt ?? null,
          givenBy: d.givenBy ?? null,
          witness: d.witness ?? null,
          reason: d.reason ?? null,
        })),
    })),
  };
}

/**
 * Gives (or holds or records a refusal of) a dose. Rule R11: the wristband scan must be this
 * patient's UHID or IP number and the order verified (STAT excepted). Rule R12: a high-alert
 * medicine needs a second nurse who is not the one giving it. A held or refused dose needs a reason.
 */
export async function administer(doseId, body) {
  const name = await userName();
  return withTransaction(async () => {
    const d = await MarDose.findById(doseId);
    if (!d) throw errors.notFound('Dose');
    if (d.status !== 'DUE')
      throw new AppError(
        409,
        'DOSE_ALREADY_RECORDED',
        `This dose is already ${d.status.toLowerCase()}.`,
      );
    const o = await MedOrder.findById(d.orderId).lean();
    const a = await Admission.findById(d.admissionId).lean();
    if (!ACTIVE.includes(a.status)) throw new AppError(409, 'INVALID_STATE', 'The stay is closed.');
    const status = body.status ?? 'GIVEN';
    if (status === 'GIVEN') {
      const scanned = String(body.wristband ?? '')
        .trim()
        .toUpperCase();
      if (
        !scanned ||
        ![a.patient.uhid, a.ipNo].map((x) => String(x).toUpperCase()).includes(scanned)
      )
        throw new AppError(
          409,
          'WRONG_PATIENT',
          'The wristband does not match this patient. Do not give the dose.',
        );
      // A scheduled dose is given from an hour before it is due (STAT and PRN any time).
      if (!o.stat && !o.prn && d.dueAt.getTime() - Date.now() > 60 * 60_000)
        throw new AppError(
          409,
          'TOO_EARLY',
          'This dose is not due yet. Give it within an hour of its time.',
        );
      if (o.status !== 'VERIFIED' && !o.stat)
        throw new AppError(
          409,
          'NOT_VERIFIED',
          'The pharmacist has not verified this order yet (rule R11).',
        );
      if (body.drugScan && o.drug.drugId && ![o.drug.drugId, o.drug.brand].includes(body.drugScan))
        throw new AppError(409, 'WRONG_MEDICINE', `The scanned medicine is not ${o.drug.brand}.`);
      if (
        o.highAlert &&
        (!body.witness || body.witness.trim().toLowerCase() === name.toLowerCase())
      )
        throw new AppError(
          409,
          'WITNESS_REQUIRED',
          'A high-alert medicine needs a second nurse to confirm (rule R12).',
        );
    } else if (!body.reason?.trim()) {
      throw errors.validation([
        { path: 'reason', message: 'Give the reason the dose was held or refused' },
      ]);
    }
    d.status = status;
    d.givenAt = new Date();
    d.givenBy = name;
    d.witness = body.witness;
    d.reason = body.reason;
    d.scan = { wristband: body.wristband, drug: body.drugScan };
    await d.save();
    return {
      id: String(d._id),
      status: d.status,
      givenAt: d.givenAt,
      givenBy: d.givenBy,
      witness: d.witness ?? null,
    };
  });
}

// ---------------------------------------------------------------- ward census

export async function wards() {
  const wf = { isActive: true };
  if (current().branchId) wf.branchId = current().branchId;
  const list = await Ward.find(wf).sort({ name: 1 }).lean();
  const counts = await Admission.aggregate([
    { $match: { status: { $in: ACTIVE }, 'bed.wardId': { $in: list.map((w) => w._id) } } },
    { $group: { _id: '$bed.wardId', n: { $sum: 1 } } },
  ]);
  const beds = await Bed.aggregate([
    { $match: { wardId: { $in: list.map((w) => w._id) }, isActive: true } },
    { $group: { _id: '$wardId', n: { $sum: 1 } } },
  ]);
  const of = (arr, w) => arr.find((c) => String(c._id) === String(w._id))?.n ?? 0;
  return {
    items: list.map((w) => ({
      id: String(w._id),
      name: w.name,
      category: w.category,
      patients: of(counts, w),
      beds: of(beds, w),
    })),
    total: list.length,
    page: 1,
    limit: 100,
  };
}

/**
 * Nursing census for a ward: each patient with the last NEWS2, doses due in the next two hours
 * and late ones, today's fluid balance and overdue assessments.
 */
export async function census(wardId) {
  const stays = await Admission.find({ 'bed.wardId': wardId, status: { $in: ACTIVE } })
    .sort({ 'bed.code': 1 })
    .lean();
  const ids = stays.map((a) => a._id);
  const now = Date.now();
  const [vitals, doses] = await Promise.all([
    IpdVitals.aggregate([
      { $match: { admissionId: { $in: ids } } },
      { $sort: { at: -1 } },
      { $group: { _id: '$admissionId', v: { $first: '$$ROOT' } } },
    ]),
    MarDose.find({
      admissionId: { $in: ids },
      status: 'DUE',
      dueAt: { $lte: new Date(now + 2 * 3_600_000) },
    }).lean(),
  ]);
  const out = [];
  for (const a of stays) {
    const v = vitals.find((x) => String(x._id) === String(a._id))?.v;
    const due = doses.filter((d) => String(d.admissionId) === String(a._id));
    const io = await ioToday(a._id);
    out.push({
      admissionId: String(a._id),
      ipNo: a.ipNo,
      bed: a.bed.code,
      patient: {
        id: String(a.patient.id),
        name: a.patient.name,
        uhid: a.patient.uhid,
        age: a.patient.age,
        gender: a.patient.gender,
        allergies: a.patient.allergies ?? [],
      },
      consultant: a.consultant?.name ?? null,
      day: daysBetween(a.admittedAt) + 1,
      status: a.status,
      news2: v ? { score: v.news2, risk: v.risk, at: v.at } : null,
      dosesDue: due.filter((d) => now - d.dueAt.getTime() <= 30 * 60_000).length,
      dosesLate: due.filter((d) => now - d.dueAt.getTime() > 30 * 60_000).length,
      fluidBalance: io.balance,
      assessmentsDue: await assessmentsDue(a),
    });
  }
  return { wardId: String(wardId), items: out, total: out.length };
}
