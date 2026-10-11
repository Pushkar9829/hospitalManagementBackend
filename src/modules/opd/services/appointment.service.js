import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber, nextNumber } from '../../../core/sequences/sequence.service.js';
import { current } from '../../../core/tenancy/context.js';
import { Appointment, OpdVisit } from '../models/opd.models.js';
import {
  atIST,
  doctorCards,
  hhmmIST,
  listOf,
  loadDoctor,
  loadPatient,
  minutes,
  patientSnap,
  ymdIST,
} from './common.js';
import { appointmentOut, visitOut } from './dto.js';
import { feeServiceIds, feesOf, isBlocked, slotTimes } from './schedule.service.js';
import { settingsDoc, triageRequired } from './settings.service.js';
import { DoctorSchedule } from '../models/opd.models.js';

const OPEN = ['BOOKED', 'CONFIRMED'];
const TAKEN = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULT', 'COMPLETED'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function findAppointment(id) {
  const a = await Appointment.findById(id);
  if (!a) throw errors.notFound('Booking');
  return a;
}

/** Fee for a visit type; rule R4 makes a follow-up free with the same doctor in the window. */
async function feeFor(doctor, patientId, visitType, date) {
  const schedule = await DoctorSchedule.findOne({ doctorId: doctor._id }).lean();
  const ids = feeServiceIds(doctor, schedule);
  const fees = await feesOf(ids);
  const type = visitType === 'TELE' ? 'TELE' : visitType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'NEW';
  const window = schedule?.followUp?.days ?? 15;
  const allowed = schedule?.followUp?.visits ?? 1;
  if (visitType === 'FOLLOW_UP' && window > 0) {
    const since = ymdIST(new Date(atIST(date, '12:00').getTime() - window * 86_400_000));
    const lastPaid = await Appointment.findOne({
      'patient.id': patientId,
      'doctor.id': doctor._id,
      status: 'COMPLETED',
      'fee.amount': { $gt: 0 },
      date: { $gte: since, $lte: date },
    })
      .sort({ date: -1 })
      .lean();
    if (lastPaid) {
      const used = await Appointment.countDocuments({
        'patient.id': patientId,
        'doctor.id': doctor._id,
        'fee.label': 'FREE_FOLLOW_UP',
        date: { $gt: lastPaid.date, $lte: date },
        status: { $in: TAKEN },
      });
      if (used < allowed) {
        const day = Math.round((atIST(date, '12:00') - atIST(lastPaid.date, '12:00')) / 86_400_000);
        return {
          amount: 0,
          label: 'FREE_FOLLOW_UP',
          freeDay: day,
          window,
          paid: true,
          serviceId: ids.FOLLOW_UP,
        };
      }
    }
  }
  return {
    amount: fees[type],
    label: visitType === 'VACCINATION' ? 'PLUS_VACCINE' : null,
    paid: fees[type] === 0,
    serviceId: ids[type],
  };
}

/** Next free slot after `time` for the doctor on that date (for the 409 SLOT_TAKEN hint). */
async function nextFree(doctor, date, time) {
  const times = (await slotTimes(doctor, date)).map((s) => s.time).filter((t) => t > time);
  const taken = new Set(
    (
      await Appointment.find({ 'doctor.id': doctor._id, date, status: { $in: TAKEN } })
        .select('time')
        .lean()
    ).map((a) => a.time),
  );
  return times.find((t) => !taken.has(t)) ?? null;
}

/**
 * Books a slot (rules R1, R3, R17). A walk-in has no slot and is checked in at once.
 * Two desks taking the same slot: the unique slot key lets one win; the other gets 409
 * SLOT_TAKEN with the next free time.
 */
export async function book(input) {
  const doctor = await loadDoctor(input.doctorId);
  const patient = await loadPatient(input.patientId);
  const settings = await settingsDoc();
  const date = input.date ?? ymdIST();
  const walkIn = input.channel === 'WALK_IN';
  const time = walkIn ? (input.time ?? hhmmIST()) : input.time;
  const today = ymdIST();
  if (!walkIn) {
    if (!time) throw errors.validation([{ path: 'time', message: 'Choose a slot.' }]);
    if (date < today) throw errors.validation([{ path: 'date', message: 'This date has passed.' }]);
    const ahead = Math.round((atIST(date, '12:00') - atIST(today, '12:00')) / 86_400_000);
    if (ahead > settings.booking.bookAheadDays)
      throw errors.validation([
        { path: 'date', message: `Bookings open ${settings.booking.bookAheadDays} days ahead.` },
      ]);
    if (await isBlocked(doctor._id, date))
      throw new AppError(409, 'DOCTOR_ON_LEAVE', `${doctor.name} is not available on this date.`);
    const own = await slotTimes(doctor, date);
    const slot = own.find((s) => s.time === time);
    if (!slot)
      throw errors.validation([
        { path: 'time', message: 'This is not one of the doctor’s slots.' },
      ]);
    const open = await Appointment.countDocuments({
      'patient.id': patient._id,
      'doctor.id': doctor._id,
      date: { $gte: today },
      status: { $in: OPEN },
    });
    if (open >= settings.booking.maxFuturePerDoctor)
      throw new AppError(
        409,
        'TOO_MANY_BOOKINGS',
        `This patient already has ${open} open bookings with ${doctor.name}.`,
      );
  }
  const [card] = await doctorCards([doctor]);
  const fee = await feeFor(doctor, patient._id, input.visitType ?? 'NEW', date);
  const slot = walkIn ? null : (await slotTimes(doctor, date)).find((s) => s.time === time);
  const create = async (seq) =>
    withTransaction(async () => {
      const [a] = await Appointment.create([
        {
          apptNo: await documentNumber('AP'),
          branchId: current().branchId,
          date,
          time,
          slotStart: atIST(date, time),
          doctor: card,
          patient: patientSnap(patient),
          visitType: input.visitType ?? 'NEW',
          channel: input.channel ?? 'DESK',
          status: 'BOOKED',
          fee,
          notes: input.notes ?? '',
          slotKey: walkIn ? undefined : `${doctor._id}|${date}|${time}|${seq}`,
        },
      ]);
      await publish('opd.appointment.booked', {
        appointmentId: String(a._id),
        patientId: String(patient._id),
        mobile: patient.mobile,
        date,
        time,
        doctor: doctor.name,
      });
      return a;
    });
  let appt = null;
  const tries = walkIn ? 1 : 1 + (slot?.overbook ?? 0);
  for (let seq = 0; seq < tries && !appt; seq++) {
    try {
      appt = await create(seq);
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  if (!appt) {
    const free = await nextFree(doctor, date, time);
    throw new AppError(
      409,
      'SLOT_TAKEN',
      `The ${time} slot was just taken.`,
      free ? [{ path: 'time', message: `Next free slot: ${free}`, nextFree: free }] : [],
    );
  }
  if (walkIn) return checkIn(appt._id, { detailsConfirmed: true });
  return appointmentOut(appt);
}

async function nextToken(walkIn, date) {
  const prefix = walkIn ? 'W-' : 'T-';
  const n = await nextNumber(`OPD-TOKEN-${prefix}${date}`, {
    branchId: current().branchId ?? null,
  });
  return `${prefix}${String(n).padStart(2, '0')}`;
}

/** Check-in: a token, the visit, and where the patient goes next (triage, billing or video). */
export async function checkIn(id, body = {}) {
  const settings = await settingsDoc();
  return withTransaction(async () => {
    const a = await findAppointment(id);
    if (!OPEN.includes(a.status))
      throw new AppError(
        409,
        'INVALID_STATE',
        `This booking is ${a.status.toLowerCase().replace('_', ' ')}.`,
      );
    const now = new Date();
    const today = ymdIST(now);
    const late =
      a.date === today && minutes(hhmmIST(now)) - minutes(a.time) > settings.booking.lateGraceMin;
    const walkIn = a.channel === 'WALK_IN';
    const token = await nextToken(walkIn, today);
    const tele = a.visitType === 'TELE';
    const needsTriage = !tele && (await triageRequired(a.doctor.department));
    const [v] = await OpdVisit.create([
      {
        visitNo: await documentNumber('OPV'),
        branchId: current().branchId,
        date: today,
        token,
        appointmentId: a._id,
        patient: a.patient,
        doctor: a.doctor,
        visitType: a.visitType,
        channel: a.channel,
        walkIn,
        stage: needsTriage ? 'WAITING' : 'TRIAGED',
        status: 'OPEN',
        late,
        checkedInAt: now,
        complaint: body.complaint ?? a.notes ?? '',
        triageSkipped: tele ? { reason: 'Tele-consultation', by: 'System', at: now } : undefined,
        fee: a.fee,
      },
    ]);
    a.status = 'CHECKED_IN';
    a.token = token;
    a.visitId = v._id;
    a.detailsConfirmed = Boolean(body.detailsConfirmed);
    a.whatsappConsent = Boolean(body.whatsappConsent);
    await a.save();
    await publish('opd.visit.checkedIn', {
      visitId: String(v._id),
      doctorId: String(a.doctor.id),
      token,
    });
    const ahead = await OpdVisit.countDocuments({
      'doctor.id': a.doctor.id,
      date: today,
      stage: { $ne: 'DONE' },
    });
    const eta = new Date(now.getTime() + Math.max(5, ahead * 8) * 60_000);
    return {
      appointment: appointmentOut(a),
      visit: visitOut(v),
      token: { no: token, room: a.doctor.room, eta: hhmmIST(eta), late },
      next: tele ? 'VIDEO' : a.fee.paid ? (needsTriage ? 'TRIAGE' : 'DOCTOR') : 'BILLING',
    };
  });
}

export async function listAppointments({
  date = ymdIST(),
  doctorId,
  status,
  q,
  from,
  page = 1,
  limit = 100,
}) {
  const filter = { date };
  if (doctorId) filter['doctor.id'] = doctorId;
  if (status) filter.status = { $in: status.split(',') };
  if (from) filter.time = { $gte: from };
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [
      { 'patient.name': rx },
      { 'patient.uhid': rx },
      { 'patient.mobile': rx },
      { apptNo: rx },
    ];
  }
  const [items, total] = await Promise.all([
    Appointment.find(filter)
      .sort({ time: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Appointment.countDocuments(filter),
  ]);
  return { items: items.map(appointmentOut), total, page, limit };
}

export async function getAppointment(id) {
  return appointmentOut((await findAppointment(id)).toObject());
}

/** Moves a booking that has not arrived: a new booking takes the slot, the old one is marked. */
export async function reschedule(id, { doctorId, date, time, reason }) {
  const a = await findAppointment(id);
  if (!OPEN.includes(a.status))
    throw new AppError(409, 'INVALID_STATE', 'Only a booking that has not arrived can be moved.');
  const moved = await book({
    patientId: a.patient.id,
    doctorId: doctorId ?? a.doctor.id,
    date: date ?? a.date,
    time,
    visitType: a.visitType,
    channel: a.channel === 'WALK_IN' ? 'DESK' : a.channel,
    notes: a.notes,
  });
  await Appointment.updateOne({ _id: moved.id }, { $set: { fee: a.fee } });
  a.status = 'RESCHEDULED';
  a.rescheduledTo = moved.id;
  a.reason = reason ?? '';
  a.slotKey = undefined;
  await a.save();
  return { appointment: { ...moved, fee: appointmentOut(a).fee }, previous: appointmentOut(a) };
}

/** Rule R9: free until the cut-off before the slot; later, part of a prepaid fee is kept as credit. */
export async function cancel(id, { reason }) {
  const settings = await settingsDoc();
  const a = await findAppointment(id);
  if (!OPEN.includes(a.status))
    throw new AppError(
      409,
      'INVALID_STATE',
      'Only a booking that has not arrived can be cancelled.',
    );
  a.status = 'CANCELLED';
  a.reason = reason ?? '';
  a.slotKey = undefined;
  await a.save();
  const hoursLeft = (a.slotStart - new Date()) / 3_600_000;
  const { freeUntilHours, keepPercent } = settings.cancellation;
  const refund = a.fee.prepaid
    ? hoursLeft >= freeUntilHours
      ? { amount: a.fee.amount, mode: 'ORIGINAL' }
      : { amount: Math.round((a.fee.amount * (100 - keepPercent)) / 100), mode: 'CREDIT' }
    : null;
  await publish('opd.appointment.cancelled', { appointmentId: String(a._id), refund });
  return { appointment: appointmentOut(a), refund };
}

export async function markNoShow(id) {
  const a = await findAppointment(id);
  if (!OPEN.includes(a.status))
    throw new AppError(
      409,
      'INVALID_STATE',
      'Only a booking that has not arrived can be a no-show.',
    );
  a.status = 'NO_SHOW';
  a.slotKey = undefined;
  await a.save();
  return appointmentOut(a);
}

/** Moves bookings to another doctor or date (doctor leave, rule R10); every patient is messaged. */
export async function bulkMove({ appointmentIds = [], doctorId, date }) {
  let moved = 0;
  const target = doctorId ? await loadDoctor(doctorId) : null;
  const [card] = target ? await doctorCards([target]) : [null];
  for (const id of appointmentIds) {
    const a = await Appointment.findById(id);
    if (!a || !OPEN.includes(a.status)) continue;
    const newDate = date ?? a.date;
    const newDoctor = card ?? a.doctor;
    try {
      a.doctor = newDoctor;
      a.date = newDate;
      a.slotStart = atIST(newDate, a.time);
      a.slotKey = `${newDoctor.id}|${newDate}|${a.time}|0`;
      await a.save();
      moved++;
      await publish('opd.appointment.moved', { appointmentId: String(a._id) });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
  return { moved, messaged: moved };
}

/** Today's tele-consultations with their call state. */
export async function teleConsults() {
  const today = ymdIST();
  const now = hhmmIST();
  const items = await Appointment.find({
    date: today,
    visitType: 'TELE',
    status: { $nin: ['CANCELLED', 'RESCHEDULED'] },
  })
    .sort({ time: 1 })
    .lean();
  return listOf(
    items.map((a) => ({
      id: String(a._id),
      time: a.time,
      patient: appointmentOut(a).patient,
      doctor: appointmentOut(a).doctor,
      paid: a.fee.amount,
      consent: Boolean(a.whatsappConsent ?? true),
      status:
        a.status === 'IN_CONSULT'
          ? 'IN_CALL'
          : a.status === 'COMPLETED'
            ? 'DONE'
            : minutes(a.time) - minutes(now) <= 15
              ? 'WAITING_ROOM'
              : 'SCHEDULED',
    })),
  );
}

export async function startTele(id) {
  const a = await findAppointment(id);
  if (a.visitType !== 'TELE')
    throw new AppError(409, 'INVALID_STATE', 'This is not a tele-consultation.');
  a.status = 'IN_CONSULT';
  await a.save();
  const base = process.env.TELE_URL_BASE ?? 'https://meet.example.in/opd';
  return { joinUrl: `${base}/${a._id}`, appointment: appointmentOut(a) };
}
