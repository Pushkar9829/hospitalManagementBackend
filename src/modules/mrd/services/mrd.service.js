import { z } from 'zod';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { current } from '../../../core/tenancy/context.js';
import { createBill } from '../../billing/index.js';
import { Admission, IpdNote, MarDose, MedOrder } from '../../ipd/index.js';
import { ICD10 } from '../../opd/index.js';
import { Patient, patientCard } from '../../patients/index.js';
import { Doctor, Service } from '../../setup/index.js';
import {
  BirthRecord,
  DeathRecord,
  MlcCase,
  MrdDestruction,
  MrdRecord,
  MrdSettings,
  ReleaseRequest,
} from '../models/mrd.models.js';

const DAY = 86_400_000;
const ymd = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

export async function settingsDoc() {
  return (await MrdSettings.findOne()) ?? (await MrdSettings.create([{}]))[0];
}

const snap = (p) => ({
  id: p.id ?? p._id,
  uhid: p.uhid,
  name: p.name,
  gender: p.gender,
  age: p.age,
  mobile: p.mobile,
});

// ---------------------------------------------------------------- record completion

/**
 * The mandatory items of a discharged stay, from what IPD holds: the signed discharge summary,
 * the nursing and doctor's initial assessments, progress notes, the MAR when medicines were
 * ordered, and the MCCD for a death or the signed LAMA form.
 */
async function checklistFor(a) {
  const [kinds, orders, doses] = await Promise.all([
    IpdNote.distinct('kind', { admissionId: a._id }),
    MedOrder.countDocuments({ admissionId: a._id }),
    MarDose.countDocuments({ admissionId: a._id, status: { $ne: 'DUE' } }),
  ]);
  const items = [
    ['SUMMARY', 'Discharge summary signed', a.summary?.status === 'SIGNED'],
    ['NURSING_ADMISSION', 'Nursing admission assessment', kinds.includes('NURSING_ADMISSION')],
    ['DOCTOR_INITIAL', 'Doctor’s initial assessment', kinds.includes('DOCTOR_INITIAL')],
    ['PROGRESS', 'Progress notes', kinds.includes('PROGRESS')],
  ];
  if (orders) items.push(['MAR', 'Medication administration record', doses > 0]);
  if (a.outcome === 'DEATH')
    items.push(['MCCD', 'Cause of death certificate (MCCD)', Boolean(a.summary?.death?.mccdNo)]);
  if (a.outcome === 'LAMA')
    items.push(['LAMA', 'LAMA form signed', Boolean(a.summary?.lama?.signedBy)]);
  return items.map(([code, label, ok]) => ({ code, label, ok }));
}

const statusOf = (r) =>
  r.status === 'CLOSED' ? 'CLOSED' : r.checklist.every((c) => c.ok) ? 'CODING' : 'DEFICIENT';

/** ipd.discharged: the stay's record arrives in MRD with its deficiencies. */
export async function openRecord({ admissionId }) {
  if (await MrdRecord.exists({ admissionId })) return null;
  const a = await Admission.findById(admissionId).lean();
  if (!a) return null;
  const s = await settingsDoc();
  const doctor = a.consultant?.id
    ? await Doctor.findById(a.consultant.id).select('userId').lean()
    : null;
  const discharged = a.leftAt ?? new Date();
  const years = a.mlc?.flag ? s.mlcRetentionYears : s.retentionYears;
  const r = new MrdRecord({
    admissionId: a._id,
    ipNo: a.ipNo,
    patient: snap(a.patient),
    consultant: { id: a.consultant?.id, name: a.consultant?.name, userId: doctor?.userId },
    ward: a.bed?.ward,
    admittedAt: a.admittedAt,
    dischargedAt: discharged,
    outcome: a.outcome,
    mlc: Boolean(a.mlc?.flag),
    checklist: await checklistFor(a),
    diagnoses: (a.summary?.diagnoses ?? []).map((d, i) => ({ ...d, primary: i === 0 })),
    retainUntil: years
      ? ymd(new Date(discharged).setFullYear(new Date(discharged).getFullYear() + years))
      : null,
  });
  r.status = statusOf(r);
  await r.save();
  if (r.status === 'DEFICIENT')
    await publish('mrd.deficiency.raised', {
      recordId: String(r._id),
      ipNo: r.ipNo,
      doctorUserId: r.consultant.userId ? String(r.consultant.userId) : null,
      items: r.checklist.filter((c) => !c.ok).map((c) => c.label),
    });
  return r;
}

export const recordOut = (r) => ({
  id: String(r._id),
  admissionId: String(r.admissionId),
  ipNo: r.ipNo,
  patient: { ...r.patient, id: String(r.patient.id) },
  consultant: r.consultant?.name ?? null,
  ward: r.ward ?? null,
  admittedAt: r.admittedAt,
  dischargedAt: r.dischargedAt,
  outcome: r.outcome,
  mlc: r.mlc,
  status: r.status,
  legalHold: r.legalHold?.on
    ? { reason: r.legalHold.reason, by: r.legalHold.by, at: r.legalHold.at }
    : null,
  destroyed: r.destroyed?.at ? r.destroyed : null,
  checklist: r.checklist,
  pending: r.checklist.filter((c) => !c.ok).length,
  diagnoses: r.diagnoses ?? [],
  procedures: r.procedures ?? [],
  codedBy: r.codedBy ?? null,
  codedAt: r.codedAt ?? null,
  file: r.file?.fileNo
    ? {
        fileNo: r.file.fileNo,
        rack: r.file.rack ?? null,
        status: r.file.status,
        issuedTo: r.file.issuedTo ?? null,
        issuedAt: r.file.issuedAt ?? null,
        dueOn: r.file.dueOn ?? null,
        overdue: r.file.status === 'OUT' && r.file.dueOn < ymd(new Date()),
        history: r.file.history ?? [],
      }
    : null,
  retainUntil: r.retainUntil ?? null,
  version: r.version,
});

export async function listRecords({ status, q, mine, page = 1, limit = 50 } = {}) {
  const filter = {};
  if (status) filter.status = { $in: status.split(',') };
  if (mine) filter['consultant.userId'] = current().userId;
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ ipNo: rx }, { 'patient.name': rx }, { 'patient.uhid': rx }];
  }
  const [rows, total] = await Promise.all([
    MrdRecord.find(filter)
      .sort({ dischargedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    MrdRecord.countDocuments(filter),
  ]);
  return { items: rows.map(recordOut), total, page, limit };
}

async function findRecord(id) {
  const r = await MrdRecord.findById(id);
  if (!r) throw errors.notFound('Medical record');
  return r;
}

export async function getRecord(id) {
  return recordOut((await findRecord(id)).toObject());
}

/** Re-reads IPD after the doctor completes notes; items resolved by hand stay resolved. */
export async function recheck(id) {
  const r = await findRecord(id);
  if (r.status === 'CLOSED') throw new AppError(409, 'INVALID_STATE', 'The record is closed.');
  const a = await Admission.findById(r.admissionId).lean();
  const fresh = await checklistFor(a);
  const by = await userName();
  r.checklist = fresh.map((f) => {
    const old = r.checklist.find((c) => c.code === f.code);
    if (old?.ok) return old;
    return f.ok ? { ...f, resolvedAt: new Date(), resolvedBy: by } : f;
  });
  r.status = statusOf(r);
  await r.save();
  return recordOut(r.toObject());
}

/** The MRD officer marks a paper item as filed (e.g. a signed consent scanned in). */
export async function resolveItem(id, { code, note }) {
  const r = await findRecord(id);
  if (r.status === 'CLOSED') throw new AppError(409, 'INVALID_STATE', 'The record is closed.');
  const item = r.checklist.find((c) => c.code === code);
  if (!item) throw errors.notFound('Checklist item');
  item.ok = true;
  item.note = note;
  item.resolvedAt = new Date();
  item.resolvedBy = await userName();
  r.markModified('checklist');
  r.status = statusOf(r);
  await r.save();
  return recordOut(r.toObject());
}

export const codingInput = z.object({
  diagnoses: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, 'ICD-10 code'),
        name: z.string().trim().min(2).max(200),
        primary: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(20),
  procedures: z
    .array(z.object({ code: z.string().trim().max(20), name: z.string().trim().min(2).max(200) }))
    .max(20)
    .default([]),
});

/** The coder assigns the final ICD-10 codes and closes the record (all items must be present). */
export async function code(id, input) {
  const r = await findRecord(id);
  if (r.status === 'DEFICIENT')
    throw new AppError(
      409,
      'RECORD_INCOMPLETE',
      `Deficiencies are open: ${r.checklist
        .filter((c) => !c.ok)
        .map((c) => c.label)
        .join(', ')}.`,
    );
  const primaries = input.diagnoses.filter((d) => d.primary).length;
  if (primaries !== 1)
    throw errors.validation([{ path: 'diagnoses', message: 'Mark exactly one primary diagnosis' }]);
  r.diagnoses = input.diagnoses;
  r.procedures = input.procedures;
  r.codedBy = await userName();
  r.codedAt = new Date();
  r.status = 'CLOSED';
  await r.save();
  await publish('mrd.record.closed', {
    recordId: String(r._id),
    admissionId: String(r.admissionId),
    primary: input.diagnoses.find((d) => d.primary).code,
  });
  return recordOut(r.toObject());
}

/** Deficiencies by doctor: what each consultant still has to complete. */
export async function deficiencies({ mine } = {}) {
  const filter = { status: 'DEFICIENT' };
  if (mine) filter['consultant.userId'] = current().userId;
  const rows = await MrdRecord.find(filter).sort({ dischargedAt: 1 }).lean();
  const now = Date.now();
  const byDoctor = new Map();
  for (const r of rows) {
    const k = r.consultant?.name ?? 'Unassigned';
    const d = byDoctor.get(k) ?? { doctor: k, records: 0, items: 0, oldestDays: 0, list: [] };
    const open = r.checklist.filter((c) => !c.ok);
    d.records += 1;
    d.items += open.length;
    d.oldestDays = Math.max(d.oldestDays, Math.floor((now - new Date(r.dischargedAt)) / DAY));
    d.list.push({
      id: String(r._id),
      ipNo: r.ipNo,
      patient: r.patient.name,
      dischargedAt: r.dischargedAt,
      items: open.map((c) => c.label),
    });
    byDoctor.set(k, d);
  }
  return { items: [...byDoctor.values()].sort((a, b) => b.oldestDays - a.oldestDays) };
}

export function icd10({ q } = {}) {
  const t = (q ?? '').trim().toLowerCase();
  const rows = ICD10.filter(
    ([c, n]) => !t || c.toLowerCase().startsWith(t) || n.toLowerCase().includes(t),
  ).slice(0, 25);
  return { items: rows.map(([c, n]) => ({ code: c, name: n })) };
}

// ---------------------------------------------------------------- physical file tracking

export const fileInput = z.object({
  action: z.enum(['REGISTER', 'ISSUE', 'RETURN']),
  fileNo: z.string().trim().max(30).optional(),
  rack: z.string().trim().max(30).optional(),
  to: z.string().trim().max(80).optional(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function fileMove(id, input) {
  const r = await findRecord(id);
  const by = await userName();
  const s = await settingsDoc();
  if (input.action === 'REGISTER') {
    if (!input.fileNo)
      throw errors.validation([{ path: 'fileNo', message: 'Enter the file number' }]);
    r.file = { fileNo: input.fileNo, rack: input.rack, status: 'IN', history: [] };
  } else {
    if (!r.file?.fileNo)
      throw new AppError(409, 'INVALID_STATE', 'Register the physical file first.');
    if (input.action === 'ISSUE') {
      if (r.file.status === 'OUT')
        throw new AppError(409, 'FILE_OUT', `The file is with ${r.file.issuedTo}.`);
      if (!input.to) throw errors.validation([{ path: 'to', message: 'Issued to whom?' }]);
      r.file.status = 'OUT';
      r.file.issuedTo = input.to;
      r.file.issuedAt = new Date();
      r.file.dueOn = input.dueOn ?? ymd(Date.now() + s.fileDueDays * DAY);
    } else {
      if (r.file.status === 'IN') throw new AppError(409, 'INVALID_STATE', 'The file is in.');
      r.file.status = 'IN';
      r.file.issuedTo = undefined;
      r.file.dueOn = undefined;
      if (input.rack) r.file.rack = input.rack;
    }
  }
  r.file.history = [
    ...(r.file.history ?? []),
    {
      action: input.action,
      to: input.to ?? input.rack,
      at: new Date(),
      by,
      dueOn: r.file.dueOn,
    },
  ];
  r.markModified('file');
  await r.save();
  return recordOut(r.toObject());
}

export async function overdueFiles() {
  const today = ymd(new Date());
  const rows = await MrdRecord.find({ 'file.status': 'OUT', 'file.dueOn': { $lt: today } })
    .sort({ 'file.dueOn': 1 })
    .lean();
  return { items: rows.map(recordOut) };
}

// ---------------------------------------------------------------- release of information

export const releaseInput = z.object({
  recordId: z.string(),
  requester: z.object({
    kind: z.enum(['PATIENT', 'FAMILY', 'INSURER', 'COURT', 'POLICE', 'OTHER']),
    name: z.string().trim().min(2).max(80),
    relation: z.string().trim().max(40).optional(),
    idProof: z.string().trim().min(4).max(60),
    authorisation: z.string().trim().max(120).optional(),
  }),
  purpose: z.string().trim().min(3).max(200),
  pages: z.number().int().min(1).max(2000),
});

const releaseOut = (q) => ({
  id: String(q._id),
  requestNo: q.requestNo,
  recordId: String(q.recordId),
  ipNo: q.ipNo,
  patient: q.patient?.name,
  uhid: q.patient?.uhid,
  requester: q.requester,
  purpose: q.purpose,
  pages: q.pages,
  fee: q.fee,
  status: q.status,
  approvalId: q.approvalId ? String(q.approvalId) : null,
  billId: q.billId ? String(q.billId) : null,
  copyNo: q.copyNo ?? null,
  releasedAt: q.releasedAt ?? null,
  releasedBy: q.releasedBy ?? null,
  createdAt: q.createdAt,
});

/**
 * A copy request. Anyone but the patient needs an authorisation (consent letter, court order or
 * police requisition). The Medical Superintendent approves (maker-checker).
 */
export async function requestRelease(input, res) {
  const r = await findRecord(input.recordId);
  if (input.requester.kind !== 'PATIENT' && !input.requester.authorisation)
    throw errors.validation([
      { path: 'requester.authorisation', message: 'Record the consent letter or order' },
    ]);
  const s = await settingsDoc();
  const svc = await Service.findOne({ code: s.copyServiceCode, isActive: true }).lean();
  const rate = svc?.rates?.[0]?.amount ?? 0;
  return withTransaction(async () => {
    const [q] = await ReleaseRequest.create([
      {
        requestNo: await documentNumber('ROI'),
        recordId: r._id,
        patient: r.patient,
        ipNo: r.ipNo,
        requester: input.requester,
        purpose: input.purpose,
        pages: input.pages,
        fee: rate * input.pages,
        requestedBy: await userName(),
      },
    ]);
    const approval = await requestApproval({
      action: 'mrd.recordRelease',
      module: 'MRD',
      entity: 'ReleaseRequest',
      entityId: q._id,
      title: `Release ${r.ipNo} to ${input.requester.name} (${input.requester.kind.toLowerCase()})`,
      before: {},
      after: { pages: input.pages, requester: input.requester.name },
      payload: { requestId: String(q._id) },
      metrics: {},
      reason: input.purpose,
    });
    if (approval) {
      q.approvalId = approval._id;
      if (res) res.locals.status = 202;
    } else q.status = 'APPROVED';
    await q.save();
    return releaseOut(q.toObject());
  });
}

onApprovalDecided('mrd.recordRelease', async (req, outcome) => {
  const q = await ReleaseRequest.findById(req.payload.requestId);
  if (!q || q.status !== 'PENDING_APPROVAL') return;
  q.status = outcome === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  await q.save();
});

/** Hands over the certified copy: the copy fee goes on a draft bill for the cashier. */
export async function release(id) {
  const q = await ReleaseRequest.findById(id);
  if (!q) throw errors.notFound('Release request');
  if (q.status !== 'APPROVED')
    throw new AppError(409, 'INVALID_STATE', 'The request is not approved.');
  const s = await settingsDoc();
  const svc = await Service.findOne({ code: s.copyServiceCode, isActive: true }).lean();
  return withTransaction(async () => {
    if (svc && q.fee > 0) {
      const bill = await createBill({
        patientId: String(q.patient.id),
        type: 'OP',
        lines: [{ serviceId: String(svc._id), qty: q.pages }],
        notes: `Medical record copy ${q.requestNo}`,
      });
      q.billId = bill.id;
    }
    q.status = 'RELEASED';
    q.copyNo = `CERTIFIED COPY ${q.requestNo}`;
    q.releasedAt = new Date();
    q.releasedBy = await userName();
    await q.save();
    return releaseOut(q.toObject());
  });
}

export async function listReleases({ status } = {}) {
  const filter = status ? { status: { $in: status.split(',') } } : {};
  const rows = await ReleaseRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  return { items: rows.map(releaseOut) };
}

// ---------------------------------------------------------------- registers

const CRS_DAYS = 21;
const patientById = async (pid) => {
  const p = await Patient.findById(pid).lean();
  if (!p) throw errors.notFound('Patient');
  return snap(patientCard(p));
};

export const birthInput = z.object({
  motherId: z.string(),
  admissionId: z.string().optional(),
  fatherName: z.string().trim().max(80).optional(),
  bornAt: z.iso.datetime({ offset: true }),
  sex: z.enum(['M', 'F', 'O']),
  weightGrams: z.number().int().min(200).max(7000),
  deliveryType: z.enum(['NORMAL', 'ASSISTED', 'CAESAREAN']),
  liveBirth: z.boolean().default(true),
  place: z.string().trim().max(60).optional(),
  attendedBy: z.string().trim().max(80).optional(),
});

const birthOut = (b) => ({
  id: String(b._id),
  regNo: b.regNo,
  mother: b.mother?.name,
  motherUhid: b.mother?.uhid,
  fatherName: b.fatherName ?? null,
  bornAt: b.bornAt,
  sex: b.sex,
  weightGrams: b.weightGrams,
  deliveryType: b.deliveryType,
  liveBirth: b.liveBirth,
  place: b.place ?? null,
  attendedBy: b.attendedBy ?? null,
  crsDueBy: b.crsDueBy,
  reportedAt: b.reportedAt ?? null,
  crsRefNo: b.crsRefNo ?? null,
  overdue: !b.reportedAt && new Date(b.crsDueBy) < new Date(),
});

export async function recordBirth(input) {
  const mother = await patientById(input.motherId);
  const born = new Date(input.bornAt);
  if (born > new Date())
    throw errors.validation([{ path: 'bornAt', message: 'Time of birth is in the future' }]);
  const [b] = await BirthRecord.create([
    {
      ...input,
      regNo: await documentNumber('BR'),
      mother,
      bornAt: born,
      crsDueBy: new Date(born.getTime() + CRS_DAYS * DAY),
      recordedBy: await userName(),
    },
  ]);
  await publish('mrd.birth.recorded', { birthId: String(b._id), motherId: input.motherId });
  return birthOut(b.toObject());
}

export const deathInput = z.object({
  patientId: z.string(),
  admissionId: z.string().optional(),
  diedAt: z.iso.datetime({ offset: true }),
  cause: z.object({
    immediate: z.string().trim().min(3).max(200),
    antecedent: z.string().trim().max(200).optional(),
    underlying: z.string().trim().max(200).optional(),
    icd: z.string().trim().max(10).optional(),
  }),
  mccdNo: z.string().trim().min(2).max(40),
  certifiedBy: z.string().trim().min(3).max(80),
  mlc: z.boolean().default(false),
  mortuarySlot: z.string().trim().max(20).optional(),
});

const deathOut = (d) => ({
  id: String(d._id),
  regNo: d.regNo,
  patient: d.patient?.name,
  uhid: d.patient?.uhid,
  diedAt: d.diedAt,
  admittedAt: d.admittedAt ?? null,
  cause: d.cause,
  mccdNo: d.mccdNo,
  certifiedBy: d.certifiedBy,
  mlc: d.mlc,
  crsDueBy: d.crsDueBy,
  reportedAt: d.reportedAt ?? null,
  crsRefNo: d.crsRefNo ?? null,
  overdue: !d.reportedAt && new Date(d.crsDueBy) < new Date(),
  mortuary: d.mortuary ?? null,
});

export async function recordDeath(input) {
  const patient = await patientById(input.patientId);
  if (await DeathRecord.exists({ 'patient.id': input.patientId }))
    throw new AppError(409, 'DUPLICATE', 'A death is already registered for this patient.');
  const died = new Date(input.diedAt);
  const a = input.admissionId ? await Admission.findById(input.admissionId).lean() : null;
  const [d] = await DeathRecord.create([
    {
      regNo: await documentNumber('DR'),
      patient,
      admissionId: input.admissionId,
      admittedAt: a?.admittedAt,
      diedAt: died,
      cause: input.cause,
      mccdNo: input.mccdNo,
      certifiedBy: input.certifiedBy,
      mlc: input.mlc || Boolean(a?.mlc?.flag),
      crsDueBy: new Date(died.getTime() + CRS_DAYS * DAY),
      mortuary: input.mortuarySlot
        ? { slot: input.mortuarySlot, receivedAt: new Date() }
        : undefined,
      recordedBy: await userName(),
    },
  ]);
  return deathOut(d.toObject());
}

export const handoverInput = z.object({
  handedTo: z.string().trim().min(3).max(80),
  relation: z.string().trim().max(40).optional(),
  idProof: z.string().trim().min(4).max(60),
  toPolice: z.boolean().default(false),
});

/** Body handed to relatives with ID proof, or to the police in a medico-legal case. */
export async function handover(id, input) {
  const d = await DeathRecord.findById(id);
  if (!d) throw errors.notFound('Death record');
  if (d.mortuary?.handedOverAt) throw new AppError(409, 'INVALID_STATE', 'Already handed over.');
  if (d.mlc && !input.toPolice)
    throw new AppError(
      409,
      'MLC_POLICE_ONLY',
      'In a medico-legal case the body is handed over to the police.',
    );
  d.mortuary = { ...(d.mortuary ?? {}), ...input, handedOverAt: new Date() };
  d.markModified('mortuary');
  await d.save();
  return deathOut(d.toObject());
}

/** Marks a birth or death reported to the Civil Registration System. */
export async function markReported(kind, id, { crsRefNo }) {
  const M = kind === 'birth' ? BirthRecord : DeathRecord;
  const doc = await M.findById(id);
  if (!doc) throw errors.notFound('Register entry');
  doc.reportedAt = new Date();
  doc.crsRefNo = crsRefNo;
  await doc.save();
  return kind === 'birth' ? birthOut(doc.toObject()) : deathOut(doc.toObject());
}

export async function listBirths() {
  const rows = await BirthRecord.find({}).sort({ bornAt: -1 }).limit(300).lean();
  return { items: rows.map(birthOut) };
}
export async function listDeaths() {
  const rows = await DeathRecord.find({}).sort({ diedAt: -1 }).limit(300).lean();
  return { items: rows.map(deathOut) };
}

export const mlcInput = z.object({
  patientId: z.string(),
  admissionId: z.string().optional(),
  nature: z.enum([
    'ROAD_ACCIDENT',
    'ASSAULT',
    'POISONING',
    'BURNS',
    'FALL',
    'SEXUAL_OFFENCE',
    'OTHER',
  ]),
  broughtBy: z.string().trim().max(80).optional(),
  policeStation: z.string().trim().min(2).max(80),
  intimatedAt: z.iso.datetime({ offset: true }),
  officer: z
    .object({
      name: z.string().trim().max(80),
      rank: z.string().trim().max(40).optional(),
      badgeNo: z.string().trim().max(20).optional(),
    })
    .optional(),
  injuries: z.string().trim().max(1000).optional(),
});

const mlcOut = (m) => ({
  id: String(m._id),
  mlcNo: m.mlcNo,
  patient: m.patient?.name,
  uhid: m.patient?.uhid,
  at: m.at,
  nature: m.nature,
  broughtBy: m.broughtBy ?? null,
  policeStation: m.policeStation,
  intimatedAt: m.intimatedAt,
  officer: m.officer ?? null,
  injuries: m.injuries ?? null,
  certificateIssuedAt: m.certificateIssuedAt ?? null,
  status: m.status,
});

export async function recordMlc(input) {
  const patient = await patientById(input.patientId);
  const [m] = await MlcCase.create([
    {
      ...input,
      mlcNo: await documentNumber('MLC'),
      patient,
      at: new Date(),
      intimatedAt: new Date(input.intimatedAt),
      recordedBy: await userName(),
    },
  ]);
  if (input.admissionId)
    await Admission.updateOne(
      { _id: input.admissionId },
      {
        $set: {
          'mlc.flag': true,
          'mlc.policeIntimation': input.policeStation,
          'mlc.at': new Date(),
        },
      },
    );
  return mlcOut(m.toObject());
}

export async function issueInjuryCertificate(id) {
  const m = await MlcCase.findById(id);
  if (!m) throw errors.notFound('MLC');
  m.certificateIssuedAt = new Date();
  await m.save();
  return mlcOut(m.toObject());
}

export async function listMlc() {
  const rows = await MlcCase.find({}).sort({ at: -1 }).limit(300).lean();
  return { items: rows.map(mlcOut) };
}

// ---------------------------------------------------------------- statistics

/**
 * Monthly hospital statistics (spec "Statistics"): admissions, discharges, deaths, births,
 * average length of stay, gross death rate (deaths per 100 discharges including deaths) and net
 * death rate (excluding deaths within 48 hours of admission).
 */
export async function statistics({ month }) {
  const from = new Date(`${month}-01T00:00:00+05:30`);
  const to = new Date(from);
  to.setMonth(to.getMonth() + 1);
  const [admissions, discharged, births, deaths] = await Promise.all([
    Admission.countDocuments({ admittedAt: { $gte: from, $lt: to } }),
    Admission.find({ status: 'DISCHARGED', leftAt: { $gte: from, $lt: to } })
      .select('admittedAt leftAt outcome')
      .lean(),
    BirthRecord.countDocuments({ bornAt: { $gte: from, $lt: to } }),
    DeathRecord.find({ diedAt: { $gte: from, $lt: to } })
      .select('diedAt admittedAt')
      .lean(),
  ]);
  const los = discharged.map((a) => (new Date(a.leftAt) - new Date(a.admittedAt)) / DAY);
  const inpatientDeaths = deaths.filter((d) => d.admittedAt);
  const early = inpatientDeaths.filter(
    (d) => new Date(d.diedAt) - new Date(d.admittedAt) < 2 * DAY,
  ).length;
  const n = discharged.length;
  const pct = (x, y) => (y > 0 ? Math.round((x * 10000) / y) / 100 : 0);
  return {
    month,
    admissions,
    discharges: n,
    deaths: deaths.length,
    inpatientDeaths: inpatientDeaths.length,
    births,
    averageLos: n ? Math.round((los.reduce((t, x) => t + x, 0) / n) * 10) / 10 : 0,
    grossDeathRate: pct(inpatientDeaths.length, n),
    netDeathRate: pct(inpatientDeaths.length - early, n - early),
    outcomes: Object.fromEntries(
      ['NORMAL', 'LAMA', 'DEATH', 'ABSCONDED', 'REFERRED'].map((o) => [
        o,
        discharged.filter((a) => a.outcome === o).length,
      ]),
    ),
  };
}

/**
 * Records past their retention date that may go on a destruction list: closed, not MLC, not
 * under legal hold, file not issued out, not destroyed and not on an open batch.
 */
export async function retentionDue() {
  const open = await MrdDestruction.find({ status: { $in: ['PENDING_APPROVAL', 'APPROVED'] } })
    .select('items.recordId')
    .lean();
  const queued = new Set(open.flatMap((b) => b.items.map((i) => String(i.recordId))));
  const rows = await MrdRecord.find({
    retainUntil: { $ne: null, $lte: ymd(new Date()) },
    'destroyed.at': { $exists: false },
  })
    .sort({ retainUntil: 1 })
    .limit(500)
    .lean();
  return {
    items: rows.map((r) => ({
      ...recordOut(r),
      blockedBy: r.mlc
        ? 'MLC'
        : r.legalHold?.on
          ? 'LEGAL_HOLD'
          : r.status !== 'CLOSED'
            ? 'NOT_CLOSED'
            : r.file?.status === 'OUT'
              ? 'FILE_OUT'
              : queued.has(String(r._id))
                ? 'IN_BATCH'
                : null,
    })),
  };
}

export const legalHoldInput = z.object({
  on: z.boolean(),
  reason: z.string().trim().min(5).max(300),
});

/** Puts a record on legal hold (or lifts it): a held record is never destroyed. */
export async function setLegalHold(id, { on, reason }) {
  const r = await findRecord(id);
  r.legalHold = { on, reason, by: await userName(), at: new Date() };
  await r.save();
  return recordOut(r.toObject());
}

const destructionOut = (b) => ({
  id: String(b._id),
  batchNo: b.batchNo,
  items: (b.items ?? []).map((i) => ({ ...i, recordId: String(i.recordId) })),
  method: b.method,
  reason: b.reason ?? null,
  status: b.status,
  approvalId: b.approvalId ? String(b.approvalId) : null,
  requestedBy: b.requestedBy ?? null,
  destroyedAt: b.destroyedAt ?? null,
  witness: b.witness ?? null,
  vendor: b.vendor ?? null,
  certificateNo: b.certificateNo ?? null,
  createdAt: b.createdAt,
  version: b.version,
});

export async function listDestructions() {
  const rows = await MrdDestruction.find({}).sort({ createdAt: -1 }).limit(100).lean();
  return { items: rows.map(destructionOut) };
}

export const destructionInput = z.object({
  recordIds: z.array(z.string()).min(1).max(500),
  method: z.enum(['SHREDDING', 'INCINERATION', 'PULPING']),
  reason: z.string().trim().min(5).max(300),
});

/** Proposes a destruction batch; it waits for the Medical Superintendent, then the Super Admin. */
export async function proposeDestruction(input, res) {
  const due = await retentionDue();
  const byId = new Map(due.items.map((r) => [r.id, r]));
  const problems = [];
  for (const rid of input.recordIds) {
    const r = byId.get(String(rid));
    if (!r) problems.push(`${rid}: not past its retention date`);
    else if (r.blockedBy) problems.push(`${r.ipNo}: ${r.blockedBy}`);
  }
  if (problems.length)
    throw new AppError(
      422,
      'NOT_DESTROYABLE',
      `These records cannot be destroyed: ${problems.join('; ')}`,
    );
  return withTransaction(async () => {
    const [b] = await MrdDestruction.create([
      {
        batchNo: await documentNumber('MDB'),
        items: input.recordIds.map((rid) => {
          const r = byId.get(String(rid));
          return {
            recordId: r.id,
            ipNo: r.ipNo,
            uhid: r.patient.uhid,
            patient: r.patient.name,
            fileNo: r.file?.fileNo,
            retainUntil: r.retainUntil,
          };
        }),
        method: input.method,
        reason: input.reason,
        requestedBy: await userName(),
      },
    ]);
    const approval = await requestApproval({
      action: 'mrd.recordDestruction',
      module: 'MRD',
      entity: 'MrdDestruction',
      entityId: b._id,
      title: `Destroy ${b.items.length} records past retention (${b.batchNo})`,
      before: {},
      after: { records: b.items.length, method: b.method },
      payload: { batchId: String(b._id) },
      metrics: {},
      reason: input.reason,
    });
    if (approval) {
      b.approvalId = approval._id;
      if (res) res.locals.status = 202;
    } else b.status = 'APPROVED';
    await b.save();
    return destructionOut(b.toObject());
  });
}

onApprovalDecided('mrd.recordDestruction', async (req, outcome) => {
  const b = await MrdDestruction.findById(req.payload.batchId);
  if (!b || b.status !== 'PENDING_APPROVAL') return;
  b.status = outcome === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  await b.save();
});

export const destroyedInput = z.object({
  version: z.number().int().min(0),
  destroyedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  witness: z.string().trim().min(3).max(120),
  vendor: z.string().trim().max(120).optional(),
  certificateNo: z.string().trim().max(60).optional(),
});

/**
 * Records that an approved batch was destroyed: each file is marked destroyed. A record put on
 * legal hold after approval stays out (it is skipped and named).
 */
export async function recordDestroyed(id, input) {
  const b = await MrdDestruction.findById(id);
  if (!b) throw errors.notFound('Destruction batch');
  if (b.version !== input.version) throw errors.versionConflict();
  if (b.status !== 'APPROVED')
    throw new AppError(
      409,
      'INVALID_STATE',
      'Only an approved batch can be recorded as destroyed.',
    );
  return withTransaction(async () => {
    const at = new Date(`${input.destroyedOn}T12:00:00+05:30`);
    const skipped = [];
    for (const item of b.items) {
      const r = await MrdRecord.findById(item.recordId);
      if (!r || r.legalHold?.on || r.mlc) {
        skipped.push(item.ipNo);
        continue;
      }
      r.destroyed = { at, batchNo: b.batchNo };
      await r.save();
    }
    Object.assign(b, {
      status: 'DESTROYED',
      destroyedAt: at,
      witness: input.witness,
      vendor: input.vendor,
      certificateNo: input.certificateNo,
      recordedBy: await userName(),
    });
    await b.save();
    return { ...destructionOut(b.toObject()), skipped };
  });
}
