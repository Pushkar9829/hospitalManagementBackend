import { randomBytes } from 'node:crypto';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber, nextNumber } from '../../../core/sequences/sequence.service.js';
import { current } from '../../../core/tenancy/context.js';
import { Patient, patientCard } from '../../patients/index.js';
import { OpdVisit } from '../../opd/index.js';
import { Enquiry, FoCounter, FoToken, VisitorPass } from '../models/frontoffice.models.js';

const DEFAULT_COUNTERS = [
  ['Registration', 'R-'],
  ['Billing 1', 'B-'],
  ['Pharmacy', 'P-'],
  ['Sample collection', 'S-'],
  ['Radiology', 'X-'],
];

const ymdIST = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const hhmmIST = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(11, 16);
const addDays = (ymd, n) =>
  ymdIST(new Date(new Date(`${ymd}T12:00:00+05:30`).getTime() + n * 86_400_000));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- counters and tokens

async function countersOfBranch() {
  const branchId = current().branchId ?? null;
  let list = await FoCounter.find({ branchId, isActive: true }).sort({ order: 1 }).lean();
  if (!list.length) {
    try {
      await FoCounter.create(
        DEFAULT_COUNTERS.map(([name, prefix], order) => ({ name, prefix, order, branchId })),
      );
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
    list = await FoCounter.find({ branchId, isActive: true }).sort({ order: 1 }).lean();
  }
  return list;
}

/** Counters with the token now serving, how many wait and the average service time today. */
export async function counters() {
  const date = ymdIST();
  const list = await countersOfBranch();
  const tokens = await FoToken.find({ counterId: { $in: list.map((c) => c._id) }, date }).lean();
  const items = list.map((c) => {
    const own = tokens.filter((t) => String(t.counterId) === String(c._id));
    const called = own.filter((t) => t.calledAt).sort((a, b) => b.calledAt - a.calledAt);
    const served = own.filter((t) => t.doneAt && t.calledAt);
    const avg = served.length
      ? Math.round(served.reduce((s, t) => s + (t.doneAt - t.calledAt) / 60000, 0) / served.length)
      : null;
    return {
      id: String(c._id),
      name: c.name,
      prefix: c.prefix,
      current: called[0]?.no ?? null,
      waiting: own.filter((t) => t.status === 'WAITING').length,
      avgMin: avg,
    };
  });
  return { items, total: items.length, page: 1, limit: 100 };
}

export async function issueToken({ counterId, name, mobile }) {
  const c = await FoCounter.findById(counterId).lean();
  if (!c?.isActive) throw errors.validation([{ path: 'counterId', message: 'Choose a counter' }]);
  const date = ymdIST();
  const seq = await nextNumber(`FO-TOKEN-${c._id}-${date}`, { branchId: c.branchId ?? null });
  const [t] = await FoToken.create([
    { counterId: c._id, date, seq, no: `${c.prefix}${String(seq).padStart(3, '0')}`, name, mobile },
  ]);
  const ahead = await FoToken.countDocuments({
    counterId: c._id,
    date,
    status: 'WAITING',
    seq: { $lt: seq },
  });
  return { id: String(t._id), no: t.no, counter: c.name, ahead, issuedAt: t.createdAt };
}

/** Closes the token being served and calls the next one (the counter TV and voice call update). */
export async function callNext(counterId) {
  return withTransaction(async () => {
    const c = await FoCounter.findById(counterId).lean();
    if (!c) throw errors.notFound('Counter');
    const date = ymdIST();
    const now = new Date();
    await FoToken.updateMany(
      { counterId: c._id, date, status: 'CALLED' },
      { $set: { status: 'DONE', doneAt: now } },
    );
    const next = await FoToken.findOneAndUpdate(
      { counterId: c._id, date, status: 'WAITING' },
      { $set: { status: 'CALLED', calledAt: now } },
      { sort: { seq: 1 }, new: true },
    );
    if (!next) throw new AppError(409, 'QUEUE_EMPTY', `Nobody is waiting at ${c.name}`);
    await publish('frontoffice.token.called', {
      counterId: String(c._id),
      counter: c.name,
      token: next.no,
    });
    return { counter: c.name, current: next.no, name: next.name ?? null };
  });
}

// ---------------------------------------------------------------- enquiries

const enquiryOut = (e) => ({
  id: String(e._id),
  time: hhmmIST(e.at),
  at: e.at,
  caller: e.caller ?? null,
  mobile: e.mobile ?? null,
  topic: e.topic,
  category: e.category ?? 'OTHER',
  channel: e.channel,
  outcome: e.outcome,
  notes: e.notes ?? null,
});

export async function listEnquiries({ date = ymdIST(), q, page = 1, limit = 25 }) {
  const filter = { date };
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ caller: rx }, { topic: rx }, { mobile: rx }];
  }
  const [items, total] = await Promise.all([
    Enquiry.find(filter)
      .sort({ at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Enquiry.countDocuments(filter),
  ]);
  return { items: items.map(enquiryOut), total, page, limit };
}

/** Logs an enquiry; a lead goes to CRM by event once CRM is built (Phase 6). */
export async function logEnquiry(input) {
  const at = new Date();
  const [e] = await Enquiry.create([{ ...input, at, date: ymdIST(at) }]);
  if (input.outcome === 'LEAD')
    await publish('frontoffice.enquiry.lead', {
      enquiryId: String(e._id),
      caller: input.caller,
      mobile: input.mobile,
      topic: input.topic,
    });
  return enquiryOut(e);
}

/** Enquiry history: one row per day with the busiest topic. */
export async function enquirySummary({ days = 7 }) {
  const to = ymdIST();
  const from = addDays(to, -(days - 1));
  const rows = await Enquiry.find({ date: { $gte: from, $lte: to } }).lean();
  const byDay = new Map();
  for (const e of rows) {
    const d = byDay.get(e.date) ?? {
      date: e.date,
      enquiries: 0,
      booked: 0,
      leads: 0,
      topics: new Map(),
    };
    d.enquiries++;
    if (e.outcome === 'BOOKED') d.booked++;
    if (e.outcome === 'LEAD') d.leads++;
    const k = e.category ?? 'OTHER';
    d.topics.set(k, (d.topics.get(k) ?? 0) + 1);
    byDay.set(e.date, d);
  }
  const items = [...byDay.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ topics, ...d }) => ({
      ...d,
      topTopic: [...topics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }));
  return { items, total: items.length, page: 1, limit: days };
}

// ---------------------------------------------------------------- visitor passes

const passOut = (p) => ({
  id: String(p._id),
  passNo: p.passNo,
  patient: { id: String(p.patient.id), uhid: p.patient.uhid, name: p.patient.name },
  bed: p.bed ?? null,
  visitor: p.visitor,
  type: p.type,
  qr: p.qr,
  validUntil: p.validUntil,
  status: p.status === 'INSIDE' && p.validUntil < new Date() ? 'EXPIRED' : p.status,
  inAt: p.inAt,
  outAt: p.outAt ?? null,
});

const PASS_HOURS = { ATTENDANT: 24, VISITOR: 3 };
/** Attendants allowed at once per patient (semi-private beds allow 1 attendant). */
const MAX_ATTENDANTS = 1;

export async function issuePass({ patientId, bed, visitor, type }) {
  const p = await Patient.findById(patientId).lean();
  if (!p) throw errors.validation([{ path: 'patientId', message: 'Pick the patient' }]);
  if (type === 'ATTENDANT') {
    const inside = await VisitorPass.countDocuments({
      'patient.id': p._id,
      type: 'ATTENDANT',
      status: 'INSIDE',
      validUntil: { $gt: new Date() },
    });
    if (inside >= MAX_ATTENDANTS)
      throw new AppError(
        409,
        'ATTENDANT_LIMIT',
        'This patient already has an attendant inside. Mark the current pass out first.',
      );
  }
  const now = new Date();
  const card = patientCard(p);
  const [pass] = await VisitorPass.create([
    {
      passNo: await documentNumber('VP'),
      patient: { id: p._id, uhid: card.uhid, name: card.name },
      bed,
      visitor,
      type,
      qr: randomBytes(12).toString('base64url'),
      validUntil: new Date(now.getTime() + PASS_HOURS[type] * 3_600_000),
      inAt: now,
    },
  ]);
  if (visitor.mobile)
    await publish('frontoffice.pass.issued', {
      passId: String(pass._id),
      mobile: visitor.mobile,
      qr: pass.qr,
    });
  return passOut(pass);
}

export async function listPasses({ status = 'INSIDE', page = 1, limit = 25 }) {
  const filter = status === 'ALL' ? {} : { status };
  const [items, total] = await Promise.all([
    VisitorPass.find(filter)
      .sort({ inAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    VisitorPass.countDocuments(filter),
  ]);
  return { items: items.map(passOut), total, page, limit };
}

export async function markOut(id) {
  const p = await VisitorPass.findById(id);
  if (!p) throw errors.notFound('Pass');
  if (p.status !== 'INSIDE') throw new AppError(409, 'INVALID_STATE', 'This pass is not inside');
  p.status = 'OUT';
  p.outAt = new Date();
  await p.save();
  return passOut(p);
}

/** Visitor log for a day: who came in and out, for which patient. */
export async function visitorLog({ date = ymdIST(), page = 1, limit = 50 }) {
  const start = new Date(`${date}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 86_400_000);
  const filter = { inAt: { $gte: start, $lt: end } };
  const [items, total] = await Promise.all([
    VisitorPass.find(filter)
      .sort({ inAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    VisitorPass.countDocuments(filter),
  ]);
  return { items: items.map(passOut), total, page, limit };
}

/** Revokes a patient's passes (on discharge, from IPD). */
export async function revokeForPatient(patientId) {
  await VisitorPass.updateMany(
    { 'patient.id': patientId, status: 'INSIDE' },
    { $set: { status: 'REVOKED', outAt: new Date() } },
  );
}

/**
 * Patient locator: where a patient is now, with no clinical details. VIP and medico-legal
 * patients are hidden. Admitted patients come from IPD (Phase 3) through `registerLocator`;
 * patients in OPD today show their doctor's room.
 */
const locators = [];
export const registerLocator = (fn) => locators.push(fn);

export async function locate({ q }) {
  if (!q || q.trim().length < 2) return { items: [], total: 0, page: 1, limit: 20 };
  const rx = new RegExp(escape(q.trim()), 'i');
  const patients = await Patient.find({
    status: 'ACTIVE',
    'flags.vip': { $ne: true },
    'flags.mlc': { $ne: true },
    $or: [{ uhid: rx }, { 'name.first': rx }, { 'name.last': rx }],
  })
    .limit(20)
    .lean();
  const ids = patients.map((p) => p._id);
  const where = new Map();
  for (const fn of locators) for (const [pid, loc] of await fn(ids)) where.set(String(pid), loc);
  const today = ymdIST();
  const opd = await OpdVisit.find({
    'patient.id': { $in: ids },
    date: today,
    stage: { $ne: 'DONE' },
  }).lean();
  for (const v of opd)
    if (!where.has(String(v.patient.id)))
      where.set(String(v.patient.id), {
        area: 'OPD',
        place: `${v.doctor?.department ?? 'OPD'} · room ${v.doctor?.room ?? '-'}`,
        bed: null,
        visiting: null,
      });
  const items = patients
    .filter((p) => where.has(String(p._id)))
    .map((p) => ({
      patient: { id: String(p._id), ...(({ uhid, name }) => ({ uhid, name }))(patientCard(p)) },
      ...where.get(String(p._id)),
    }));
  return { items, total: items.length, page: 1, limit: 20 };
}
