import { doctorOut, patientOut } from './common.js';

/** API shapes shared by the OPD services (the contract the web screens use). */

export const feeOut = (f = {}) => ({
  amount: f.amount ?? 0,
  label: f.label ?? null,
  freeDay: f.freeDay ?? null,
  window: f.window ?? null,
  paid: Boolean(f.paid),
  prepaid: Boolean(f.prepaid),
});

export const appointmentOut = (a) => ({
  id: String(a._id),
  apptNo: a.apptNo,
  date: a.date,
  time: a.time,
  slotStart: a.slotStart,
  doctor: doctorOut(a.doctor),
  patient: patientOut(a.patient),
  visitType: a.visitType,
  channel: a.channel,
  status: a.status,
  fee: feeOut(a.fee),
  token: a.token ?? null,
  visitId: a.visitId ? String(a.visitId) : null,
  notes: a.notes ?? '',
  reason: a.reason ?? null,
  createdAt: a.createdAt,
});

/** Minutes since check-in for patients still in the building. */
export function waitedMin(v, now = new Date()) {
  if (v.stage === 'DONE' || !v.checkedInAt) return null;
  return Math.max(0, Math.round((now - new Date(v.checkedInAt)) / 60000));
}

export const queueEntry = (v) => ({
  visitId: String(v._id),
  appointmentId: v.appointmentId ? String(v.appointmentId) : null,
  token: v.token ?? null,
  patient: patientOut(v.patient),
  doctor: doctorOut(v.doctor),
  visitType: v.visitType,
  walkIn: Boolean(v.walkIn),
  late: Boolean(v.late),
  stage: v.stage,
  status: v.status,
  priority: v.priority ?? null,
  complaint: v.complaint ?? '',
  checkedInAt: v.checkedInAt,
  waitedMin: waitedMin(v),
  feeDue: v.fee && !v.fee.paid ? v.fee.amount : 0,
  vitals: v.vitals ?? null,
});

export const visitOut = (v, extra = {}) => ({
  id: String(v._id),
  visitNo: v.visitNo,
  token: v.token ?? null,
  appointmentId: v.appointmentId ? String(v.appointmentId) : null,
  date: v.date,
  patient: patientOut(v.patient),
  doctor: doctorOut(v.doctor),
  visitType: v.visitType,
  channel: v.channel,
  walkIn: Boolean(v.walkIn),
  stage: v.stage,
  status: v.status,
  priority: v.priority ?? null,
  complaint: v.complaint ?? '',
  checkedInAt: v.checkedInAt,
  calledAt: v.calledAt ?? null,
  closedAt: v.closedAt ?? null,
  waitedMin: waitedMin(v),
  vitals: v.vitals ?? null,
  triageSkipped: v.triageSkipped?.reason ? v.triageSkipped : null,
  procedures: (v.procedures ?? []).map((p) => ({ id: String(p._id), ...p, _id: undefined })),
  fee: feeOut(v.fee),
  history: [],
  vitalsTrend: [],
  triageRequired: false,
  ...extra,
});
