import { z } from 'zod';
import { withTransaction } from '../../../core/db/model.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { Department } from '../../setup/index.js';
import { Employee } from '../models/hr.models.js';
import {
  Appraisal,
  AppraisalCycle,
  Candidate,
  JobOpening,
  STAGES,
  TrainingSession,
} from '../models/talent.models.js';
import { createEmployee, myEmployee, todayIST, userName, ymd } from './hr.service.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const fullName = (e) => `${e.name.first}${e.name.last ? ` ${e.name.last}` : ''}`;
const stale = () => errors.conflict('VERSION_CONFLICT', 'Changed by someone else; reload.');
const checkVersion = (doc, version) => {
  if (version != null && doc.version !== version) throw stale();
};

// ---------------------------------------------------------------- recruitment

const openingOut = (o, counts = {}) => ({
  id: String(o._id),
  code: o.code ?? null,
  title: o.title,
  departmentId: o.departmentId ? String(o.departmentId) : null,
  department: o.department ?? null,
  type: o.type,
  positions: o.positions,
  description: o.description ?? null,
  status: o.status,
  version: o.version,
  pipeline: Object.fromEntries(STAGES.map((s) => [s, counts[s] ?? 0])),
  createdAt: o.createdAt,
});

export async function listOpenings({ status } = {}) {
  const rows = await JobOpening.find(status ? { status } : {})
    .sort({ createdAt: -1 })
    .lean();
  const counts = await Candidate.aggregate([
    { $match: { openingId: { $in: rows.map((r) => r._id) } } },
    { $group: { _id: { o: '$openingId', s: '$stage' }, n: { $sum: 1 } } },
  ]);
  const by = {};
  for (const c of counts) (by[String(c._id.o)] ??= {})[c._id.s] = c.n;
  return { items: rows.map((o) => openingOut(o, by[String(o._id)])) };
}

export const openingInput = z.object({
  title: z.string().trim().min(3).max(80),
  departmentId: z.string().optional(),
  type: z.enum(['PERMANENT', 'CONTRACT', 'CONSULTANT', 'TRAINEE']).default('PERMANENT'),
  positions: z.number().int().min(1).max(100).default(1),
  description: z.string().trim().max(1000).optional(),
});

async function departmentName(departmentId) {
  if (!departmentId) return undefined;
  return (await Department.findById(departmentId).select('name').lean())?.name;
}

export async function createOpening(input) {
  const [o] = await JobOpening.create([
    {
      ...input,
      department: await departmentName(input.departmentId),
      code: `JO-${String((await JobOpening.countDocuments({})) + 1).padStart(4, '0')}`,
    },
  ]);
  return openingOut(o.toObject());
}

export async function updateOpening(openingId, { version, status, positions }) {
  const o = await JobOpening.findById(openingId);
  if (!o) throw errors.notFound('Opening');
  checkVersion(o, version);
  if (status) o.status = status;
  if (positions) o.positions = positions;
  await o.save();
  return openingOut(o.toObject());
}

const candidateOut = (c) => ({
  id: String(c._id),
  openingId: String(c.openingId),
  name: c.name,
  mobile: c.mobile ?? null,
  email: c.email ?? null,
  source: c.source ?? null,
  experienceYears: c.experienceYears ?? null,
  stage: c.stage,
  interviews: c.interviews ?? [],
  offer: c.offer?.ctc != null ? c.offer : null,
  employeeId: c.employeeId ? String(c.employeeId) : null,
  log: c.log ?? [],
  version: c.version,
});

export async function listCandidates({ openingId }) {
  const rows = await Candidate.find({ openingId }).sort({ createdAt: -1 }).lean();
  return { items: rows.map(candidateOut) };
}

export const candidateInput = z.object({
  name: z.string().trim().min(2).max(80),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile')
    .optional(),
  email: z.email().optional(),
  source: z.string().trim().max(40).optional(),
  experienceYears: z.number().min(0).max(50).optional(),
});

export async function addCandidate(openingId, input) {
  const o = await JobOpening.findById(openingId).lean();
  if (!o) throw errors.notFound('Opening');
  if (o.status !== 'OPEN')
    throw new AppError(409, 'OPENING_NOT_OPEN', 'This opening is not taking candidates.');
  const [c] = await Candidate.create([
    {
      ...input,
      openingId,
      log: [{ at: new Date(), stage: 'APPLIED', by: await userName() }],
    },
  ]);
  return candidateOut(c.toObject());
}

/** Allowed moves: forward through the pipeline, or out (REJECTED) from any open stage. */
const NEXT = {
  APPLIED: ['SCREENED', 'REJECTED'],
  SCREENED: ['INTERVIEW', 'REJECTED'],
  INTERVIEW: ['INTERVIEW', 'OFFERED', 'REJECTED'],
  OFFERED: ['REJECTED'],
};

export const moveInput = z.object({
  version: z.number().int().min(0),
  stage: z.enum(['SCREENED', 'INTERVIEW', 'OFFERED', 'REJECTED']),
  note: z.string().trim().max(500).optional(),
  interview: z
    .object({
      rating: z.number().int().min(1).max(5),
      notes: z.string().trim().max(1000).optional(),
    })
    .optional(),
  offer: z.object({ ctc: z.number().int().min(1), joinOn: date }).optional(),
});

export async function moveCandidate(candidateId, input) {
  const c = await Candidate.findById(candidateId);
  if (!c) throw errors.notFound('Candidate');
  checkVersion(c, input.version);
  if (!(NEXT[c.stage] ?? []).includes(input.stage))
    throw new AppError(
      409,
      'INVALID_STAGE',
      `A ${c.stage} candidate cannot move to ${input.stage}.`,
    );
  if (input.stage === 'OFFERED' && !input.offer)
    throw errors.validation([
      { path: 'offer', message: 'An offer needs the CTC and joining date' },
    ]);
  const by = await userName();
  if (input.interview) c.interviews.push({ at: new Date(), by, ...input.interview });
  if (input.offer) c.offer = input.offer;
  c.stage = input.stage;
  c.log.push({ at: new Date(), stage: input.stage, by, note: input.note });
  await c.save();
  return candidateOut(c.toObject());
}

export const hireInput = z.object({
  version: z.number().int().min(0),
  gender: z.enum(['M', 'F', 'O']),
  designation: z.string().trim().max(60).optional(),
});

/** An offered candidate joins: the employee is created from the candidate and the offer. */
export async function hireCandidate(candidateId, input) {
  const c = await Candidate.findById(candidateId);
  if (!c) throw errors.notFound('Candidate');
  checkVersion(c, input.version);
  if (c.stage !== 'OFFERED')
    throw new AppError(409, 'INVALID_STAGE', 'Only an offered candidate can join.');
  const o = await JobOpening.findById(c.openingId);
  return withTransaction(async () => {
    const [first, ...rest] = c.name.split(' ');
    const e = await createEmployee({
      name: { first, ...(rest.length ? { last: rest.join(' ') } : {}) },
      gender: input.gender,
      mobile: c.mobile,
      email: c.email,
      departmentId: o?.departmentId ? String(o.departmentId) : undefined,
      designation: input.designation ?? o?.title,
      type: o?.type ?? 'PERMANENT',
      joinedOn: c.offer?.joinOn ?? todayIST(),
    });
    c.stage = 'JOINED';
    c.employeeId = e.id;
    c.log.push({ at: new Date(), stage: 'JOINED', by: await userName(), note: e.empNo });
    await c.save();
    if (o) {
      const joined = await Candidate.countDocuments({ openingId: o._id, stage: 'JOINED' });
      if (joined >= o.positions && o.status === 'OPEN') {
        o.status = 'CLOSED';
        await o.save();
      }
    }
    return { candidate: candidateOut(c.toObject()), employee: e };
  });
}

// ---------------------------------------------------------------- training

/** Mandatory topics every clinical and support employee must keep current. */
export const MANDATORY = [
  { topic: 'BLS', validMonths: 24 },
  { topic: 'FIRE', validMonths: 12 },
  { topic: 'INFECTION', validMonths: 12 },
  { topic: 'BMW', validMonths: 12 },
];

const sessionOut = (s) => ({
  id: String(s._id),
  title: s.title,
  topic: s.topic,
  mandatory: Boolean(s.mandatory),
  validMonths: s.validMonths ?? null,
  date: s.date,
  hours: s.hours ?? null,
  trainer: s.trainer ?? null,
  attendees: (s.attendees ?? []).map((a) => ({ ...a, employeeId: String(a.employeeId) })),
  version: s.version,
});

export async function listTraining({ from, to } = {}) {
  const filter = {};
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rows = await TrainingSession.find(filter).sort({ date: -1 }).limit(200).lean();
  return { items: rows.map(sessionOut), mandatory: MANDATORY };
}

export const trainingInput = z.object({
  title: z.string().trim().min(3).max(120),
  topic: z.string().trim().toUpperCase().min(2).max(30),
  date,
  hours: z.number().min(0.5).max(80).optional(),
  trainer: z.string().trim().max(80).optional(),
  employeeIds: z.array(z.string()).max(500).default([]),
  /** Or by employee number, as typed at the session. */
  empNos: z.array(z.string().trim().toUpperCase()).max(500).default([]),
});

export async function createTraining(input) {
  const rule = MANDATORY.find((m) => m.topic === input.topic);
  const emps = await Employee.find({
    $or: [{ _id: { $in: input.employeeIds } }, { empNo: { $in: input.empNos } }],
  })
    .select('name empNo')
    .lean();
  const found = new Set(emps.map((e) => e.empNo));
  const unknown = input.empNos.filter((n) => !found.has(n));
  if (unknown.length)
    throw errors.validation([{ path: 'empNos', message: `Not found: ${unknown.join(', ')}` }]);
  const [s] = await TrainingSession.create([
    {
      title: input.title,
      topic: input.topic,
      mandatory: Boolean(rule),
      validMonths: rule?.validMonths,
      date: input.date,
      hours: input.hours,
      trainer: input.trainer,
      attendees: emps.map((e) => ({ employeeId: e._id, name: fullName(e), attended: true })),
    },
  ]);
  return sessionOut(s.toObject());
}

export const attendanceInput = z.object({
  version: z.number().int().min(0),
  attendees: z
    .array(
      z.object({
        employeeId: z.string(),
        attended: z.boolean(),
        score: z.number().min(0).max(100).optional(),
      }),
    )
    .max(500),
});

/** Marks who attended a session (and scores); employees not yet on the list are added. */
export async function markTraining(sessionId, input) {
  const s = await TrainingSession.findById(sessionId);
  if (!s) throw errors.notFound('Training session');
  checkVersion(s, input.version);
  const emps = await Employee.find({ _id: { $in: input.attendees.map((a) => a.employeeId) } })
    .select('name')
    .lean();
  const names = new Map(emps.map((e) => [String(e._id), fullName(e)]));
  s.attendees = input.attendees
    .filter((a) => names.has(a.employeeId))
    .map((a) => ({ ...a, name: names.get(a.employeeId) }));
  await s.save();
  return sessionOut(s.toObject());
}

const addMonths = (ymdStr, n) => {
  const d = new Date(`${ymdStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Mandatory training compliance: for every active employee and mandatory topic, the last
 * attended session and when it lapses. Lists only the gaps (never trained, lapsed, lapsing in 30
 * days) plus the share compliant per topic.
 */
export async function trainingCompliance({ asOf = todayIST() } = {}) {
  const [emps, sessions] = await Promise.all([
    Employee.find({ status: { $ne: 'EXITED' } })
      .select('name empNo department designation')
      .lean(),
    TrainingSession.find({ mandatory: true }).select('topic date validMonths attendees').lean(),
  ]);
  const last = new Map(); // emp|topic -> latest date
  for (const s of sessions)
    for (const a of s.attendees ?? [])
      if (a.attended) {
        const k = `${a.employeeId}|${s.topic}`;
        if (!last.has(k) || last.get(k) < s.date) last.set(k, s.date);
      }
  const soon = addMonths(asOf, 1);
  const gaps = [];
  const topics = MANDATORY.map((m) => ({ ...m, compliant: 0, total: emps.length }));
  for (const e of emps)
    for (const t of topics) {
      const done = last.get(`${e._id}|${t.topic}`);
      const lapses = done ? addMonths(done, t.validMonths) : null;
      const status = !done ? 'NEVER' : lapses < asOf ? 'LAPSED' : lapses <= soon ? 'DUE' : 'OK';
      if (status === 'OK' || status === 'DUE') t.compliant += 1;
      if (status !== 'OK')
        gaps.push({
          employeeId: String(e._id),
          empNo: e.empNo,
          name: fullName(e),
          department: e.department ?? null,
          topic: t.topic,
          lastOn: done ?? null,
          lapsesOn: lapses,
          status,
        });
    }
  return {
    asOf,
    topics: topics.map((t) => ({
      topic: t.topic,
      validMonths: t.validMonths,
      compliant: t.compliant,
      total: t.total,
      percent: t.total ? Math.round((t.compliant * 100) / t.total) : 100,
    })),
    gaps: gaps.slice(0, 500),
  };
}

// ---------------------------------------------------------------- appraisal

const appraisalOut = (a) => ({
  id: String(a._id),
  cycleId: String(a.cycleId),
  employeeId: String(a.employeeId),
  name: a.name,
  empNo: a.empNo ?? null,
  designation: a.designation ?? null,
  managerId: a.managerId ? String(a.managerId) : null,
  managerName: a.managerName ?? null,
  goals: a.goals ?? [],
  selfComments: a.selfComments ?? null,
  managerComments: a.managerComments ?? null,
  selfRating: a.selfRating ?? null,
  managerRating: a.managerRating ?? null,
  finalRating: a.finalRating ?? null,
  status: a.status,
  version: a.version,
});

const cycleOut = (c, counts = {}) => ({
  id: String(c._id),
  name: c.name,
  from: c.from ?? null,
  to: c.to ?? null,
  status: c.status,
  version: c.version,
  progress: { SELF: 0, MANAGER: 0, HR: 0, DONE: 0, ...counts },
});

export async function listCycles() {
  const rows = await AppraisalCycle.find({}).sort({ createdAt: -1 }).lean();
  const counts = await Appraisal.aggregate([
    { $group: { _id: { c: '$cycleId', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const by = {};
  for (const c of counts) (by[String(c._id.c)] ??= {})[c._id.s] = c.n;
  return { items: rows.map((c) => cycleOut(c, by[String(c._id)])) };
}

export const cycleInput = z.object({
  name: z.string().trim().min(3).max(60),
  from: date,
  to: date,
  goals: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(120),
        weight: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(10)
    .refine((g) => g.reduce((t, x) => t + x.weight, 0) === 100, 'Goal weights must add up to 100'),
});

/** Opens a cycle with the common goals: one appraisal per active employee, with their manager. */
export async function openCycle(input) {
  if (await AppraisalCycle.exists({ status: 'OPEN' }))
    throw new AppError(409, 'CYCLE_OPEN', 'Close the open appraisal cycle first.');
  return withTransaction(async () => {
    const [c] = await AppraisalCycle.create([{ name: input.name, from: input.from, to: input.to }]);
    const emps = await Employee.find({ status: 'ACTIVE' })
      .select('name empNo designation managerId')
      .lean();
    const managers = new Map(
      (
        await Employee.find({ _id: { $in: emps.map((e) => e.managerId).filter(Boolean) } })
          .select('name')
          .lean()
      ).map((m) => [String(m._id), fullName(m)]),
    );
    await Appraisal.create(
      emps.map((e) => ({
        cycleId: c._id,
        employeeId: e._id,
        name: fullName(e),
        empNo: e.empNo,
        designation: e.designation,
        managerId: e.managerId,
        managerName: e.managerId ? managers.get(String(e.managerId)) : undefined,
        goals: input.goals,
      })),
      { ordered: true },
    );
    return cycleOut(c.toObject(), { SELF: emps.length });
  });
}

export async function listAppraisals({ cycleId, status }) {
  const filter = { cycleId };
  if (status) filter.status = status;
  const rows = await Appraisal.find(filter).sort({ name: 1 }).lean();
  return { items: rows.map(appraisalOut) };
}

const weighted = (goals, key) => {
  const rated = goals.filter((g) => g[key] != null);
  if (!rated.length) return null;
  const w = rated.reduce((t, g) => t + g.weight, 0);
  return Math.round((rated.reduce((t, g) => t + g[key] * g.weight, 0) / w) * 10) / 10;
};

const ratingsInput = z.object({
  version: z.number().int().min(0),
  ratings: z.array(z.number().int().min(1).max(5)).min(1).max(10),
  comments: z.string().trim().max(2000).optional(),
});
export const selfInput = ratingsInput;
export const managerInput = ratingsInput;

/** The employee's own open appraisal (My Space). */
export async function myAppraisal() {
  const me = await myEmployee();
  const cycle = await AppraisalCycle.findOne({ status: 'OPEN' }).lean();
  if (!cycle) return { cycle: null, appraisal: null, team: [] };
  const [mine, team] = await Promise.all([
    Appraisal.findOne({ cycleId: cycle._id, employeeId: me._id }).lean(),
    Appraisal.find({ cycleId: cycle._id, managerId: me._id }).sort({ name: 1 }).lean(),
  ]);
  return {
    cycle: cycleOut(cycle),
    appraisal: mine ? appraisalOut(mine) : null,
    team: team.map(appraisalOut),
  };
}

function rate(a, key, ratings) {
  if (ratings.length !== a.goals.length)
    throw errors.validation([{ path: 'ratings', message: 'Rate every goal' }]);
  a.goals = a.goals.map((g, i) => ({ ...(g.toObject?.() ?? g), [key]: ratings[i] }));
}

/** Self review: the employee rates each goal; it then goes to the manager (or HR if none). */
export async function submitSelf(appraisalId, input) {
  const me = await myEmployee();
  const a = await Appraisal.findById(appraisalId);
  if (!a || String(a.employeeId) !== String(me._id)) throw errors.notFound('Appraisal');
  checkVersion(a, input.version);
  if (a.status !== 'SELF') throw new AppError(409, 'INVALID_STATE', 'Self review is already in.');
  rate(a, 'self', input.ratings);
  a.selfRating = weighted(a.goals, 'self');
  a.selfComments = input.comments;
  a.status = a.managerId ? 'MANAGER' : 'HR';
  await a.save();
  return appraisalOut(a.toObject());
}

/** The manager's review of a direct report. */
export async function submitManager(appraisalId, input) {
  const me = await myEmployee();
  const a = await Appraisal.findById(appraisalId);
  if (!a || String(a.managerId) !== String(me._id)) throw errors.notFound('Appraisal');
  checkVersion(a, input.version);
  if (a.status !== 'MANAGER')
    throw new AppError(409, 'INVALID_STATE', 'This appraisal is not waiting for you.');
  rate(a, 'manager', input.ratings);
  a.managerRating = weighted(a.goals, 'manager');
  a.managerComments = input.comments;
  a.status = 'HR';
  await a.save();
  return appraisalOut(a.toObject());
}

export const finalInput = z.object({
  version: z.number().int().min(0),
  finalRating: z.number().min(1).max(5),
});

/** HR moderates and closes one appraisal. */
export async function finalise(appraisalId, input) {
  const a = await Appraisal.findById(appraisalId);
  if (!a) throw errors.notFound('Appraisal');
  checkVersion(a, input.version);
  if (a.status !== 'HR')
    throw new AppError(409, 'INVALID_STATE', 'The reviews are not complete yet.');
  a.finalRating = input.finalRating;
  a.status = 'DONE';
  await a.save();
  return appraisalOut(a.toObject());
}

export async function closeCycle(cycleId, { version }) {
  const c = await AppraisalCycle.findById(cycleId);
  if (!c) throw errors.notFound('Cycle');
  checkVersion(c, version);
  const open = await Appraisal.countDocuments({ cycleId, status: { $ne: 'DONE' } });
  if (open) throw new AppError(409, 'APPRAISALS_OPEN', `${open} appraisals are not finished yet.`);
  c.status = 'CLOSED';
  await c.save();
  return cycleOut(c.toObject());
}

// ---------------------------------------------------------------- exits

export const CLEARANCES = ['DEPARTMENT', 'IT', 'STORE', 'FINANCE', 'HR'];

const exitOut = (e) => {
  const done = new Map((e.clearance ?? []).map((c) => [c.dept, c]));
  return {
    id: String(e._id),
    empNo: e.empNo,
    name: fullName(e),
    department: e.department ?? null,
    designation: e.designation ?? null,
    status: e.status,
    exitOn: e.exitOn ? ymd(e.exitOn) : null,
    exitReason: e.exitReason ?? null,
    clearance: CLEARANCES.map((d) => ({
      dept: d,
      by: done.get(d)?.by ?? null,
      at: done.get(d)?.at ?? null,
      note: done.get(d)?.note ?? null,
    })),
    cleared: CLEARANCES.every((d) => done.has(d)),
    version: e.version,
  };
};

/** Employees serving notice or exited in the last 90 days, with their clearance checklist. */
export async function listExits() {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rows = await Employee.find({
    $or: [{ status: 'NOTICE' }, { status: 'EXITED', exitOn: { $gte: since } }],
  })
    .sort({ exitOn: 1 })
    .lean();
  return { items: rows.map(exitOut), clearances: CLEARANCES };
}

export const clearInput = z.object({
  version: z.number().int().min(0),
  dept: z.enum(CLEARANCES),
  note: z.string().trim().max(200).optional(),
});

export async function clearExit(employeeId, input) {
  const e = await Employee.findById(employeeId);
  if (!e) throw errors.notFound('Employee');
  checkVersion(e, input.version);
  if (e.status === 'ACTIVE')
    throw new AppError(409, 'INVALID_STATE', 'This employee has not resigned.');
  if ((e.clearance ?? []).some((c) => c.dept === input.dept))
    throw new AppError(409, 'ALREADY_CLEARED', `${input.dept} has already cleared.`);
  const by = await userName();
  e.clearance.push({ dept: input.dept, by, at: new Date(), note: input.note });
  e.history.push({ at: new Date(), kind: 'CLEARANCE', text: `${input.dept} cleared`, by });
  await e.save();
  return exitOut(e.toObject());
}
