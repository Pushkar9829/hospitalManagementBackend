import { errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Department, Doctor, PriceList, Service } from '../../setup/index.js';
import { Patient, patientCard } from '../../patients/index.js';
import { DoctorSchedule } from '../models/opd.models.js';

export const TZ_OFFSET_MIN = 330;

/** Today (or `d`) in IST as YYYY-MM-DD. */
export function ymdIST(d = new Date()) {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Wall-clock IST HH:mm of an instant. */
export function hhmmIST(d = new Date()) {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000).toISOString().slice(11, 16);
}

/** An IST date and time as an instant. */
export const atIST = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+05:30`);

export const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const hhmm = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function addDays(ymd, n) {
  return ymdIST(new Date(atIST(ymd, '12:00').getTime() + n * 86_400_000));
}

/** MON..SUN for an IST date. */
export function weekdayOf(ymd) {
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][atIST(ymd, '12:00').getUTCDay()];
}

/** The patient as OPD screens show it (search card + no-known-allergies). */
export const patientSnap = (p) => ({
  ...patientCard(p),
  id: p._id,
  noKnownAllergies: Boolean(p.noKnownAllergies),
});

export const patientOut = (s) => ({
  id: String(s.id),
  uhid: s.uhid,
  name: s.name,
  gender: s.gender,
  age: s.age,
  mobile: s.mobile,
  allergies: s.allergies ?? [],
  noKnownAllergies: Boolean(s.noKnownAllergies),
});

export async function loadPatient(id) {
  const p = await Patient.findById(id).lean();
  if (!p) throw errors.validation([{ path: 'patientId', message: 'Pick a patient.' }]);
  if (p.status === 'MERGED')
    throw errors.conflict('PATIENT_MERGED', 'This UHID was merged; use the surviving record');
  return p;
}

/** Doctor card: name, department name and room (from the first session of the schedule). */
export async function doctorCards(doctors) {
  const depts = new Map(
    (
      await Department.find({ _id: { $in: doctors.map((d) => d.departmentId) } })
        .select('name')
        .lean()
    ).map((d) => [String(d._id), d.name]),
  );
  const schedules = new Map(
    (await DoctorSchedule.find({ doctorId: { $in: doctors.map((d) => d._id) } }).lean()).map(
      (s) => [String(s.doctorId), s],
    ),
  );
  return doctors.map((d) => {
    const s = schedules.get(String(d._id));
    const room = s?.week.flatMap((w) => w.sessions).find((x) => x.room)?.room ?? null;
    return {
      id: d._id,
      name: d.name,
      department: depts.get(String(d.departmentId)) ?? null,
      room,
    };
  });
}

export const doctorOut = (d) =>
  d && { id: String(d.id), name: d.name, department: d.department, room: d.room };

export async function loadDoctor(id) {
  const d = await Doctor.findOne({ _id: id, isActive: true }).lean();
  if (!d) throw errors.validation([{ path: 'doctorId', message: 'Pick a doctor.' }]);
  return d;
}

/** The signed-in user's doctor record ("me"), or null when the user is not a doctor. */
export async function myDoctor() {
  return Doctor.findOne({ userId: current().userId, isActive: true }).lean();
}

/** Resolves a doctorId query value: 'me' becomes the signed-in doctor. */
export async function doctorIdFor(value) {
  if (value !== 'me') return value || null;
  const d = await myDoctor();
  return d ? d._id : '000000000000000000000000';
}

/** The default price list (or the GENERAL one) for showing fees. */
export async function defaultPriceList() {
  const lists = await PriceList.find({ isActive: true }).lean();
  return lists.find((l) => l.isDefault) ?? lists.find((l) => l.kind === 'GENERAL') ?? null;
}

/** A service's active rate on a price list, in paise. */
export function rateOf(service, list) {
  if (!service || !list) return null;
  return service.rates.find((r) => String(r.priceListId) === String(list._id))?.amount ?? null;
}

export async function servicesById(ids) {
  const list = ids.filter(Boolean);
  if (!list.length) return new Map();
  return new Map(
    (await Service.find({ _id: { $in: list } }).lean()).map((s) => [String(s._id), s]),
  );
}

/** { items, total, page, limit } for an already-loaded list. */
export const listOf = (items) => ({
  items,
  total: items.length,
  page: 1,
  limit: Math.max(100, items.length),
});
