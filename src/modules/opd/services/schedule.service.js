import { withTransaction } from '../../../core/db/model.js';
import { errors } from '../../../core/errors/index.js';
import { Department, Doctor, Service, requestTariffApproval } from '../../setup/index.js';
import { Appointment, DoctorSchedule, ScheduleBlock } from '../models/opd.models.js';
import {
  defaultPriceList,
  doctorCards,
  doctorOut,
  hhmm,
  hhmmIST,
  listOf,
  loadDoctor,
  minutes,
  rateOf,
  servicesById,
  weekdayOf,
  ymdIST,
} from './common.js';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const FEE_TYPES = ['NEW', 'FOLLOW_UP', 'TELE'];
const OPEN = ['BOOKED', 'CONFIRMED'];
const ACTIVE = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULT', 'COMPLETED', 'NO_SHOW'];

const emptyWeek = () => WEEKDAYS.map((day) => ({ day, sessions: [] }));

/** The week a doctor works: the saved template, or the department's OPD timings. */
async function weekOf(doctor, schedule) {
  if (schedule?.week?.length)
    return WEEKDAYS.map((day) => schedule.week.find((w) => w.day === day) ?? { day, sessions: [] });
  const dept = await Department.findById(doctor.departmentId).select('opdTimings location').lean();
  if (!dept?.opdTimings?.length) return emptyWeek();
  // opdTimings: day 0 = Sunday.
  return WEEKDAYS.map((day, i) => ({
    day,
    sessions: dept.opdTimings
      .filter((t) => t.day === (i + 1) % 7)
      .map((t) => ({
        start: t.from,
        end: t.to,
        room: dept.location?.rooms ?? '',
        slotNew: 10,
        slotFollowUp: 5,
        max: Math.round((minutes(t.to) - minutes(t.from)) / 10),
        overbook: 0,
        online: true,
        tele: false,
      })),
  }));
}

/** Services that price each visit type (default: the doctor's consultation service). */
function feeServiceIds(doctor, schedule) {
  const base = doctor.consultationServiceId ?? null;
  return Object.fromEntries(FEE_TYPES.map((k) => [k, schedule?.feeServices?.[k] ?? base]));
}

async function feesOf(ids) {
  const [list, services] = await Promise.all([
    defaultPriceList(),
    servicesById(Object.values(ids)),
  ]);
  return Object.fromEntries(
    FEE_TYPES.map((k) => [k, rateOf(services.get(String(ids[k])), list) ?? 0]),
  );
}

/** The doctor's new-visit fee (paise) from the tariff, for patient-facing booking. */
export async function newVisitFee(doctor) {
  const schedule = await DoctorSchedule.findOne({ doctorId: doctor._id }).lean();
  return (await feesOf(feeServiceIds(doctor, schedule))).NEW ?? null;
}

async function scheduleOut(doctor, card) {
  const schedule = await DoctorSchedule.findOne({ doctorId: doctor._id }).lean();
  const week = await weekOf(doctor, schedule);
  const fees = await feesOf(feeServiceIds(doctor, schedule));
  return {
    doctorId: String(doctor._id),
    doctor: doctorOut(card),
    visiting: doctor.kind === 'VISITING',
    sessionsPerWeek: week.reduce((s, w) => s + w.sessions.length, 0),
    week,
    fees,
    followUp: { days: schedule?.followUp?.days ?? 15, visits: schedule?.followUp?.visits ?? 1 },
    pendingFeeChange: schedule?.pendingFeeChange?.approvalId
      ? {
          fees: schedule.pendingFeeChange.fees,
          approvalId: String(schedule.pendingFeeChange.approvalId),
        }
      : null,
  };
}

export async function activeDoctors({ department, q } = {}) {
  const filter = { isActive: true };
  if (q) filter.name = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (department) {
    const d = await Department.findOne({ name: department }).select('_id').lean();
    if (!d) return [];
    filter.departmentId = d._id;
  }
  return Doctor.find(filter).sort({ name: 1 }).lean();
}

export async function listDoctors(query) {
  const doctors = await activeDoctors(query);
  const cards = await doctorCards(doctors);
  const out = [];
  for (const [i, d] of doctors.entries()) {
    const schedule = await DoctorSchedule.findOne({ doctorId: d._id }).lean();
    out.push({
      ...doctorOut(cards[i]),
      fees: await feesOf(feeServiceIds(d, schedule)),
      followUp: { days: schedule?.followUp?.days ?? 15, visits: schedule?.followUp?.visits ?? 1 },
      visiting: d.kind === 'VISITING',
    });
  }
  return listOf(out);
}

export async function listDepartments() {
  const ids = await Doctor.distinct('departmentId', { isActive: true });
  const depts = await Department.find({ _id: { $in: ids } })
    .select('name')
    .sort({ name: 1 })
    .lean();
  return listOf(depts.map((d) => ({ id: d.name, name: d.name })));
}

export async function listSchedules({ q } = {}) {
  const doctors = await activeDoctors({ q });
  const cards = await doctorCards(doctors);
  const out = [];
  for (const [i, d] of doctors.entries()) out.push(await scheduleOut(d, cards[i]));
  return listOf(out);
}

export async function getSchedule(doctorId) {
  const d = await Doctor.findById(doctorId).lean();
  if (!d) throw errors.notFound('Doctor');
  const [card] = await doctorCards([d]);
  return scheduleOut(d, card);
}

function checkWeek(week) {
  const details = [];
  for (const w of week) {
    const spans = [];
    w.sessions.forEach((s, i) => {
      const a = minutes(s.start);
      const b = minutes(s.end);
      if (!(a < b))
        details.push({
          path: `week.${w.day}.${i}`,
          message: 'The session must end after it starts.',
        });
      else if (spans.some(([x, y]) => a < y && b > x))
        details.push({
          path: `week.${w.day}.${i}`,
          message: 'This session overlaps another on the same day.',
        });
      spans.push([a, b]);
    });
  }
  if (details.length) throw errors.validation(details);
}

/**
 * Saves a doctor's week and follow-up rule; a fee change becomes a tariff change on the
 * consultation service and waits for Super Admin approval (202).
 */
export async function saveSchedule(doctorId, { week, fees, followUp }, res) {
  const doctor = await loadDoctor(doctorId);
  if (week) checkWeek(week);
  const result = await withTransaction(async () => {
    let schedule = await DoctorSchedule.findOne({ doctorId });
    if (!schedule) [schedule] = await DoctorSchedule.create([{ doctorId, week: emptyWeek() }]);
    if (week) schedule.week = week;
    if (followUp) schedule.followUp = followUp;
    let approval = null;
    if (fees) {
      const ids = feeServiceIds(doctor, schedule);
      const current = await feesOf(ids);
      const changed = FEE_TYPES.filter((k) => fees[k] != null && fees[k] !== current[k]);
      if (changed.length) {
        const list = await defaultPriceList();
        const byService = new Map();
        for (const k of changed) {
          const sid = ids[k] && String(ids[k]);
          if (!sid)
            throw errors.validation([
              { path: `fees.${k}`, message: 'Link a consultation service to this doctor first' },
            ]);
          const prev = byService.get(sid);
          if (prev && prev.amount !== fees[k])
            throw errors.validation([
              {
                path: `fees.${k}`,
                message:
                  'These visit types share one consultation service; give each its own service to price them differently',
              },
            ]);
          byService.set(sid, { amount: fees[k] });
        }
        const services = await Service.find({ _id: { $in: [...byService.keys()] } });
        for (const s of services) {
          const amount = byService.get(String(s._id)).amount;
          s.pendingRates = s.rates.map((r) =>
            String(r.priceListId) === String(list._id) ? { priceListId: r.priceListId, amount } : r,
          );
          if (!s.pendingRates.some((r) => String(r.priceListId) === String(list._id)))
            s.pendingRates.push({ priceListId: list._id, amount });
          await s.save();
        }
        approval = await requestTariffApproval(services, {
          reason: `Consultation fee change for ${doctor.name}`,
          title: `Consultation fees · ${doctor.name}`,
        });
        if (approval) schedule.pendingFeeChange = { fees, approvalId: approval._id };
      }
    }
    await schedule.save();
    return approval;
  });
  const out = await getSchedule(doctorId);
  if (result) {
    res.locals.status = 202;
    return { ...out, approvalId: String(result._id) };
  }
  return out;
}

/** Rule R10: leave blocks the slots and lists the bookings to move or message. */
export async function blockDates(doctorId, { from, to, reason }) {
  await loadDoctor(doctorId);
  const end = to ?? from;
  if (end < from)
    throw errors.validation([{ path: 'to', message: 'The end date is before the start date.' }]);
  const [block] = await ScheduleBlock.create([{ doctorId, from, to: end, reason }]);
  const affected = await Appointment.find({
    'doctor.id': doctorId,
    date: { $gte: from, $lte: end },
    status: { $in: OPEN },
  })
    .sort({ date: 1, time: 1 })
    .lean();
  return {
    block: { id: String(block._id), doctorId: String(doctorId), from, to: end, reason },
    affected: affected.map((a) => ({
      id: String(a._id),
      apptNo: a.apptNo,
      date: a.date,
      time: a.time,
      patient: { id: String(a.patient.id), name: a.patient.name, mobile: a.patient.mobile },
      status: a.status,
    })),
  };
}

/** The doctor's slot times on a date (every session, new-visit slot length). */
export async function slotTimes(doctor, date) {
  const schedule = await DoctorSchedule.findOne({ doctorId: doctor._id }).lean();
  const week = await weekOf(doctor, schedule);
  const day = week.find((w) => w.day === weekdayOf(date));
  const out = [];
  for (const s of day?.sessions ?? [])
    for (let m = minutes(s.start); m + s.slotNew <= minutes(s.end); m += s.slotNew)
      out.push({ time: hhmm(m), overbook: s.overbook ?? 0, online: s.online });
  return out;
}

export async function isBlocked(doctorId, date) {
  return Boolean(
    await ScheduleBlock.exists({ doctorId, from: { $lte: date }, to: { $gte: date } }),
  );
}

/** GET /opd/slots: the grid of doctors and slot times for one day. */
export async function slots({ date = ymdIST(), department } = {}) {
  const doctors = await activeDoctors({ department });
  const cards = await doctorCards(doctors);
  const today = ymdIST();
  const now = hhmmIST();
  const appts = await Appointment.find({
    date,
    'doctor.id': { $in: doctors.map((d) => d._id) },
    status: { $in: ACTIVE },
  }).lean();
  const own = [];
  for (const d of doctors) own.push(new Set((await slotTimes(d, date)).map((s) => s.time)));
  const times = [...new Set(own.flatMap((s) => [...s]))].sort();
  const cells = [];
  for (const [i, d] of doctors.entries()) {
    const blocked = await isBlocked(d._id, date);
    cells.push({
      doctorId: String(d._id),
      slots: times.map((time) => {
        if (!own[i].has(time)) return { time, status: 'NONE' };
        const a = appts.find((x) => String(x.doctor.id) === String(d._id) && x.time === time);
        if (a)
          return {
            time,
            status: a.status === 'CONFIRMED' ? 'BOOKED' : a.status,
            appointmentId: String(a._id),
            patientName: a.patient.name,
          };
        const past = date < today || (date === today && time < now);
        return { time, status: blocked ? 'BLOCKED' : past ? 'PAST' : 'FREE' };
      }),
    });
  }
  return {
    date,
    now: date === today ? now : null,
    doctors: cards.map(doctorOut),
    times,
    cells,
  };
}

export { feeServiceIds, feesOf };
