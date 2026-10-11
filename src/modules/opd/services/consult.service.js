import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { current } from '../../../core/tenancy/context.js';
import { User } from '../../../core/auth/models/user.model.js';
import { Doctor, Service } from '../../setup/index.js';
import { createBill, finalizeBill, receivePayment } from '../../billing/index.js';
import { ALLERGY_GROUPS, DRUG_ROWS, ICD10, INTERACTIONS } from '../data/clinical.js';
import { Appointment, OpdVisit } from '../models/opd.models.js';
import { defaultPriceList, doctorCards, loadDoctor, rateOf } from './common.js';
import { visitOut } from './dto.js';
import { book } from './appointment.service.js';
import { findVisit, queue } from './visit.service.js';

const DRUGS = DRUG_ROWS.map(([id, brand, generic, form, allergyGroup, group]) => ({
  id,
  brand,
  generic,
  form,
  allergyGroup,
  group,
}));
const drugById = new Map(DRUGS.map((d) => [d.id, d]));
const like = (text, q) =>
  !q ||
  String(text ?? '')
    .toLowerCase()
    .includes(String(q).toLowerCase());

const ORDER_TYPE = { LAB: 'LAB', RAD: 'RAD', PROCEDURE: 'PROC' };

// ---------------------------------------------------------------- look-ups

export function icd10({ q }) {
  const items = ICD10.filter(([code, name]) => like(code, q) || like(name, q))
    .slice(0, 12)
    .map(([code, name]) => ({ code, name }));
  return { items, total: items.length, page: 1, limit: 12 };
}

export function formulary({ q }) {
  const items = DRUGS.filter((d) => like(d.brand, q) || like(d.generic, q)).slice(0, 10);
  return { items, total: items.length, page: 1, limit: 10 };
}

/** Lab tests, radiology and procedures the hospital bills (the Service master). */
export async function orderables({ q, type }) {
  const categories = type
    ? Object.keys(ORDER_TYPE).filter((c) => ORDER_TYPE[c] === type)
    : Object.keys(ORDER_TYPE);
  const filter = { category: { $in: categories }, status: 'ACTIVE', isActive: true };
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { code: rx }];
  }
  const [services, list] = await Promise.all([
    Service.find(filter).sort({ name: 1 }).limit(12).lean(),
    defaultPriceList(),
  ]);
  const items = services.map((s) => ({
    code: s.code,
    serviceId: String(s._id),
    name: s.name,
    type: ORDER_TYPE[s.category],
    price: rateOf(s, list) ?? 0,
  }));
  return { items, total: items.length, page: 1, limit: 12 };
}

/** Order lines for service codes (order sets), priced on the default list. */
export async function ordersFor(codes) {
  if (!codes.length) return [];
  const [services, list] = await Promise.all([
    Service.find({ code: { $in: codes }, status: 'ACTIVE', isActive: true }).lean(),
    defaultPriceList(),
  ]);
  return codes
    .map((c) => services.find((s) => s.code === c))
    .filter(Boolean)
    .map((s) => ({
      code: s.code,
      serviceId: String(s._id),
      name: s.name,
      type: ORDER_TYPE[s.category] ?? 'PROC',
      priority: 'ROUTINE',
      price: rateOf(s, list) ?? 0,
      status: 'DRAFT',
    }));
}

// ---------------------------------------------------------------- consultation

const emptyConsultation = (v) => ({
  status: 'DRAFT',
  complaints: v.complaint ?? '',
  history: '',
  examination: '',
  diagnoses: [],
  noDiagnosisReason: '',
  rx: [],
  orders: [],
  advice: '',
  followUp: { date: '', note: '' },
  printLanguage: 'en',
  specialty: null,
  certificate: null,
  addenda: [],
  savedAt: null,
  signedAt: null,
  signedBy: null,
  rev: 0,
});

/** Allergy, interaction and duplicate checks on the prescription (run on every save). */
function checks(v, rx) {
  const groups = new Set(
    (v.patient.allergies ?? []).flatMap((a) => ALLERGY_GROUPS[a.toLowerCase()] ?? []),
  );
  const drugs = rx.map((r) => drugById.get(r.drugId)).filter(Boolean);
  const allergy = drugs
    .filter((d) => d.allergyGroup && groups.has(d.allergyGroup))
    .map((d) => ({ drug: d.brand, allergy: d.allergyGroup }));
  const present = new Set(drugs.map((d) => d.group).filter(Boolean));
  const interactions = INTERACTIONS.filter(([a, b]) => present.has(a) && present.has(b)).map(
    ([, , message]) => ({
      message,
    }),
  );
  const generics = rx.map((r) => r.generic).filter(Boolean);
  const duplicates = [...new Set(generics.filter((g, i) => generics.indexOf(g) !== i))];
  return { allergy, interactions, duplicates };
}

function consultationOut(v) {
  const c = v.consultation ? (v.consultation.toObject?.() ?? v.consultation) : emptyConsultation(v);
  const { rev, ...rest } = c;
  return {
    ...emptyConsultation(v),
    ...rest,
    followUp: { date: c.followUp?.date ?? '', note: c.followUp?.note ?? '' },
    addenda: (c.addenda ?? []).map((a) => ({
      id: String(a._id ?? ''),
      text: a.text,
      by: a.by,
      at: a.at,
    })),
    version: rev ?? 0,
    visitId: String(v._id),
    checks: checks(v, c.rx ?? []),
  };
}

const FIELDS = [
  'complaints',
  'history',
  'examination',
  'diagnoses',
  'noDiagnosisReason',
  'rx',
  'orders',
  'advice',
  'followUp',
  'printLanguage',
  'specialty',
];
const pick = (body) =>
  Object.fromEntries(FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

export async function getConsultation(id) {
  return consultationOut(await findVisit(id));
}

/** Auto-save of the draft. A signed consultation is never edited (rule R14). */
export async function saveConsultation(id, body) {
  const v = await findVisit(id);
  if (v.consultation?.status === 'SIGNED')
    throw new AppError(
      409,
      'INVALID_STATE',
      'This consultation is signed. Add an addendum instead (rule R14).',
    );
  const cur = v.consultation ? v.consultation.toObject() : emptyConsultation(v);
  v.consultation = {
    ...cur,
    ...pick(body),
    status: 'DRAFT',
    savedAt: new Date(),
    rev: (cur.rev ?? 0) + 1,
  };
  if (v.stage !== 'DONE' && v.stage !== 'WITH_DOCTOR') v.stage = 'WITH_DOCTOR';
  await v.save();
  return consultationOut(v);
}

/**
 * Sign and complete (rule R13: a diagnosis or the reason there is none). Orders go to the
 * worklists by event; a follow-up date books a follow-up with the same doctor.
 */
export async function completeVisit(id, body = {}) {
  const user = await User.findById(current().userId).select('name').lean();
  const result = await withTransaction(async () => {
    const v = await findVisit(id);
    if (v.consultation?.status === 'SIGNED')
      throw new AppError(409, 'INVALID_STATE', 'This consultation is already signed.');
    const cur = v.consultation ? v.consultation.toObject() : emptyConsultation(v);
    const c = { ...cur, ...pick(body) };
    if (!c.diagnoses?.length && !String(c.noDiagnosisReason ?? '').trim())
      throw new AppError(
        422,
        'NO_DIAGNOSIS',
        'Add at least one diagnosis, or the reason there is none (rule R13).',
        [
          {
            path: 'diagnoses',
            message: 'Add at least one diagnosis, or the reason there is none.',
          },
        ],
      );
    v.consultation = {
      ...c,
      status: 'SIGNED',
      signedAt: new Date(),
      signedBy: user?.name ?? v.doctor?.name,
      savedAt: new Date(),
      rev: (c.rev ?? 0) + 1,
    };
    v.stage = 'DONE';
    v.status = c.orders?.length ? 'ORDERS_PENDING' : 'CONSULTED';
    v.closedAt = new Date();
    await v.save();
    if (v.appointmentId)
      await Appointment.updateOne({ _id: v.appointmentId }, { $set: { status: 'COMPLETED' } });
    await publish('opd.visit.completed', {
      visitId: String(v._id),
      patientId: String(v.patient.id),
      doctorId: String(v.doctor.id),
      orders: (c.orders ?? []).map((o) => ({
        code: o.code,
        serviceId: o.serviceId && String(o.serviceId),
        priority: o.priority,
      })),
      diagnoses: c.diagnoses ?? [],
      // The pharmacy queue takes the prescription from here.
      rx: (c.rx ?? []).map((r) => ({
        drugId: r.drugId,
        brand: r.brand,
        generic: r.generic,
        dose: r.dose,
        frequency: r.frequency,
        days: r.days,
        route: r.route,
        instructions: r.instructions,
      })),
    });
    return v;
  });
  let followUp = null;
  const fu = result.consultation.followUp;
  if (fu?.date) {
    try {
      const doctor = await loadDoctor(result.doctor.id);
      const free = await nextOpenSlot(doctor, fu.date);
      if (free)
        followUp = await book({
          patientId: result.patient.id,
          doctorId: doctor._id,
          date: fu.date,
          time: free,
          visitType: 'FOLLOW_UP',
          channel: 'DESK',
          notes: fu.note,
        });
    } catch {
      // The visit is signed; the desk books the follow-up by hand if no slot is free.
      followUp = null;
    }
  }
  const next = (await queue({ doctorId: String(result.doctor.id), stage: 'doctor' })).items.find(
    (x) => x.stage === 'TRIAGED',
  );
  return {
    visit: visitOut(result),
    consultation: consultationOut(result),
    followUp,
    next: next ?? null,
  };
}

async function nextOpenSlot(doctor, date) {
  const { slotTimes } = await import('./schedule.service.js');
  const times = (await slotTimes(doctor, date)).map((s) => s.time);
  const taken = new Set(
    (
      await Appointment.find({
        'doctor.id': doctor._id,
        date,
        status: { $nin: ['CANCELLED', 'RESCHEDULED'] },
      })
        .select('time')
        .lean()
    ).map((a) => a.time),
  );
  return times.find((t) => !taken.has(t)) ?? null;
}

export async function addAddendum(id, { text }) {
  const user = await User.findById(current().userId).select('name').lean();
  const v = await findVisit(id);
  if (!v.consultation) throw errors.notFound('Consultation');
  v.consultation.addenda.push({
    text,
    by: user?.name ?? 'Doctor',
    byUserId: current().userId,
    at: new Date(),
  });
  await v.save();
  return consultationOut(v);
}

export async function shareVisit(id, { channel = 'WHATSAPP' }) {
  const v = await findVisit(id);
  await publish('opd.visit.shared', { visitId: String(v._id), channel, mobile: v.patient.mobile });
  return { sentTo: v.patient.mobile, channel, at: new Date().toISOString() };
}

/** Admission from OPD hands the patient to the IPD admission desk (event for IPD). */
export async function requestAdmission(id, body) {
  const v = await findVisit(id);
  v.admissionRequest = {
    ...body,
    status: 'REQUESTED',
    requestedAt: new Date(),
    requestedBy: current().userId,
  };
  await v.save();
  await publish('opd.admission.requested', {
    visitId: String(v._id),
    patientId: String(v.patient.id),
    ...body,
  });
  return { id: String(v._id), ...v.admissionRequest };
}

/** Referral: a same-day slot with the other doctor, the note visible to them. */
export async function refer(id, { doctorId, priority, note }) {
  const v = await findVisit(id);
  const doctor = await loadDoctor(doctorId);
  const [card] = await doctorCards([doctor]);
  const today = v.date;
  const slot = await nextOpenSlot(doctor, today);
  let appointment = null;
  if (slot) {
    try {
      appointment = await book({
        patientId: v.patient.id,
        doctorId: doctor._id,
        date: today,
        time: slot,
        visitType: 'NEW',
        channel: 'DESK',
        notes: `Referral from ${v.doctor.name}: ${note}`,
      });
    } catch {
      appointment = null;
    }
  }
  const r = {
    doctorId: doctor._id,
    priority,
    note,
    slot: appointment ? slot : null,
    at: new Date(),
  };
  v.referrals.push(r);
  await v.save();
  return {
    id: `${v._id}-${v.referrals.length}`,
    doctor: { id: String(card.id), name: card.name, department: card.department, room: card.room },
    slot: r.slot,
    note,
    priority,
  };
}

export async function issueCertificate(id, body) {
  const user = await User.findById(current().userId).select('name').lean();
  const v = await findVisit(id);
  const cert = {
    no: await documentNumber('MC'),
    ...body,
    signedAt: new Date(),
    signedBy: user?.name ?? v.doctor?.name,
  };
  const cur = v.consultation ? v.consultation.toObject() : emptyConsultation(v);
  v.consultation = { ...cur, certificate: cert };
  await v.save();
  return { id: cert.no, ...cert };
}

// ---------------------------------------------------------------- charges and close

async function chargeLines(v) {
  const c = v.consultation ?? emptyConsultation(v);
  const lines = [];
  if (v.fee?.amount > 0 || v.fee?.label === 'FREE_FOLLOW_UP')
    lines.push({
      id: `${v._id}-c`,
      name:
        v.fee.amount === 0
          ? 'Consultation, free follow-up'
          : `Consultation (${v.visitType === 'FOLLOW_UP' ? 'follow-up' : 'new visit'})`,
      qty: 1,
      amount: v.fee.paid ? 0 : v.fee.amount,
      paid: Boolean(v.fee.paid),
      serviceId: v.fee.serviceId ? String(v.fee.serviceId) : null,
    });
  for (const o of c.orders ?? [])
    lines.push({
      id: `${v._id}-${o.code}`,
      name: o.name,
      qty: 1,
      amount: o.price ?? 0,
      paid: false,
      serviceId: o.serviceId ? String(o.serviceId) : null,
    });
  return lines;
}

export async function visitCharges(id) {
  const v = await findVisit(id);
  const lines = await chargeLines(v);
  return { visitId: String(v._id), lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

/**
 * Clinic desk "Finish": bills what is due (consultation, if unpaid, and orders), finalises the
 * bill, takes the payment and closes the visit, all in one transaction. Billing rules apply
 * (open shift, cash limit, payment reference).
 */
export async function closeVisit(id, { mode = 'CASH', reference, outputs = [] }) {
  return withTransaction(async () => {
    const v = await findVisit(id);
    if (v.status === 'CLOSED')
      throw new AppError(409, 'INVALID_STATE', 'This visit is already closed.');
    const due = (await chargeLines(v)).filter((l) => l.amount > 0 && l.serviceId);
    let receipt = null;
    if (due.length) {
      const doctor = await Doctor.findById(v.doctor.id).select('userId').lean();
      const bill = await createBill({
        patientId: String(v.patient.id),
        type: 'OP',
        // The consulting doctor's login, so doctor payouts include the visit.
        doctorUserId: doctor?.userId ? String(doctor.userId) : undefined,
        lines: due.map((l) => ({ serviceId: l.serviceId, qty: l.qty })),
        notes: `OPD visit ${v.visitNo}`,
      });
      const final = await finalizeBill(bill.id, { version: bill.version });
      const pay = await receivePayment({
        patientId: String(v.patient.id),
        mode,
        reference,
        amount: final.totals.balance,
        allocations: [{ billId: final.id, amount: final.totals.balance }],
      });
      v.billId = final.id;
      receipt = {
        no: pay.receiptNo ?? pay.payment?.receiptNo ?? null,
        amount: final.totals.balance,
        mode,
        billNo: final.billNo,
      };
    }
    v.fee.paid = true;
    v.stage = 'DONE';
    v.status = 'CLOSED';
    v.closedAt ??= new Date();
    if (v.consultation && v.consultation.status !== 'SIGNED') v.consultation.status = 'SIGNED';
    v.receipt = receipt;
    await v.save();
    if (v.appointmentId)
      await Appointment.updateOne({ _id: v.appointmentId }, { $set: { status: 'COMPLETED' } });
    await publish('opd.visit.closed', {
      visitId: String(v._id),
      outputs,
      billId: v.billId ? String(v.billId) : null,
    });
    return { visit: visitOut(v), receipt, outputs };
  });
}

export { OpdVisit };
