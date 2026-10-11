import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { User } from '../../../core/auth/models/user.model.js';
import { Appointment, OpdVisit } from '../models/opd.models.js';
import { doctorIdFor, ymdIST } from './common.js';
import { appointmentOut, queueEntry, visitOut } from './dto.js';
import { activeDoctors } from './schedule.service.js';
import { triageRequired } from './settings.service.js';
import { doctorCards, doctorOut } from './common.js';

const STAGE_ORDER = { WITH_DOCTOR: 0, CALLED: 1, TRIAGED: 2, IN_TRIAGE: 3, WAITING: 4, DONE: 9 };
const PRIORITY_ORDER = { RED: 0, AMBER: 1, GREEN: 2 };

/** Rule R11: red first, then booked on time, then walk-ins, then late arrivals. */
function queueSort(a, b) {
  const s = (STAGE_ORDER[a.stage] ?? 5) - (STAGE_ORDER[b.stage] ?? 5);
  if (s) return s;
  if (a.priority === 'RED' || b.priority === 'RED')
    return (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
  const l = Number(a.late) - Number(b.late);
  if (l) return l;
  const w = Number(a.walkIn) - Number(b.walkIn);
  if (w) return w;
  return new Date(a.checkedInAt) - new Date(b.checkedInAt);
}

export async function findVisit(id) {
  const v = await OpdVisit.findById(id);
  if (!v) throw errors.notFound('Visit');
  return v;
}

/**
 * GET /opd/queue: stage=triage (nurse), doctor (consult room) or all (the day's list with the
 * bookings that have not arrived yet, in slot order).
 */
export async function queue({ doctorId, stage }) {
  const date = ymdIST();
  const doc = await doctorIdFor(doctorId);
  const filter = { date };
  if (doc) filter['doctor.id'] = doc;
  if (stage === 'triage') filter.stage = { $in: ['WAITING', 'IN_TRIAGE'] };
  if (stage === 'doctor') filter.stage = { $in: ['TRIAGED', 'CALLED', 'WITH_DOCTOR'] };
  const visits = (await OpdVisit.find(filter).lean()).sort(queueSort).map(queueEntry);
  if (stage && stage !== 'all') return { items: visits, total: visits.length, page: 1, limit: 100 };
  const af = { date, status: { $in: ['BOOKED', 'CONFIRMED'] } };
  if (doc) af['doctor.id'] = doc;
  const waiting = (await Appointment.find(af).sort({ time: 1 }).lean()).map((a) => {
    const out = appointmentOut(a);
    return {
      visitId: null,
      appointmentId: out.id,
      token: null,
      patient: out.patient,
      doctor: out.doctor,
      visitType: a.visitType,
      walkIn: false,
      late: false,
      stage: 'NOT_ARRIVED',
      status: a.status,
      priority: null,
      slotTime: a.time,
      waitedMin: null,
      feeDue: a.fee.paid ? 0 : a.fee.amount,
    };
  });
  const items = [...visits, ...waiting];
  return { items, total: items.length, page: 1, limit: Math.max(100, items.length) };
}

/** The waiting-area TV: each room's token now and next, plus the counter tokens. */
export async function display() {
  const date = ymdIST();
  const doctors = await activeDoctors();
  const cards = await doctorCards(doctors);
  const visits = await OpdVisit.find({
    date,
    stage: { $in: ['TRIAGED', 'CALLED', 'WITH_DOCTOR'] },
  }).lean();
  const rooms = cards
    .map((card) => {
      const q = visits.filter((v) => String(v.doctor.id) === String(card.id)).sort(queueSort);
      const now = q.find((x) => x.stage === 'WITH_DOCTOR' || x.stage === 'CALLED');
      const next = q.find((x) => x !== now && x.stage === 'TRIAGED');
      return {
        doctor: doctorOut(card),
        now: now?.token ?? null,
        next: next?.token ?? null,
        active: q.length > 0,
      };
    })
    .filter((r) => r.active)
    .map(({ active: _a, ...r }) => r);
  const tenant = await Tenant.findById(current().tenantId).select('name').lean();
  return {
    hospital: tenant?.name ?? null,
    title: 'OPD',
    rooms,
    counters: [],
    updatedAt: new Date().toISOString(),
  };
}

/** A visit with the patient's past OPD visits and BP / weight trend. */
export async function getVisit(id) {
  const v = await findVisit(id);
  const past = await OpdVisit.find({
    'patient.id': v.patient.id,
    _id: { $ne: v._id },
    stage: 'DONE',
  })
    .sort({ date: -1 })
    .limit(10)
    .lean();
  const history = past.map((p) => ({
    id: String(p._id),
    date: p.closedAt ?? p.checkedInAt,
    kind: 'OPD',
    title: p.doctor?.name,
    note:
      p.consultation?.diagnoses?.map((d) => d.name).join(', ') ||
      p.consultation?.complaints ||
      p.complaint ||
      '',
  }));
  const vitalsTrend = [...past, v.toObject()]
    .filter((p) => p.vitals?.bp || p.vitals?.weightKg)
    .sort((a, b) => new Date(a.checkedInAt) - new Date(b.checkedInAt))
    .map((p) => ({
      date: p.checkedInAt,
      bp: p.vitals.bp ?? null,
      weightKg: p.vitals.weightKg ?? null,
    }));
  return visitOut(v, {
    history,
    vitalsTrend,
    triageRequired: await triageRequired(v.doctor?.department),
  });
}

export async function startTriage(id) {
  const v = await findVisit(id);
  if (!['WAITING', 'IN_TRIAGE'].includes(v.stage))
    throw new AppError(409, 'INVALID_STATE', 'Triage is done for this patient.');
  // A nurse works on one patient at a time: the previous one goes back to waiting.
  await OpdVisit.updateMany(
    {
      date: v.date,
      stage: 'IN_TRIAGE',
      _id: { $ne: v._id },
      'vitals.recordedBy': { $exists: false },
    },
    { $set: { stage: 'WAITING' } },
  );
  v.stage = 'IN_TRIAGE';
  v.triageStartedAt ??= new Date();
  await v.save();
  return visitOut(v);
}

const bmiOf = (w, h) => (w && h ? Math.round((w / (h / 100) ** 2) * 10) / 10 : null);

/** Vitals and priority (a red flag needs a reason and alerts the doctor). */
export async function saveVitals(id, body) {
  if (body.priority === 'RED' && !String(body.priorityReason ?? '').trim())
    throw errors.validation([
      { path: 'priorityReason', message: 'Give the reason for a red flag.' },
    ]);
  const user = await User.findById(current().userId).select('name').lean();
  return withTransaction(async () => {
    const v = await findVisit(id);
    if (v.stage === 'DONE') throw new AppError(409, 'INVALID_STATE', 'This visit is closed.');
    v.vitals = {
      ...body,
      bmi: bmiOf(body.weightKg, body.heightCm),
      recordedAt: new Date(),
      recordedBy: user?.name ?? 'Staff',
    };
    v.priority = body.priority ?? 'GREEN';
    if (body.complaint) v.complaint = body.complaint;
    if (['WAITING', 'IN_TRIAGE'].includes(v.stage)) v.stage = 'TRIAGED';
    if (v.status === 'OPEN') v.status = 'TRIAGE_DONE';
    await v.save();
    if (v.priority === 'RED')
      await publish('opd.visit.redFlag', {
        visitId: String(v._id),
        doctorId: String(v.doctor.id),
        reason: body.priorityReason,
      });
    return visitOut(v);
  });
}

export async function skipTriage(id, { reason }) {
  const user = await User.findById(current().userId).select('name').lean();
  const v = await findVisit(id);
  if (!['WAITING', 'IN_TRIAGE'].includes(v.stage))
    throw new AppError(409, 'INVALID_STATE', 'Triage is done for this patient.');
  v.triageSkipped = { reason, by: user?.name ?? 'Staff', at: new Date() };
  v.stage = 'TRIAGED';
  await v.save();
  return visitOut(v);
}

export async function recordProcedure(id, body) {
  const user = await User.findById(current().userId).select('name').lean();
  const v = await findVisit(id);
  v.procedures.push({ ...body, recordedAt: new Date(), by: user?.name ?? 'Staff' });
  await v.save();
  const p = v.procedures.at(-1).toObject();
  return { id: String(p._id), ...p, _id: undefined };
}

/** The doctor calls a patient in (TV and SMS update); the visit is now with the doctor. */
export async function call(id) {
  return withTransaction(async () => {
    const v = await findVisit(id);
    if (v.stage === 'DONE') throw new AppError(409, 'INVALID_STATE', 'This visit is closed.');
    v.stage = 'WITH_DOCTOR';
    v.calledAt = new Date();
    v.consultStartedAt ??= new Date();
    await v.save();
    if (v.appointmentId)
      await Appointment.updateOne({ _id: v.appointmentId }, { $set: { status: 'IN_CONSULT' } });
    await publish('opd.queue.called', {
      visitId: String(v._id),
      token: v.token,
      room: v.doctor.room,
    });
    return visitOut(v);
  });
}

/** Not answering when called: back in the queue after the next on-time patient (rule R6). */
export async function skip(id, { reason }) {
  const v = await findVisit(id);
  v.late = true;
  v.skipReason = reason ?? '';
  if (['WITH_DOCTOR', 'CALLED'].includes(v.stage)) v.stage = 'TRIAGED';
  await v.save();
  return visitOut(v);
}

/** Rule R11: a manual move to the top needs a reason and is audited. */
export async function move(id, { reason }) {
  if (!String(reason ?? '').trim())
    throw errors.validation([
      { path: 'reason', message: 'A queue move needs a reason (rule R11).' },
    ]);
  const v = await findVisit(id);
  v.priority = 'RED';
  v.moveReason = reason;
  await v.save();
  return visitOut(v);
}
