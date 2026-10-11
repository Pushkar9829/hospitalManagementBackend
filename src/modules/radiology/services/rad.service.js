import { z } from 'zod';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { current } from '../../../core/tenancy/context.js';
import { Bill, createBill } from '../../billing/index.js';
import { Admission, addCharge } from '../../ipd/index.js';
import { Patient, patientCard } from '../../patients/index.js';
import { Doctor, Service } from '../../setup/index.js';
import { DEFAULT_ROOMS, DEFAULT_STUDIES, guessModality } from '../data/studies.js';
import { MODALITIES, RadSettings, RadStudy, RadStudyDef } from '../models/rad.models.js';

const ACTIVE_STAY = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];
const PAY_LATER = ['CORPORATE', 'SCHEME', 'INSURANCE', 'CREDIT'];
const RANK = { STAT: 0, URGENT: 1, ROUTINE: 2 };
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ymdIST = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const atIST = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+05:30`);

async function me() {
  const c = current();
  if (!c.userId) return { id: null, name: c.userName ?? 'System' };
  const u = await User.findById(c.userId).select('name').lean();
  return { id: u?._id ?? null, name: u?.name ?? 'System' };
}

async function patientSnap(patientId) {
  const p = await Patient.findById(patientId).lean();
  if (!p) throw errors.validation([{ path: 'patientId', message: 'Pick the patient' }]);
  if (p.status === 'MERGED')
    throw errors.conflict('PATIENT_MERGED', 'This UHID was merged; use the surviving record');
  const c = patientCard(p);
  return { id: p._id, uhid: c.uhid, name: c.name, gender: p.gender, age: c.age, mobile: c.mobile };
}

// ---------------------------------------------------------------- settings and study master

export async function settingsDoc() {
  const found = await RadSettings.findOne();
  if (found) return found;
  try {
    const [doc] = await RadSettings.create([{ rooms: DEFAULT_ROOMS }]);
    return doc;
  } catch (e) {
    if (e?.code === 11000) return RadSettings.findOne();
    throw e;
  }
}

const settingsOut = (s) => ({
  rooms: s.rooms.map((r) => ({
    code: r.code,
    name: r.name,
    modality: r.modality,
    slotMin: r.slotMin,
  })),
  dayStart: s.dayStart,
  dayEnd: s.dayEnd,
  pacsViewerUrl: s.pacsViewerUrl ?? null,
  creatinineLimit: s.creatinineLimit,
  version: s.version,
});

export const settingsInput = z.object({
  rooms: z
    .array(
      z.object({
        code: z.string().trim().min(2).max(10),
        name: z.string().trim().min(2).max(60),
        modality: z.enum(MODALITIES),
        slotMin: z.number().int().min(5).max(180),
      }),
    )
    .max(40)
    .optional(),
  dayStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  dayEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  pacsViewerUrl: z.string().trim().url().max(300).or(z.literal('')).optional(),
  creatinineLimit: z.number().min(0.5).max(5).optional(),
});

export async function getSettings() {
  return settingsOut(await settingsDoc());
}

export async function saveSettings(input) {
  const s = await settingsDoc();
  if (input.rooms) {
    const codes = input.rooms.map((r) => r.code);
    if (new Set(codes).size !== codes.length)
      throw errors.validation([{ path: 'rooms', message: 'Each room needs its own code' }]);
  }
  s.set({ ...input, pacsViewerUrl: input.pacsViewerUrl === '' ? undefined : input.pacsViewerUrl });
  await s.save();
  return settingsOut(s);
}

/** Every active RAD service gets a study definition (defaults for common studies). */
export async function ensureDefs() {
  const services = await Service.find({ category: 'RAD', isActive: true }).lean();
  const have = new Set(
    (await RadStudyDef.find({}).select('serviceId').lean()).map((d) => String(d.serviceId)),
  );
  for (const s of services) {
    if (have.has(String(s._id))) continue;
    const def = DEFAULT_STUDIES[s.code] ?? { modality: guessModality(s.name) };
    try {
      await RadStudyDef.create([{ serviceId: s._id, code: s.code, name: s.name, ...def }]);
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }
  }
}

const defOut = (d) => ({
  id: String(d._id),
  serviceId: String(d.serviceId),
  code: d.code,
  name: d.name,
  modality: d.modality,
  slotMin: d.slotMin ?? null,
  prep: d.prep ?? null,
  contrast: Boolean(d.contrast),
  pcpndt: Boolean(d.pcpndt),
  template: d.template ?? null,
  isActive: d.isActive !== false,
});

export async function listDefs({ modality } = {}) {
  await ensureDefs();
  const rows = await RadStudyDef.find(modality ? { modality } : {})
    .sort({ modality: 1, name: 1 })
    .lean();
  return { items: rows.map(defOut), total: rows.length, page: 1, limit: rows.length };
}

export const defInput = z.object({
  modality: z.enum(MODALITIES).optional(),
  slotMin: z.number().int().min(5).max(180).nullable().optional(),
  prep: z.string().trim().max(500).optional(),
  contrast: z.boolean().optional(),
  pcpndt: z.boolean().optional(),
  template: z.string().trim().max(6000).optional(),
  isActive: z.boolean().optional(),
});

export async function updateDef(id, input) {
  const d = await RadStudyDef.findById(id);
  if (!d) throw errors.notFound('Study');
  d.set({ ...input, slotMin: input.slotMin === null ? undefined : (input.slotMin ?? d.slotMin) });
  await d.save();
  return defOut(d.toObject());
}

async function defForService(serviceId) {
  let d = await RadStudyDef.findOne({ serviceId, isActive: true }).lean();
  if (!d) {
    await ensureDefs();
    d = await RadStudyDef.findOne({ serviceId, isActive: true }).lean();
  }
  return d;
}

// ---------------------------------------------------------------- studies

const studyOut = (s, pacs) => ({
  id: String(s._id),
  accessionNo: s.accessionNo,
  orderedAt: s.orderedAt,
  source: s.source,
  visitId: s.visitId ? String(s.visitId) : null,
  admissionId: s.admissionId ? String(s.admissionId) : null,
  location: s.location ?? null,
  patient: {
    id: String(s.patient.id),
    uhid: s.patient.uhid,
    name: s.patient.name,
    gender: s.patient.gender,
    age: s.patient.age,
  },
  doctor: s.doctor?.name
    ? { id: s.doctor.id ? String(s.doctor.id) : null, name: s.doctor.name }
    : null,
  payerKind: s.payerKind,
  billId: s.billId ? String(s.billId) : null,
  priority: s.priority,
  clinicalNotes: s.clinicalNotes ?? null,
  defId: String(s.defId),
  code: s.code,
  name: s.name,
  modality: s.modality,
  contrast: Boolean(s.contrast),
  pcpndt: Boolean(s.pcpndt),
  status: s.status,
  room: s.room ?? null,
  scheduledAt: s.scheduledAt ?? null,
  arrivedAt: s.arrivedAt ?? null,
  contrastCheck: s.contrastCheck?.at ? s.contrastCheck : null,
  formF: s.formF?.at ? s.formF : null,
  performedAt: s.performedAt ?? null,
  performedBy: s.performedBy ?? null,
  techNotes: s.techNotes ?? null,
  report: s.report?.draftAt
    ? {
        findings: s.report.findings,
        impression: s.report.impression,
        draftBy: s.report.draftBy?.name ?? null,
        draftAt: s.report.draftAt,
      }
    : null,
  critical: Boolean(s.critical),
  signedBy: s.signedBy?.name ?? null,
  signedAt: s.signedAt ?? null,
  addenda: s.addenda ?? [],
  acknowledgedAt: s.acknowledgedAt ?? null,
  acknowledgedBy: s.acknowledgedBy ?? null,
  viewerUrl:
    pacs && ['PERFORMED', 'REPORTED', 'SIGNED'].includes(s.status)
      ? pacs.replace('{accession}', encodeURIComponent(s.accessionNo))
      : null,
});

async function out(s) {
  const st = await settingsDoc();
  return studyOut(s.toObject ? s.toObject() : s, st.pacsViewerUrl);
}

async function createStudies(base, serviceIds, priority) {
  const rows = [];
  for (const sid of serviceIds) {
    const d = await defForService(sid);
    if (!d) continue;
    rows.push({
      ...base,
      accessionNo: await documentNumber('RAD'),
      orderedAt: new Date(),
      priority: priority ?? 'ROUTINE',
      defId: d._id,
      serviceId: d.serviceId,
      code: d.code,
      name: d.name,
      modality: d.modality,
      contrast: d.contrast,
      pcpndt: d.pcpndt,
      slotMin: d.slotMin,
    });
  }
  return rows.length ? RadStudy.create(rows, { ordered: true }) : [];
}

/** Event opd.visit.completed: imaging ordered in the consultation joins the worklist. */
export async function fromOpdVisit({ visitId, patientId, doctorId, orders = [] }) {
  if (!orders.length || (await RadStudy.exists({ visitId }))) return 0;
  const rad = await Service.find({
    _id: { $in: orders.map((o) => o.serviceId).filter(Boolean) },
    category: 'RAD',
  })
    .select('_id')
    .lean();
  if (!rad.length) return 0;
  const doctor = doctorId ? await Doctor.findById(doctorId).select('name').lean() : null;
  const priorities = new Map(orders.map((o) => [String(o.serviceId), o.priority]));
  let n = 0;
  for (const s of rad) {
    const made = await createStudies(
      {
        source: 'OPD',
        visitId,
        location: 'OPD',
        patient: await patientSnap(patientId),
        doctor: doctor ? { id: doctor._id, name: doctor.name } : undefined,
        payerKind: 'CASH',
      },
      [s._id],
      priorities.get(String(s._id)),
    );
    n += made.length;
  }
  return n;
}

/** Event opd.visit.closed: the clinic bill with the imaging is paid. */
export async function opdVisitClosed({ visitId, billId }) {
  if (!billId) return 0;
  return (await RadStudy.updateMany({ visitId, billId: null }, { $set: { billId } })).modifiedCount;
}

export async function createOrder(input) {
  const { admissionId, patientId, studies, priority = 'ROUTINE', clinicalNotes } = input;
  const services = await Service.find({ _id: { $in: studies }, category: 'RAD', status: 'ACTIVE' })
    .select('_id')
    .lean();
  if (services.length !== new Set(studies.map(String)).size)
    throw errors.validation([
      { path: 'studies', message: 'Pick imaging studies that are approved' },
    ]);
  let base;
  if (admissionId) {
    const a = await Admission.findById(admissionId).lean();
    if (!a) throw errors.notFound('Admission');
    if (!ACTIVE_STAY.includes(a.status))
      throw new AppError(409, 'INVALID_STATE', 'The stay is closed.');
    base = {
      source: 'IPD',
      admissionId: a._id,
      ipNo: a.ipNo,
      location: `${a.bed?.ward ?? ''} ${a.bed?.code ?? ''}`.trim(),
      patient: await patientSnap(a.patient.id),
      doctor: a.consultant?.id ? { id: a.consultant.id, name: a.consultant.name } : undefined,
      payerKind: a.payer?.kind ?? 'CASH',
    };
  } else {
    if (!patientId) throw errors.validation([{ path: 'patientId', message: 'Pick the patient' }]);
    base = {
      source: 'WALKIN',
      location: 'Radiology desk',
      patient: await patientSnap(patientId),
      payerKind: 'CASH',
    };
    if (input.doctorId) {
      const d = await Doctor.findById(input.doctorId).select('name').lean();
      if (d) base.doctor = { id: d._id, name: d.name };
    }
  }
  const made = await withTransaction(async () => {
    let billId;
    if (base.source === 'WALKIN')
      billId = (
        await createBill({
          patientId: String(base.patient.id),
          type: 'OP',
          lines: studies.map((s) => ({ serviceId: String(s), qty: 1 })),
          notes: 'Imaging, radiology desk',
        })
      ).id;
    return createStudies({ ...base, billId, clinicalNotes }, studies, priority);
  });
  if (base.source === 'IPD') {
    const by = (await me()).name;
    for (const s of studies)
      await addCharge(String(base.admissionId), { serviceId: String(s), source: 'RAD' }, by);
  }
  await publish('rad.order.created', { count: made.length, source: base.source });
  const st = await settingsDoc();
  return { items: made.map((s) => studyOut(s.toObject(), st.pacsViewerUrl)) };
}

const STAGE = {
  schedule: ['ORDERED'],
  today: ['SCHEDULED', 'ARRIVED'],
  report: ['PERFORMED', 'REPORTED'],
  sign: ['REPORTED'],
  signed: ['SIGNED'],
};

export async function listStudies(q = {}) {
  const filter = {};
  if (q.stage) filter.status = { $in: STAGE[q.stage] ?? [] };
  else if (q.status) filter.status = { $in: q.status.split(',') };
  else filter.status = { $ne: 'CANCELLED' };
  if (q.modality) filter.modality = q.modality;
  if (q.patientId) filter['patient.id'] = q.patientId;
  if (q.visitId) filter.visitId = q.visitId;
  if (q.admissionId) filter.admissionId = q.admissionId;
  if (q.pcpndt) filter.pcpndt = true;
  if (q.date) {
    const start = atIST(q.date, '00:00');
    filter.scheduledAt = { $gte: start, $lt: new Date(start.getTime() + 86_400_000) };
  }
  if (q.stage === 'signed')
    filter.signedAt = { $gte: new Date(Date.now() - (q.days ?? 7) * 86_400_000) };
  if (q.q) {
    const rx = new RegExp(escape(q.q), 'i');
    filter.$or = [
      { 'patient.name': rx },
      { 'patient.uhid': rx },
      { accessionNo: rx },
      { name: rx },
    ];
  }
  const rows = await RadStudy.find(filter).sort({ orderedAt: 1 }).limit(300).lean();
  if (q.stage === 'today') rows.sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  else if (q.stage === 'signed') rows.sort((a, b) => b.signedAt - a.signedAt);
  else rows.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.orderedAt - b.orderedAt);
  const st = await settingsDoc();
  return {
    items: rows.map((r) => studyOut(r, st.pacsViewerUrl)),
    total: rows.length,
    page: 1,
    limit: 300,
  };
}

async function findStudy(id) {
  const s = await RadStudy.findById(id);
  if (!s) throw errors.notFound('Study');
  return s;
}

export async function getStudy(id) {
  return out(await findStudy(id));
}

export async function counts() {
  const rows = await RadStudy.aggregate([
    { $match: { status: { $nin: ['CANCELLED', 'SIGNED'] } } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  return {
    schedule: by.ORDERED ?? 0,
    today: (by.SCHEDULED ?? 0) + (by.ARRIVED ?? 0),
    report: (by.PERFORMED ?? 0) + (by.REPORTED ?? 0),
    sign: by.REPORTED ?? 0,
  };
}

/** Free slots in each room of the modality for a day (rooms and slot lengths from settings). */
export async function slots({ modality, date = ymdIST() }) {
  const st = await settingsDoc();
  const rooms = st.rooms.filter((r) => r.modality === modality);
  const start = atIST(date, st.dayStart);
  const end = atIST(date, st.dayEnd);
  const booked = await RadStudy.find({
    room: { $in: rooms.map((r) => r.code) },
    status: { $in: ['SCHEDULED', 'ARRIVED', 'PERFORMED'] },
    scheduledAt: { $gte: start, $lt: end },
  })
    .select('room scheduledAt slotMin')
    .lean();
  const now = Date.now();
  return {
    date,
    rooms: rooms.map((r) => {
      const taken = booked.filter((b) => b.room === r.code);
      const free = [];
      for (
        let t = start.getTime();
        t + r.slotMin * 60_000 <= end.getTime();
        t += r.slotMin * 60_000
      ) {
        if (t < now) continue;
        const clash = taken.some((b) => {
          const bs = b.scheduledAt.getTime();
          const be = bs + (b.slotMin ?? r.slotMin) * 60_000;
          return t < be && t + r.slotMin * 60_000 > bs;
        });
        if (!clash) free.push(new Date(t).toISOString());
      }
      return { code: r.code, name: r.name, slotMin: r.slotMin, free: free.slice(0, 48) };
    }),
  };
}

/** Book a slot; the preparation SMS goes to the patient. */
export async function schedule(id, { room, at }) {
  const s = await findStudy(id);
  if (!['ORDERED', 'SCHEDULED'].includes(s.status))
    throw new AppError(409, 'INVALID_STATE', 'This study is already done or cancelled.');
  const st = await settingsDoc();
  const r = st.rooms.find((x) => x.code === room);
  if (!r || r.modality !== s.modality)
    throw errors.validation([{ path: 'room', message: `Pick a ${s.modality} room` }]);
  const when = new Date(at);
  const len = s.slotMin ?? r.slotMin;
  const clash = await RadStudy.findOne({
    _id: { $ne: s._id },
    room,
    status: { $in: ['SCHEDULED', 'ARRIVED'] },
    scheduledAt: {
      $lt: new Date(when.getTime() + len * 60_000),
      $gt: new Date(when.getTime() - 180 * 60_000),
    },
  }).lean();
  if (clash && clash.scheduledAt.getTime() + (clash.slotMin ?? r.slotMin) * 60_000 > when.getTime())
    throw new AppError(409, 'SLOT_TAKEN', 'That slot was just booked. Pick another.');
  s.room = room;
  s.scheduledAt = when;
  s.slotMin = len;
  s.status = 'SCHEDULED';
  await s.save();
  const def = await RadStudyDef.findById(s.defId).select('prep').lean();
  await publish('rad.study.scheduled', {
    studyId: String(s._id),
    mobile: s.patient.mobile,
    study: s.name,
    at: when.toISOString(),
    prep: def?.prep ?? null,
    room: r.name,
  });
  return out(s);
}

/** Paid, or allowed to pay later: in-patients, credit payers, STAT. */
async function paid(s) {
  if (s.source === 'IPD' || PAY_LATER.includes(s.payerKind) || s.priority === 'STAT') return true;
  if (!s.billId) return false;
  const b = await Bill.findById(s.billId).select('status totals').lean();
  return Boolean(b && b.status !== 'DRAFT' && (b.totals?.balance ?? 1) <= 0);
}

export async function arrive(id) {
  const s = await findStudy(id);
  if (!['ORDERED', 'SCHEDULED'].includes(s.status))
    throw new AppError(409, 'INVALID_STATE', 'This study is already done or cancelled.');
  if (!(await paid(s)))
    throw new AppError(
      402,
      'PAYMENT_PENDING',
      'Payment first: out-patient imaging is paid before the scan.',
      {
        billId: s.billId ? String(s.billId) : null,
      },
    );
  s.status = 'ARRIVED';
  s.arrivedAt = new Date();
  await s.save();
  return out(s);
}

export const contrastInput = z.object({
  consent: z.boolean(),
  creatinine: z.number().min(0.1).max(20),
  overrideReason: z.string().trim().max(300).optional(),
});

/** Contrast studies: consent and a recent creatinine first; a high value needs a reason. */
export async function contrastCheck(id, { consent, creatinine, overrideReason }) {
  const s = await findStudy(id);
  if (!s.contrast) throw new AppError(409, 'NOT_CONTRAST', 'This study has no contrast.');
  if (!consent)
    throw errors.validation([{ path: 'consent', message: 'Take the signed contrast consent' }]);
  const st = await settingsDoc();
  if (creatinine > st.creatinineLimit && !overrideReason?.trim())
    throw errors.validation([
      {
        path: 'overrideReason',
        message: `Creatinine is above ${st.creatinineLimit} mg/dL: the radiologist must give a reason to go ahead`,
      },
    ]);
  s.contrastCheck = { consent, creatinine, overrideReason, by: (await me()).name, at: new Date() };
  await s.save();
  return out(s);
}

export const formFInput = z.object({
  lmp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  indication: z.string().trim().min(3).max(300),
  declaration: z.literal(true),
  patientSigned: z.literal(true),
});

/** PCPNDT Act: Form F for every obstetric ultrasound, before the scan. */
export async function saveFormF(id, { lmp, indication, declaration, patientSigned }) {
  const s = await findStudy(id);
  if (!s.pcpndt) throw new AppError(409, 'NOT_PCPNDT', 'Form F is for obstetric ultrasound.');
  const lmpDate = new Date(`${lmp}T00:00:00+05:30`);
  const weeks = Math.floor((Date.now() - lmpDate.getTime()) / (7 * 86_400_000));
  if (weeks < 0 || weeks > 44)
    throw errors.validation([{ path: 'lmp', message: 'Check the LMP date' }]);
  s.formF = {
    lmp: lmpDate,
    weeks,
    indication,
    declaration,
    patientSigned,
    by: (await me()).name,
    at: new Date(),
  };
  await s.save();
  return out(s);
}

/** The technician performs the study; contrast and Form F must be in place first. */
export async function perform(id, { techNotes }) {
  const s = await findStudy(id);
  if (s.status !== 'ARRIVED')
    throw new AppError(409, 'INVALID_STATE', 'Mark the patient arrived before the scan.');
  if (s.contrast && !s.contrastCheck?.at)
    throw new AppError(
      409,
      'CONTRAST_CHECK_NEEDED',
      'Record the contrast consent and creatinine first.',
    );
  if (s.pcpndt && s.patient.gender === 'F' && !s.formF?.at)
    throw new AppError(
      409,
      'FORM_F_NEEDED',
      'Form F is mandatory before an obstetric ultrasound (PCPNDT Act).',
    );
  s.status = 'PERFORMED';
  s.performedAt = new Date();
  s.performedBy = (await me()).name;
  s.techNotes = techNotes;
  await s.save();
  await publish('rad.study.performed', { studyId: String(s._id), accessionNo: s.accessionNo });
  return out(s);
}

/** Draft report (resident or radiologist), from the study's template. */
export async function saveReport(id, { findings, impression, critical }) {
  const s = await findStudy(id);
  if (!['PERFORMED', 'REPORTED'].includes(s.status))
    throw new AppError(
      409,
      'INVALID_STATE',
      s.status === 'SIGNED'
        ? 'The report is signed; add an addendum.'
        : 'The study is not performed yet.',
    );
  s.report = { findings, impression, draftBy: await me(), draftAt: new Date() };
  s.critical = Boolean(critical);
  s.status = 'REPORTED';
  await s.save();
  return out(s);
}

/** Sign-off by a radiologist other than the one who drafted it (maker-checker). */
export async function sign(id) {
  const s = await findStudy(id);
  if (s.status !== 'REPORTED') throw new AppError(409, 'INVALID_STATE', 'Draft the report first.');
  const by = await me();
  if (by.id && s.report?.draftBy?.id && String(by.id) === String(s.report.draftBy.id))
    throw new AppError(
      403,
      'MAKER_CHECKER',
      'You drafted this report. Another radiologist signs it off.',
    );
  s.status = 'SIGNED';
  s.signedBy = by;
  s.signedAt = new Date();
  await s.save();
  await publish('rad.report.signed', {
    studyId: String(s._id),
    accessionNo: s.accessionNo,
    study: s.name,
    patientName: s.patient.name,
    mobile: s.patient.mobile,
    doctorId: s.doctor?.id ? String(s.doctor.id) : null,
    critical: s.critical,
  });
  return out(s);
}

export async function addAddendum(id, { text }) {
  const s = await findStudy(id);
  if (s.status !== 'SIGNED')
    throw new AppError(409, 'INVALID_STATE', 'Edit the draft; addenda are for signed reports.');
  s.addenda.push({ text, by: (await me()).name, at: new Date() });
  await s.save();
  await publish('rad.report.addendum', { studyId: String(s._id), accessionNo: s.accessionNo });
  return out(s);
}

export async function cancel(id, { reason }) {
  const s = await findStudy(id);
  if (!['ORDERED', 'SCHEDULED'].includes(s.status))
    throw new AppError(409, 'INVALID_STATE', 'Only a study not yet started can be cancelled.');
  s.status = 'CANCELLED';
  s.cancelReason = reason;
  await s.save();
  return out(s);
}

export async function acknowledge(id) {
  const s = await findStudy(id);
  if (s.status !== 'SIGNED')
    throw new AppError(409, 'INVALID_STATE', 'Only a signed report can be acknowledged.');
  if (!s.acknowledgedAt) {
    s.acknowledgedAt = new Date();
    s.acknowledgedBy = (await me()).name;
    await s.save();
  }
  return out(s);
}

/** A patient's imaging for the doctor: report text only once signed. */
export async function patientStudies(patientId) {
  const st = await settingsDoc();
  const rows = await RadStudy.find({ 'patient.id': patientId, status: { $ne: 'CANCELLED' } })
    .sort({ orderedAt: -1 })
    .limit(100)
    .lean();
  return {
    items: rows.map((r) => {
      const o = studyOut(r, st.pacsViewerUrl);
      if (r.status !== 'SIGNED') o.report = null;
      return o;
    }),
    total: rows.length,
    page: 1,
    limit: 100,
  };
}

/** PCPNDT Form F register for a month (kept for the statutory period). */
export async function formFRegister({ month = ymdIST().slice(0, 7) } = {}) {
  const start = new Date(`${month}-01T00:00:00+05:30`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const rows = await RadStudy.find({ pcpndt: true, 'formF.at': { $gte: start, $lt: end } })
    .sort({ 'formF.at': 1 })
    .lean();
  return {
    month,
    items: rows.map((r) => ({
      accessionNo: r.accessionNo,
      at: r.formF.at,
      patient: { name: r.patient.name, uhid: r.patient.uhid, age: r.patient.age },
      lmp: r.formF.lmp,
      weeks: r.formF.weeks,
      indication: r.formF.indication,
      doctor: r.doctor?.name ?? null,
      performedBy: r.performedBy ?? null,
      recordedBy: r.formF.by,
      status: r.status,
    })),
  };
}
