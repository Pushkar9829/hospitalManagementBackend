import { z } from 'zod';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Department, Holiday, numbering } from '../../setup/index.js';
import {
  Attendance,
  AttendanceLock,
  Employee,
  HrSettings,
  LeaveBalance,
  LeaveRequest,
  RosterCell,
  ShiftSwap,
} from '../models/hr.models.js';

const DAY = 86_400_000;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const ymd = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const todayIST = () => ymd(new Date());
const dateOf = (s) => new Date(`${s}T00:00:00+05:30`);
const addDays = (s, n) => ymd(dateOf(s).getTime() + n * DAY + 12 * 3_600_000);
export const daysOfMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};
const weekday = (s) => new Date(`${s}T12:00:00+05:30`).getUTCDay();
const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** Update the row matching `filter`, or create it (upserts clash with the version increment). */
async function put(Model, filter, set, insertOnly = {}) {
  const found = await Model.findOne(filter);
  if (found) {
    found.set(set);
    await found.save();
    return found;
  }
  try {
    return (await Model.create([{ ...filter, ...insertOnly, ...set }]))[0];
  } catch (e) {
    if (e?.code !== 11000) throw e;
    const again = await Model.findOne(filter);
    again.set(set);
    await again.save();
    return again;
  }
}

export async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

export async function settingsDoc() {
  const found = await HrSettings.findOne();
  if (found) return found;
  try {
    return (await HrSettings.create([{}]))[0];
  } catch (e) {
    if (e?.code === 11000) return HrSettings.findOne();
    throw e;
  }
}

// ---------------------------------------------------------------- employees

export const employeeInput = z.object({
  name: z.object({
    first: z.string().trim().min(1).max(60),
    last: z.string().trim().max(60).optional(),
  }),
  gender: z.enum(['M', 'F', 'O']),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile')
    .optional(),
  email: z.email().optional(),
  departmentId: z.string().optional(),
  designation: z.string().trim().max(60).optional(),
  grade: z.string().trim().max(20).optional(),
  type: z.enum(['PERMANENT', 'CONTRACT', 'CONSULTANT', 'TRAINEE']).default('PERMANENT'),
  managerId: z.string().optional(),
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  probationMonths: z.number().int().min(0).max(24).optional(),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN')
    .optional(),
  uan: z
    .string()
    .trim()
    .regex(/^\d{12}$/, 'UAN has 12 digits')
    .optional(),
  esiNo: z
    .string()
    .trim()
    .regex(/^\d{10,17}$/, 'Enter the ESI number')
    .optional(),
  aadhaar: z
    .string()
    .trim()
    .regex(/^\d{12}$/, 'Aadhaar has 12 digits')
    .optional(),
  bank: z
    .object({
      name: z.string().trim().max(60),
      accountNo: z
        .string()
        .trim()
        .regex(/^\d{6,18}$/, 'Enter the account number'),
      ifsc: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC'),
    })
    .optional(),
  registration: z
    .object({
      council: z.string().trim().max(60),
      number: z.string().trim().max(40),
      expiresOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .optional(),
  state: z.string().trim().toUpperCase().length(2).default('MH'),
  userId: z.string().optional(),
});

export const employeeOut = (e) => ({
  id: String(e._id),
  empNo: e.empNo,
  userId: e.userId ? String(e.userId) : null,
  name: `${e.name.first}${e.name.last ? ` ${e.name.last}` : ''}`,
  first: e.name.first,
  last: e.name.last ?? null,
  gender: e.gender ?? null,
  dob: e.dob ? ymd(e.dob) : null,
  mobile: e.mobile ?? null,
  email: e.email ?? null,
  address: e.address ?? null,
  emergencyContact: e.emergencyContact?.name ? e.emergencyContact : null,
  departmentId: e.departmentId ? String(e.departmentId) : null,
  department: e.department ?? null,
  designation: e.designation ?? null,
  grade: e.grade ?? null,
  type: e.type,
  managerId: e.managerId ? String(e.managerId) : null,
  joinedOn: ymd(e.joinedOn),
  probationEndsOn: e.probationEndsOn ? ymd(e.probationEndsOn) : null,
  status: e.status,
  exitOn: e.exitOn ? ymd(e.exitOn) : null,
  pan: e.pan ?? null,
  uan: e.uan ?? null,
  esiNo: e.esiNo ?? null,
  aadhaar: e.aadhaarLast4 ? `XXXX XXXX ${e.aadhaarLast4}` : null,
  bank: e.bank?.accountNo
    ? { name: e.bank.name, ifsc: e.bank.ifsc, accountNo: `XXXX${e.bank.accountNo.slice(-4)}` }
    : null,
  registration: e.registration?.number
    ? {
        council: e.registration.council,
        number: e.registration.number,
        expiresOn: e.registration.expiresOn ? ymd(e.registration.expiresOn) : null,
      }
    : null,
  state: e.state,
});

async function departmentName(departmentId) {
  if (!departmentId) return undefined;
  const d = await Department.findById(departmentId).select('name').lean();
  if (!d) throw errors.validation([{ path: 'departmentId', message: 'Pick a department' }]);
  return d.name;
}

function toDoc(input) {
  const { aadhaar, joinedOn, dob, probationMonths, registration, ...rest } = input;
  const doc = { ...rest };
  if (aadhaar) doc.aadhaarLast4 = aadhaar.slice(-4);
  if (joinedOn) {
    doc.joinedOn = dateOf(joinedOn);
    if (probationMonths) {
      const d = dateOf(joinedOn);
      d.setMonth(d.getMonth() + probationMonths);
      doc.probationEndsOn = d;
    }
  }
  if (dob) doc.dob = dateOf(dob);
  if (registration)
    doc.registration = {
      ...registration,
      expiresOn: registration.expiresOn ? dateOf(registration.expiresOn) : undefined,
    };
  return doc;
}

export async function createEmployee(input) {
  const doc = toDoc(input);
  doc.department = await departmentName(input.departmentId);
  doc.empNo = await numbering.next('EMPLOYEE');
  doc.branchId = current().branchId ?? undefined;
  doc.history = [
    {
      at: new Date(),
      kind: 'JOINED',
      text: `Joined as ${input.designation ?? input.type}`,
      by: await userName(),
    },
  ];
  const [e] = await Employee.create([doc]);
  if (input.userId) await User.updateOne({ _id: input.userId }, { $set: { employeeId: e._id } });
  await ensureBalances(e._id, new Date(e.joinedOn).getFullYear());
  await publish('hr.employee.joined', { employeeId: String(e._id), empNo: e.empNo });
  return employeeOut(e.toObject());
}

export async function updateEmployee(id, input) {
  const e = await Employee.findById(id);
  if (!e) throw errors.notFound('Employee');
  const doc = toDoc(input);
  if ('departmentId' in input) doc.department = await departmentName(input.departmentId);
  const moved = [];
  if (input.designation && input.designation !== e.designation)
    moved.push(`Designation ${e.designation ?? '-'} → ${input.designation}`);
  if (input.department && doc.department !== e.department)
    moved.push(`Department ${e.department ?? '-'} → ${doc.department}`);
  e.set(doc);
  if (moved.length)
    e.history.push({
      at: new Date(),
      kind: 'MOVEMENT',
      text: moved.join('; '),
      by: await userName(),
    });
  await e.save();
  return employeeOut(e.toObject());
}

/** Exit: notice, then exited on the last day; the user account is deactivated then. */
export async function exitEmployee(id, { exitOn, reason }) {
  const e = await Employee.findById(id);
  if (!e) throw errors.notFound('Employee');
  if (e.status === 'EXITED') throw new AppError(409, 'INVALID_STATE', 'Already exited.');
  e.exitOn = dateOf(exitOn);
  e.exitReason = reason;
  e.status = exitOn <= todayIST() ? 'EXITED' : 'NOTICE';
  e.history.push({
    at: new Date(),
    kind: 'EXIT',
    text: `${reason} · last day ${exitOn}`,
    by: await userName(),
  });
  await e.save();
  if (e.status === 'EXITED' && e.userId)
    await User.updateOne({ _id: e.userId }, { $set: { status: 'INACTIVE' } });
  await publish('hr.employee.exit', { employeeId: String(e._id), exitOn });
  return employeeOut(e.toObject());
}

export async function listEmployees({
  q,
  status = 'ACTIVE,NOTICE',
  departmentId,
  page = 1,
  limit = 100,
} = {}) {
  const filter = { status: { $in: status.split(',') } };
  if (departmentId) filter.departmentId = departmentId;
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ 'name.first': rx }, { 'name.last': rx }, { empNo: rx }, { designation: rx }];
  }
  const [rows, total] = await Promise.all([
    Employee.find(filter)
      .sort({ empNo: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Employee.countDocuments(filter),
  ]);
  return { items: rows.map(employeeOut), total, page, limit };
}

export async function getEmployee(id) {
  const e = await Employee.findById(id).lean();
  if (!e) throw errors.notFound('Employee');
  return { ...employeeOut(e), history: e.history ?? [] };
}

/** The signed-in user's employee record (self-service). */
export async function myEmployee() {
  const c = current();
  const e = await Employee.findOne({ userId: c.userId }).lean();
  if (!e)
    throw new AppError(
      404,
      'NOT_AN_EMPLOYEE',
      'Your login is not linked to an employee record. Ask HR.',
    );
  return e;
}

/** Registrations expiring within the alert window (and expired). */
export async function credentialAlerts() {
  const s = await settingsDoc();
  const until = new Date(Date.now() + s.credentialAlertDays * DAY);
  const rows = await Employee.find({
    status: { $ne: 'EXITED' },
    'registration.expiresOn': { $lte: until },
  })
    .sort({ 'registration.expiresOn': 1 })
    .lean();
  return {
    items: rows.map((e) => ({
      ...employeeOut(e),
      daysLeft: Math.ceil((e.registration.expiresOn - Date.now()) / DAY),
    })),
  };
}

// ---------------------------------------------------------------- leave

/** Creates the year's balances: yearly types in full, monthly types accrued to date. */
export async function ensureBalances(employeeId, year) {
  const s = await settingsDoc();
  const e = await Employee.findById(employeeId).select('joinedOn').lean();
  const joined = new Date(e.joinedOn);
  const now = new Date();
  for (const t of s.leaveTypes) {
    const startMonth = joined.getFullYear() === year ? joined.getMonth() : 0;
    const monthsIn = Math.max(0, (now.getFullYear() > year ? 12 : now.getMonth() + 1) - startMonth);
    const accrued =
      t.accrual === 'MONTHLY'
        ? Math.round((t.perYear / 12) * monthsIn * 2) / 2
        : Math.round((t.perYear * (12 - startMonth)) / 12);
    const prev = await LeaveBalance.findOne({ employeeId, year: year - 1, code: t.code }).lean();
    const opening = prev ? Math.min(t.carryForwardMax, prev.opening + prev.accrued - prev.used) : 0;
    const have = await LeaveBalance.findOne({ employeeId, year, code: t.code });
    if (!have) {
      try {
        await LeaveBalance.create([
          { employeeId, year, code: t.code, opening: Math.max(0, opening), accrued },
        ]);
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    } else if (have.accrued !== accrued) {
      have.accrued = accrued;
      await have.save();
    }
  }
}

export async function balances(employeeId, year = new Date().getFullYear()) {
  await ensureBalances(employeeId, year);
  const s = await settingsDoc();
  const rows = await LeaveBalance.find({ employeeId, year }).lean();
  return {
    year,
    items: s.leaveTypes.map((t) => {
      const b = rows.find((r) => r.code === t.code) ?? { opening: 0, accrued: 0, used: 0 };
      return {
        code: t.code,
        name: t.name,
        paid: t.paid,
        opening: b.opening,
        accrued: b.accrued,
        used: b.used,
        available: t.code === 'LOP' ? null : b.opening + b.accrued - b.used,
      };
    }),
  };
}

const leaveOut = (l) => ({
  id: String(l._id),
  employeeId: String(l.employeeId),
  empNo: l.empNo,
  name: l.name,
  department: l.department ?? null,
  code: l.code,
  from: l.from,
  to: l.to,
  halfDay: Boolean(l.halfDay),
  days: l.days,
  reason: l.reason ?? null,
  status: l.status,
  decidedBy: l.decidedBy ?? null,
  decidedAt: l.decidedAt ?? null,
  decisionNote: l.decisionNote ?? null,
  createdAt: l.createdAt,
});

async function workingDays(employee, from, to) {
  const s = await settingsDoc();
  const holidays = new Set(
    (
      await Holiday.find({ date: { $gte: dateOf(from), $lte: dateOf(to) } })
        .select('date')
        .lean()
    ).map((h) => ymd(h.date)),
  );
  const roster = new Map(
    (
      await RosterCell.find({ employeeId: employee._id, date: { $gte: from, $lte: to } }).lean()
    ).map((r) => [r.date, r.shift]),
  );
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (holidays.has(d)) continue;
    const r = roster.get(d);
    if (r === 'OFF') continue;
    if (!r && s.weekOff.includes(weekday(d))) continue;
    out.push(d);
  }
  return out;
}

export const leaveInput = z.object({
  code: z.string().trim().toUpperCase().max(6),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  halfDay: z.boolean().default(false),
  reason: z.string().trim().max(300).optional(),
});

/**
 * Apply for leave (self-service or HR on behalf): checks the balance, overlaps and that the
 * roster keeps its minimum cover on those days (spec flow "leave application").
 */
export async function applyLeave(employeeId, input) {
  const e = await Employee.findById(employeeId).lean();
  if (!e) throw errors.notFound('Employee');
  const s = await settingsDoc();
  const type = s.leaveTypes.find((t) => t.code === input.code);
  if (!type) throw errors.validation([{ path: 'code', message: 'Pick a leave type' }]);
  if (input.to < input.from)
    throw errors.validation([{ path: 'to', message: 'The end is before the start' }]);
  if (input.halfDay && input.from !== input.to)
    throw errors.validation([{ path: 'halfDay', message: 'A half day is one date' }]);
  const days = (await workingDays(e, input.from, input.to)).length * (input.halfDay ? 0.5 : 1);
  if (!days)
    throw errors.validation([{ path: 'from', message: 'These are all holidays or days off' }]);
  const overlap = await LeaveRequest.exists({
    employeeId,
    status: { $in: ['PENDING', 'APPROVED'] },
    from: { $lte: input.to },
    to: { $gte: input.from },
  });
  if (overlap)
    throw new AppError(409, 'LEAVE_OVERLAP', 'You already have leave on some of these days.');
  if (type.code !== 'LOP') {
    const b = (await balances(employeeId, Number(input.from.slice(0, 4)))).items.find(
      (x) => x.code === type.code,
    );
    const pending = (
      await LeaveRequest.find({ employeeId, code: type.code, status: 'PENDING' })
        .select('days')
        .lean()
    ).reduce((sum, l) => sum + l.days, 0);
    if (b.available - pending < days)
      throw new AppError(
        409,
        'LEAVE_BALANCE',
        `${type.name}: ${b.available - pending} day(s) left, ${days} asked.`,
      );
  }
  // Roster cover: on each rostered day, someone else must still be on that shift in the unit.
  const cells = await RosterCell.find({
    employeeId,
    date: { $gte: input.from, $lte: input.to },
    shift: { $ne: 'OFF' },
  }).lean();
  for (const c of cells) {
    const others = await RosterCell.countDocuments({
      unit: c.unit,
      date: c.date,
      shift: c.shift,
      employeeId: { $ne: employeeId },
    });
    const onLeave = await LeaveRequest.countDocuments({
      status: 'APPROVED',
      from: { $lte: c.date },
      to: { $gte: c.date },
      employeeId: {
        $in: (
          await RosterCell.find({ unit: c.unit, date: c.date, shift: c.shift })
            .select('employeeId')
            .lean()
        ).map((x) => x.employeeId),
      },
    });
    if (others - onLeave < s.minPerShift)
      throw new AppError(
        409,
        'ROSTER_COVER',
        `${c.unit} ${c.shift} shift on ${c.date} would have nobody left. Arrange a swap first.`,
      );
  }
  const [l] = await LeaveRequest.create([
    {
      employeeId,
      empNo: e.empNo,
      name: `${e.name.first}${e.name.last ? ` ${e.name.last}` : ''}`,
      department: e.department,
      managerId: e.managerId,
      ...input,
      days,
    },
  ]);
  await publish('hr.leave.applied', {
    leaveId: String(l._id),
    employeeId: String(employeeId),
    managerId: e.managerId ? String(e.managerId) : null,
  });
  return leaveOut(l.toObject());
}

export async function listLeave({ status = 'PENDING', employeeId, managerId } = {}) {
  const filter = { status: { $in: status.split(',') } };
  if (employeeId) filter.employeeId = employeeId;
  if (managerId) filter.managerId = managerId;
  const rows = await LeaveRequest.find(filter).sort({ from: 1 }).limit(300).lean();
  return { items: rows.map(leaveOut), total: rows.length, page: 1, limit: 300 };
}

/** Approve (balance used, attendance marked LEAVE or LOP) or reject. The applicant cannot decide. */
export async function decideLeave(id, { decision, note }) {
  const l = await LeaveRequest.findById(id);
  if (!l) throw errors.notFound('Leave request');
  if (l.status !== 'PENDING') throw new AppError(409, 'INVALID_STATE', 'Already decided.');
  const me = await Employee.findOne({ userId: current().userId }).select('_id').lean();
  if (me && String(me._id) === String(l.employeeId))
    throw new AppError(403, 'MAKER_CHECKER', 'Your own leave is approved by your manager or HR.');
  if (await AttendanceLock.exists({ month: { $in: [l.from.slice(0, 7), l.to.slice(0, 7)] } }))
    throw new AppError(409, 'MONTH_LOCKED', 'Attendance for this month is locked for payroll.');
  const by = await userName();
  return withTransaction(async () => {
    l.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    l.decidedBy = by;
    l.decidedAt = new Date();
    l.decisionNote = note;
    await l.save();
    if (l.status === 'APPROVED') {
      const s = await settingsDoc();
      const paid = s.leaveTypes.find((t) => t.code === l.code)?.paid !== false;
      await LeaveBalance.updateOne(
        { employeeId: l.employeeId, year: Number(l.from.slice(0, 4)), code: l.code },
        { $inc: { used: l.days } },
      );
      const e = await Employee.findById(l.employeeId).lean();
      for (const d of await workingDays(e, l.from, l.to))
        await put(
          Attendance,
          { employeeId: l.employeeId, date: d },
          {
            status: l.halfDay ? 'HALF_DAY' : paid ? 'LEAVE' : 'LOP',
            leaveCode: l.code,
            source: 'LEAVE',
          },
        );
    }
    await publish('hr.leave.decided', {
      leaveId: String(l._id),
      employeeId: String(l.employeeId),
      status: l.status,
    });
    return leaveOut(l.toObject());
  });
}

export async function cancelLeave(id, employeeId) {
  const l = await LeaveRequest.findOne({ _id: id, employeeId });
  if (!l) throw errors.notFound('Leave request');
  if (l.status !== 'PENDING')
    throw new AppError(409, 'INVALID_STATE', 'Only a pending request can be withdrawn.');
  l.status = 'CANCELLED';
  await l.save();
  return leaveOut(l.toObject());
}

// ---------------------------------------------------------------- attendance

/**
 * Biometric or web punches: one row per punch line "empNo,date,in,out". Status from hours
 * worked (6 h or more present, 3 h or more half day), late minutes against the rostered shift,
 * overtime past the shift's end.
 */
export async function importPunches({ rows }) {
  const s = await settingsDoc();
  const emps = new Map(
    (
      await Employee.find({ empNo: { $in: rows.map((r) => r.empNo) } })
        .select('empNo')
        .lean()
    ).map((e) => [e.empNo, e]),
  );
  const locked = new Set(
    (await AttendanceLock.find({}).select('month').lean()).map((l) => l.month),
  );
  const result = { saved: 0, skipped: [] };
  for (const r of rows) {
    const e = emps.get(r.empNo);
    if (!e) {
      result.skipped.push({ ...r, reason: 'Unknown employee number' });
      continue;
    }
    if (locked.has(r.date.slice(0, 7))) {
      result.skipped.push({ ...r, reason: 'Month locked' });
      continue;
    }
    const cell = await RosterCell.findOne({ employeeId: e._id, date: r.date }).lean();
    const shift = s.shifts.find((x) => x.code === (cell?.shift ?? 'G'));
    let worked = minutes(r.out) - minutes(r.in);
    if (worked < 0) worked += 24 * 60;
    const lateMin = shift ? Math.max(0, minutes(r.in) - minutes(shift.start) - s.lateGraceMin) : 0;
    let shiftLen = shift ? minutes(shift.end) - minutes(shift.start) : 8 * 60;
    if (shiftLen <= 0) shiftLen += 24 * 60;
    await put(
      Attendance,
      { employeeId: e._id, date: r.date },
      {
        status: worked >= 360 ? 'PRESENT' : worked >= 180 ? 'HALF_DAY' : 'ABSENT',
        inAt: r.in,
        outAt: r.out,
        shift: shift?.code,
        lateMin,
        overtimeMin: Math.max(0, worked - shiftLen),
        source: r.source ?? 'BIOMETRIC',
      },
    );
    result.saved += 1;
  }
  return result;
}

export async function markAttendance({ employeeId, date, status, note }) {
  if (await AttendanceLock.exists({ month: date.slice(0, 7) }))
    throw new AppError(409, 'MONTH_LOCKED', 'Attendance for this month is locked for payroll.');
  const row = await put(Attendance, { employeeId, date }, { status, note, source: 'MANUAL' });
  return { id: String(row._id), date, status };
}

/** The month's grid: what is recorded, with holidays, days off and missing days filled in. */
export async function monthGrid({ month, departmentId, employeeId }) {
  const s = await settingsDoc();
  const filter = { status: { $ne: 'EXITED' } };
  if (departmentId) filter.departmentId = departmentId;
  if (employeeId) filter._id = employeeId;
  const emps = await Employee.find(filter).sort({ empNo: 1 }).lean();
  const days = daysOfMonth(month);
  const [rows, holidays, roster, lock] = await Promise.all([
    Attendance.find({
      employeeId: { $in: emps.map((e) => e._id) },
      date: { $gte: days[0], $lte: days.at(-1) },
    }).lean(),
    Holiday.find({ date: { $gte: dateOf(days[0]), $lte: dateOf(days.at(-1)) } })
      .select('date name')
      .lean(),
    RosterCell.find({
      employeeId: { $in: emps.map((e) => e._id) },
      date: { $gte: days[0], $lte: days.at(-1) },
    }).lean(),
    AttendanceLock.findOne({ month }).lean(),
  ]);
  const hol = new Set(holidays.map((h) => ymd(h.date)));
  const today = todayIST();
  return {
    month,
    locked: Boolean(lock),
    lockedBy: lock?.lockedBy ?? null,
    days,
    holidays: holidays.map((h) => ({ date: ymd(h.date), name: h.name })),
    items: emps.map((e) => {
      const mine = new Map(
        rows.filter((r) => String(r.employeeId) === String(e._id)).map((r) => [r.date, r]),
      );
      const rost = new Map(
        roster.filter((r) => String(r.employeeId) === String(e._id)).map((r) => [r.date, r.shift]),
      );
      const cells = days.map((d) => {
        const r = mine.get(d);
        if (r)
          return {
            date: d,
            status: r.status,
            inAt: r.inAt ?? null,
            outAt: r.outAt ?? null,
            lateMin: r.lateMin ?? 0,
            overtimeMin: r.overtimeMin ?? 0,
            leaveCode: r.leaveCode ?? null,
          };
        if (hol.has(d)) return { date: d, status: 'HOLIDAY' };
        if (rost.get(d) === 'OFF' || (!rost.get(d) && s.weekOff.includes(weekday(d))))
          return { date: d, status: 'WEEK_OFF' };
        const joined = ymd(e.joinedOn) > d;
        return {
          date: d,
          // Today is not absent until it is over; it shows as not marked yet.
          status: d >= today || joined ? null : 'ABSENT',
          missing: !joined && d <= today,
        };
      });
      const count = (st) => cells.filter((c) => c.status === st).length;
      return {
        employee: {
          id: String(e._id),
          empNo: e.empNo,
          name: employeeOut(e).name,
          department: e.department ?? null,
        },
        cells,
        summary: {
          present: count('PRESENT') + count('HALF_DAY') / 2,
          absent: count('ABSENT') + count('HALF_DAY') / 2,
          leave: count('LEAVE'),
          lop: count('LOP') + count('ABSENT') + count('HALF_DAY') / 2,
          late: cells.filter((c) => c.lateMin > 0).length,
          overtimeMin: cells.reduce((sum, c) => sum + (c.overtimeMin ?? 0), 0),
        },
      };
    }),
  };
}

/**
 * Locks a month for payroll: every missing working day becomes ABSENT, holidays and days off are
 * written, and the month can no longer change (payroll reads LOP from it).
 */
export async function lockMonth(month) {
  if (await AttendanceLock.exists({ month }))
    throw new AppError(409, 'MONTH_LOCKED', 'Already locked.');
  const lastDay = daysOfMonth(month).at(-1);
  if (lastDay >= todayIST())
    throw new AppError(409, 'MONTH_OPEN', 'Lock the month after its last day.');
  const grid = await monthGrid({ month });
  const by = await userName();
  return withTransaction(async () => {
    for (const row of grid.items)
      for (const c of row.cells) {
        if (!c.status || !['ABSENT', 'HOLIDAY', 'WEEK_OFF'].includes(c.status) || c.inAt) continue;
        if (!(await Attendance.exists({ employeeId: row.employee.id, date: c.date })))
          await Attendance.create([
            { employeeId: row.employee.id, date: c.date, status: c.status, source: 'SYSTEM' },
          ]);
      }
    await AttendanceLock.create([{ month, lockedAt: new Date(), lockedBy: by }]);
    await publish('hr.attendance.locked', { month });
    return { month, locked: true, employees: grid.items.length };
  });
}

/** Payroll's view: per employee, calendar days, LOP days, overtime minutes and night shifts. */
export async function payInputs(month) {
  if (!(await AttendanceLock.exists({ month })))
    throw new AppError(409, 'ATTENDANCE_NOT_LOCKED', `Lock attendance for ${month} first.`);
  const s = await settingsDoc();
  const nights = new Set(s.shifts.filter((x) => x.night).map((x) => x.code));
  const days = daysOfMonth(month);
  const rows = await Attendance.find({ date: { $gte: days[0], $lte: days.at(-1) } }).lean();
  const roster = await RosterCell.find({ date: { $gte: days[0], $lte: days.at(-1) } }).lean();
  const out = new Map();
  for (const r of rows) {
    const k = String(r.employeeId);
    const o = out.get(k) ?? { lop: 0, overtimeMin: 0, nights: 0 };
    if (r.status === 'ABSENT' || r.status === 'LOP') o.lop += 1;
    if (r.status === 'HALF_DAY') o.lop += 0.5;
    o.overtimeMin += r.overtimeMin ?? 0;
    out.set(k, o);
  }
  for (const c of roster) {
    if (!nights.has(c.shift)) continue;
    const att = rows.find(
      (r) => String(r.employeeId) === String(c.employeeId) && r.date === c.date,
    );
    if (att?.status !== 'PRESENT') continue;
    const k = String(c.employeeId);
    const o = out.get(k) ?? { lop: 0, overtimeMin: 0, nights: 0 };
    o.nights += 1;
    out.set(k, o);
  }
  return { days: days.length, byEmployee: out };
}

// ---------------------------------------------------------------- rosters

export async function rosterWeek({ unit, from }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const cells = await RosterCell.find({ unit, date: { $gte: days[0], $lte: days[6] } }).lean();
  const ids = [...new Set(cells.map((c) => String(c.employeeId)))];
  const emps = await Employee.find({ _id: { $in: ids } }).lean();
  const s = await settingsDoc();
  const leave = await LeaveRequest.find({
    employeeId: { $in: ids },
    status: 'APPROVED',
    from: { $lte: days[6] },
    to: { $gte: days[0] },
  }).lean();
  return {
    unit,
    days,
    shifts: s.shifts,
    minPerShift: s.minPerShift,
    rows: emps.map((e) => ({
      employee: {
        id: String(e._id),
        empNo: e.empNo,
        name: employeeOut(e).name,
        designation: e.designation ?? null,
      },
      cells: days.map((d) => ({
        date: d,
        shift:
          cells.find((c) => String(c.employeeId) === String(e._id) && c.date === d)?.shift ?? null,
        onLeave: leave.some(
          (l) => String(l.employeeId) === String(e._id) && l.from <= d && l.to >= d,
        ),
      })),
    })),
    cover: days.map((d) =>
      Object.fromEntries(
        s.shifts.map((sh) => [
          sh.code,
          cells.filter((c) => c.date === d && c.shift === sh.code).length,
        ]),
      ),
    ),
  };
}

export const rosterInput = z.object({
  unit: z.string().trim().min(2).max(60),
  cells: z
    .array(
      z.object({
        employeeId: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        shift: z.string().trim().toUpperCase().max(4),
      }),
    )
    .min(1)
    .max(500),
});

export async function saveRoster({ unit, cells }) {
  const s = await settingsDoc();
  const codes = new Set([...s.shifts.map((x) => x.code), 'OFF']);
  const bad = cells.find((c) => !codes.has(c.shift));
  if (bad) throw errors.validation([{ path: 'cells', message: `Unknown shift ${bad.shift}` }]);
  for (const c of cells)
    if (c.shift === '') await RosterCell.deleteOne({ employeeId: c.employeeId, date: c.date });
    else
      await put(RosterCell, { employeeId: c.employeeId, date: c.date }, { unit, shift: c.shift });
  await publish('hr.roster.changed', { unit });
  return rosterWeek({ unit, from: cells.map((c) => c.date).sort()[0] });
}

export async function requestSwap({ unit, date, fromId, toId, reason }) {
  const [a, b] = await Promise.all([
    RosterCell.findOne({ employeeId: fromId, date }).lean(),
    RosterCell.findOne({ employeeId: toId, date }).lean(),
  ]);
  if (!a) throw errors.validation([{ path: 'fromId', message: 'Not rostered that day' }]);
  const [sw] = await ShiftSwap.create([
    { unit, date, fromId, toId, fromShift: a.shift, toShift: b?.shift ?? 'OFF', reason },
  ]);
  return { id: String(sw._id), status: sw.status };
}

export async function decideSwap(id, { approve }) {
  const sw = await ShiftSwap.findById(id);
  if (!sw || sw.status !== 'PENDING') throw errors.notFound('Swap request');
  sw.status = approve ? 'APPROVED' : 'REJECTED';
  sw.decidedBy = await userName();
  await sw.save();
  if (approve) {
    await put(
      RosterCell,
      { employeeId: sw.fromId, date: sw.date },
      { unit: sw.unit, shift: sw.toShift },
    );
    await put(
      RosterCell,
      { employeeId: sw.toId, date: sw.date },
      { unit: sw.unit, shift: sw.fromShift },
    );
  }
  return { id: String(sw._id), status: sw.status };
}

export async function listSwaps({ status = 'PENDING' } = {}) {
  const rows = await ShiftSwap.find({ status }).lean();
  const emps = new Map(
    (await Employee.find({ _id: { $in: rows.flatMap((r) => [r.fromId, r.toId]) } }).lean()).map(
      (e) => [String(e._id), employeeOut(e).name],
    ),
  );
  return {
    items: rows.map((r) => ({
      id: String(r._id),
      unit: r.unit,
      date: r.date,
      from: emps.get(String(r.fromId)),
      to: emps.get(String(r.toId)),
      fromShift: r.fromShift,
      toShift: r.toShift,
      reason: r.reason ?? null,
      status: r.status,
    })),
  };
}

export async function getSettings() {
  const s = await settingsDoc();
  return {
    leaveTypes: s.leaveTypes,
    shifts: s.shifts,
    weekOff: s.weekOff,
    lateGraceMin: s.lateGraceMin,
    minPerShift: s.minPerShift,
    credentialAlertDays: s.credentialAlertDays,
    version: s.version,
  };
}
