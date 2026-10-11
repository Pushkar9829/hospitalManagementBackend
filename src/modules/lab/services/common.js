import { User } from '../../../core/auth/models/user.model.js';
import { errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Patient, patientCard } from '../../patients/index.js';
import { LabSettings } from '../models/lab.models.js';

export const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const ymdIST = (d = new Date()) =>
  new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const atIST = (ymd, hhmm = '00:00') => new Date(`${ymd}T${hhmm}:00+05:30`);

/** The signed-in user (id and name) for the audit fields every step stores (R20). */
export async function me() {
  const c = current();
  if (!c.userId) return { id: null, name: c.userName ?? 'System' };
  const u = await User.findById(c.userId).select('name').lean();
  return { id: u?._id ?? null, name: u?.name ?? 'System' };
}

export async function patientSnap(patientId) {
  const p = await Patient.findById(patientId).lean();
  if (!p) throw errors.validation([{ path: 'patientId', message: 'Pick the patient' }]);
  if (p.status === 'MERGED')
    throw errors.conflict('PATIENT_MERGED', 'This UHID was merged; use the surviving record');
  const c = patientCard(p);
  return {
    id: p._id,
    uhid: c.uhid,
    name: c.name,
    gender: p.gender,
    age: c.age,
    ageDays: Math.max(0, Math.floor((Date.now() - new Date(p.dob).getTime()) / 86_400_000)),
    mobile: c.mobile,
  };
}
export const patientOut = (s) =>
  s && {
    id: String(s.id),
    uhid: s.uhid,
    name: s.name,
    gender: s.gender,
    age: s.age,
    mobile: s.mobile,
  };

/** Lab settings, created with defaults on first use. */
export async function settingsDoc() {
  const found = await LabSettings.findOne();
  if (found) return found;
  try {
    const [doc] = await LabSettings.create([{}]);
    return doc;
  } catch (e) {
    if (e?.code === 11000) return LabSettings.findOne();
    throw e;
  }
}

const who = (u) => (u?.name ? u.name : null);

export const itemOut = (i) => ({
  id: String(i._id),
  orderNo: i.orderNo,
  orderedAt: i.orderedAt,
  source: i.source,
  visitId: i.visitId ? String(i.visitId) : null,
  admissionId: i.admissionId ? String(i.admissionId) : null,
  location: i.location ?? null,
  patient: patientOut(i.patient),
  doctor: i.doctor?.name
    ? { id: i.doctor.id ? String(i.doctor.id) : null, name: i.doctor.name }
    : null,
  payerKind: i.payerKind,
  billId: i.billId ? String(i.billId) : null,
  priority: i.priority,
  clinicalNotes: i.clinicalNotes ?? null,
  testId: String(i.testId),
  code: i.code,
  name: i.name,
  department: i.department,
  analyser: i.analyser ?? null,
  sensitive: Boolean(i.sensitive),
  status: i.status,
  recollect: Boolean(i.recollect),
  sampleNo: i.sampleNo ?? null,
  results: (i.results ?? []).map((r) => ({
    code: r.code,
    name: r.name,
    unit: r.unit ?? null,
    value: r.value ?? null,
    flag: r.flag ?? null,
    range: r.range ?? null,
    critical: Boolean(r.critical),
    delta: r.delta?.prev != null ? r.delta : null,
  })),
  holds: (i.holds ?? []).map((h) => ({
    id: String(h._id),
    kind: h.kind,
    open: h.open,
    note: h.note ?? null,
    at: h.at,
  })),
  comment: i.comment ?? null,
  enteredBy: who(i.enteredBy),
  verifiedBy: who(i.verifiedBy),
  releasedBy: who(i.releasedBy),
  collectedAt: i.collectedAt ?? null,
  receivedAt: i.receivedAt ?? null,
  enteredAt: i.enteredAt ?? null,
  verifiedAt: i.verifiedAt ?? null,
  releasedAt: i.releasedAt ?? null,
  dueAt: i.dueAt ?? null,
  overdue: Boolean(i.dueAt && !i.releasedAt && i.dueAt < new Date() && i.status !== 'CANCELLED'),
  reportVersion: i.reportVersion ?? 1,
  amendments: (i.amendments ?? []).map((a) => ({
    version: a.version,
    reason: a.reason,
    amendedAt: a.amendedAt,
    amendedBy: a.amendedBy,
  })),
  acknowledgedAt: i.acknowledgedAt ?? null,
  acknowledgedBy: i.acknowledgedBy ?? null,
});
