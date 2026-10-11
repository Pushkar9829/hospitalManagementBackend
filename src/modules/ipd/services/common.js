import { errors } from '../../../core/errors/index.js';
import { Patient, patientCard } from '../../patients/index.js';
import { Department, Doctor } from '../../setup/index.js';
import { IpdSettings } from '../models/ipd.models.js';

export const ymdIST = (d = new Date()) =>
  new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const atIST = (ymd, hhmm = '00:00') => new Date(`${ymd}T${hhmm}:00+05:30`);
export const addDays = (ymd, n) => ymdIST(new Date(atIST(ymd, '12:00').getTime() + n * 86_400_000));
export const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const patientSnap = (p) => {
  const c = patientCard(p);
  return {
    id: p._id,
    uhid: c.uhid,
    name: c.name,
    gender: c.gender,
    age: c.age,
    mobile: c.mobile,
    allergies: c.allergies,
  };
};
export const patientOut = (s) =>
  s && {
    id: String(s.id),
    uhid: s.uhid,
    name: s.name,
    gender: s.gender,
    age: s.age,
    mobile: s.mobile,
    allergies: s.allergies ?? [],
  };

export async function loadPatient(id) {
  const p = await Patient.findById(id).lean();
  if (!p) throw errors.validation([{ path: 'patientId', message: 'Pick the patient' }]);
  if (p.status === 'MERGED')
    throw errors.conflict('PATIENT_MERGED', 'This UHID was merged; use the surviving record');
  return p;
}

export async function doctorSnap(id) {
  const d = await Doctor.findOne({ _id: id, isActive: true }).lean();
  if (!d) throw errors.validation([{ path: 'doctorId', message: 'Pick the admitting consultant' }]);
  const dept = await Department.findById(d.departmentId).select('name').lean();
  // userId is not stored on the snapshot; it ties the in-patient bill to the doctor's login.
  return { id: d._id, name: d.name, department: dept?.name ?? null, userId: d.userId ?? null };
}
export const doctorOut = (d) =>
  d && { id: d.id ? String(d.id) : null, name: d.name, department: d.department };

/** IPD settings, created with defaults on first use. */
export async function settingsDoc() {
  const found = await IpdSettings.findOne();
  if (found) return found;
  try {
    const [doc] = await IpdSettings.create([
      {
        deposits: {
          GENERAL: 10_000_00,
          SEMI_PRIVATE: 20_000_00,
          PRIVATE: 30_000_00,
          DELUXE: 40_000_00,
          ICU: 50_000_00,
          HDU: 40_000_00,
          ISOLATION: 30_000_00,
          DAYCARE: 5_000_00,
        },
      },
    ]);
    return doc;
  } catch (e) {
    if (e?.code === 11000) return IpdSettings.findOne();
    throw e;
  }
}

export const daysBetween = (from, to = new Date()) =>
  Math.max(0, Math.floor((atIST(ymdIST(to)) - atIST(ymdIST(from))) / 86_400_000));
