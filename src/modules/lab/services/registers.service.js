import { z } from 'zod';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { LabSample } from '../models/lab.models.js';
import { Culture, HistoCase } from '../models/micro.models.js';
import {
  EqasCycle,
  LabMaintenance,
  MediaLot,
  PartnerLab,
  QcLot,
  SendOut,
} from '../models/registers.models.js';
import { me } from './common.js';

/** Laboratory registers and the work around them (QC, settings, receipt, micro, histopathology). */
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (n) => z.string().trim().max(n);
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plain = ({ _id, tenantId: _t, __v, isDeleted: _d, createdBy: _c, updatedBy: _u, ...r }) => ({
  id: String(_id),
  ...r,
});

/** A simple register: list newest first, add, update by id with the version. */
function register(Model, input, sort = { createdAt: -1 }) {
  return {
    input,
    list: async (filter = {}) => ({
      items: (await Model.find(filter).sort(sort).limit(500).lean()).map(plain),
    }),
    create: async (body) => plain((await Model.create([body]))[0].toObject()),
    update: async (id, { version, ...body }) => {
      const doc = await Model.findById(id);
      if (!doc) throw errors.notFound('Record');
      if (doc.version !== version) throw errors.versionConflict();
      doc.set(body);
      await doc.save();
      return plain(doc.toObject());
    },
  };
}

export const lots = register(
  QcLot,
  z.object({
    lotNo: text(40).min(2),
    material: text(80).min(2),
    level: text(20).optional(),
    analyser: text(60).optional(),
    openedOn: ymd.optional(),
    expiresOn: ymd,
    active: z.boolean().default(true),
  }),
  { expiresOn: 1 },
);

export const eqas = register(
  EqasCycle,
  z.object({
    scheme: text(120).min(3),
    cycle: text(40).min(2),
    department: text(40).optional(),
    dueOn: ymd.optional(),
    analytes: z.number().int().min(0).max(500).optional(),
    acceptable: z.number().int().min(0).max(500).optional(),
    status: z.enum(['DUE', 'SUBMITTED', 'REVIEWED']).default('DUE'),
    note: text(200).optional(),
  }),
);

export const maintenance = register(
  LabMaintenance,
  z.object({
    equipment: text(80).min(2),
    activity: text(160).min(3),
    kind: z.enum(['CALIBRATION', 'MAINTENANCE']).default('MAINTENANCE'),
    doneOn: ymd,
    doneBy: text(80).optional(),
    nextDue: ymd.optional(),
    note: text(200).optional(),
  }),
  { doneOn: -1 },
);

export const partners = register(
  PartnerLab,
  z.object({
    code: z.string().trim().toUpperCase().min(2).max(12),
    name: text(120).min(2),
    nabl: z.boolean().default(false),
    contact: text(80).optional(),
    phone: text(15).optional(),
    tatHours: z.number().int().min(1).max(720).optional(),
    tests: z.array(z.string().trim().toUpperCase().max(20)).max(200).default([]),
    active: z.boolean().default(true),
  }),
  { name: 1 },
);

export const media = register(
  MediaLot,
  z.object({
    medium: text(80).min(2),
    lotNo: text(40).min(2),
    qcStrain: text(120).optional(),
    result: z.enum(['PASS', 'FAIL', 'PENDING']).default('PENDING'),
    testedOn: ymd.optional(),
    expiresOn: ymd,
    note: text(200).optional(),
  }),
  { expiresOn: 1 },
);

// ---------------------------------------------------------------- send-outs

export const sendOutInput = z.object({
  partnerId: z.string(),
  sampleNos: z.array(z.string().trim().toUpperCase()).min(1).max(100),
  courier: text(80).optional(),
});

/** A manifest of received samples going to a partner lab. */
export async function createSendOut({ partnerId, sampleNos, courier }) {
  const partner = await PartnerLab.findById(partnerId).lean();
  if (!partner || !partner.active)
    throw errors.validation([{ path: 'partnerId', message: 'Pick a partner lab' }]);
  const samples = await LabSample.find({ sampleNo: { $in: sampleNos } }).lean();
  const missing = sampleNos.filter((n) => !samples.some((s) => s.sampleNo === n));
  if (missing.length)
    throw errors.validation([
      { path: 'sampleNos', message: `Unknown samples: ${missing.join(', ')}` },
    ]);
  if (samples.some((s) => s.status !== 'RECEIVED'))
    throw new AppError(409, 'INVALID_STATE', 'Only samples received at the lab can be sent out');
  const [m] = await SendOut.create([
    {
      manifestNo: await documentNumber('SO'),
      partnerId: partner._id,
      partnerName: partner.name,
      samples: samples.map((s) => ({
        sampleNo: s.sampleNo,
        patient: s.patient?.name,
        uhid: s.patient?.uhid,
        tests: s.tests,
      })),
      sentBy: (await me()).name,
      courier,
    },
  ]);
  return plain(m.toObject());
}

export async function listSendOuts() {
  return { items: (await SendOut.find().sort({ sentAt: -1 }).limit(200).lean()).map(plain) };
}

export async function sendOutResults(id, { version }) {
  const m = await SendOut.findById(id);
  if (!m) throw errors.notFound('Manifest');
  if (m.version !== version) throw errors.versionConflict();
  m.set({ status: 'RESULTS_RECEIVED', receivedAt: new Date() });
  await m.save();
  return plain(m.toObject());
}

// ---------------------------------------------------------------- rejections and storage

/** Samples rejected on a day, with the reason (each one asks for a recollection). */
export async function rejections({ date = istToday() } = {}) {
  const rows = await LabSample.find({
    status: 'REJECTED',
    rejectedAt: {
      $gte: new Date(`${date}T00:00:00+05:30`),
      $lte: new Date(`${date}T23:59:59.999+05:30`),
    },
  })
    .sort({ rejectedAt: -1 })
    .lean();
  return {
    date,
    items: rows.map((s) => ({
      sampleNo: s.sampleNo,
      patient: s.patient?.name,
      location: s.location,
      tests: s.tests,
      reason: s.rejectReason,
      note: s.rejectNote,
      at: s.rejectedAt,
      by: s.rejectedBy,
    })),
  };
}

/** Stored samples, with those past their keep-until date first. */
export async function storage() {
  const rows = await LabSample.find({ status: 'STORED' })
    .sort({ 'storage.until': 1 })
    .limit(500)
    .lean();
  const today = istToday();
  return {
    items: rows.map((s) => ({
      sampleNo: s.sampleNo,
      patient: s.patient?.name,
      sampleType: s.sampleType,
      tests: s.tests,
      location: s.storage?.location,
      until: s.storage?.until,
      due: Boolean(s.storage?.until && s.storage.until < today),
    })),
  };
}

export async function storeSample(sampleNo, { location, days }) {
  const s = await LabSample.findOne({ sampleNo });
  if (!s) throw errors.notFound('Sample');
  if (!['RECEIVED', 'STORED'].includes(s.status))
    throw new AppError(409, 'INVALID_STATE', 'Only a received sample can be stored');
  const until = new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);
  s.set({
    status: 'STORED',
    storage: { location, until, storedAt: new Date(), storedBy: (await me()).name },
  });
  await s.save();
  return { sampleNo, status: 'STORED', location, until };
}

export async function discardSample(sampleNo) {
  const s = await LabSample.findOne({ sampleNo });
  if (!s) throw errors.notFound('Sample');
  if (s.status !== 'STORED')
    throw new AppError(409, 'INVALID_STATE', 'Only a stored sample is discarded');
  s.set({ status: 'DISCARDED', discardedAt: new Date() });
  await s.save();
  return { sampleNo, status: 'DISCARDED' };
}

// ---------------------------------------------------------------- histopathology

/** Cases with special stains or IHC and whether the report is out. */
export async function stains() {
  const rows = await HistoCase.find({ 'specialStains.0': { $exists: true } })
    .select('caseNo patient specimen specialStains status reportedAt createdAt')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return {
    items: rows.map((h) => ({
      id: String(h._id),
      caseNo: h.caseNo,
      patient: h.patient?.name,
      specimen: h.specimen,
      stains: h.specialStains,
      orderedAt: h.createdAt,
      done: h.status === 'REPORTED',
    })),
  };
}

/** Archive of blocks and slides with the issue log (second opinions, reviews). */
export async function archive() {
  const rows = await HistoCase.find({ archive: { $nin: [null, ''] } })
    .select('caseNo patient blocks slides archive archiveLog')
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();
  return {
    items: rows.map((h) => {
      const last = (h.archiveLog ?? []).at(-1);
      return {
        id: String(h._id),
        caseNo: h.caseNo,
        patient: h.patient?.name,
        blocks: h.blocks ?? 0,
        slides: h.slides ?? 0,
        location: h.archive,
        issuedTo: last?.kind === 'ISSUE' ? last.to : null,
        issuedAt: last?.kind === 'ISSUE' ? last.at : null,
      };
    }),
  };
}

export async function issueArchive(id, { to, reason }) {
  const h = await HistoCase.findById(id);
  if (!h || !h.archive) throw errors.notFound('Archived case');
  const last = (h.archiveLog ?? []).at(-1);
  if (last?.kind === 'ISSUE')
    throw new AppError(409, 'INVALID_STATE', `Already issued to ${last.to}`);
  h.archiveLog.push({ kind: 'ISSUE', to, note: reason, at: new Date(), by: (await me()).name });
  await h.save();
  return { id, issuedTo: to };
}

export async function returnArchive(id) {
  const h = await HistoCase.findById(id);
  if (!h) throw errors.notFound('Archived case');
  const last = (h.archiveLog ?? []).at(-1);
  if (last?.kind !== 'ISSUE')
    throw new AppError(409, 'INVALID_STATE', 'Nothing is out for this case');
  h.archiveLog.push({ kind: 'RETURN', to: last.to, at: new Date(), by: (await me()).name });
  await h.save();
  return { id, issuedTo: null };
}

/** Turnaround from receipt to report, by specimen, over the last 90 days (hours). */
export async function turnaround() {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rows = await HistoCase.find({ status: 'REPORTED', reportedAt: { $gte: since } })
    .select('specimen createdAt reportedAt')
    .lean();
  const by = new Map();
  for (const h of rows) {
    const hours = Math.max(0, (new Date(h.reportedAt) - new Date(h.createdAt)) / 3_600_000);
    const key = h.specimen || 'Other';
    by.set(key, [...(by.get(key) ?? []), hours]);
  }
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  return {
    items: [...by.entries()]
      .map(([specimen, xs]) => ({
        specimen,
        cases: xs.length,
        medianHours: Math.round(median(xs) * 10) / 10,
        within48h: Math.round((xs.filter((x) => x <= 48).length * 100) / xs.length),
      }))
      .sort((a, b) => b.cases - a.cases),
  };
}

// ---------------------------------------------------------------- infection alerts

const RESERVE = ['MEROPENEM', 'IMIPENEM', 'ERTAPENEM'];
/** Resistance worth telling infection control about, from a culture's organism and sensitivity. */
export function resistanceAlert(c) {
  const org = String(c.organism ?? '').toLowerCase();
  const resistant = new Set(
    (c.sensitivity ?? [])
      .filter((s) => s.result === 'R')
      .map((s) => String(s.antibiotic).toUpperCase()),
  );
  if (org.includes('aureus') && (resistant.has('CEFOXITIN') || resistant.has('OXACILLIN')))
    return 'MRSA';
  if (org.includes('enterococc') && resistant.has('VANCOMYCIN')) return 'VRE';
  if (RESERVE.some((a) => resistant.has(a))) return org.includes('acinetobacter') ? 'CRAB' : 'CRE';
  if (resistant.has('CEFTRIAXONE') || resistant.has('CEFOTAXIME')) return 'ESBL';
  return null;
}

/** Cultures in the last 30 days with an alert organism, newest first. */
export async function infectionAlerts() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await Culture.find({ organism: { $nin: [null, ''] }, updatedAt: { $gte: since } })
    .select('sampleNo patient location specimen organism sensitivity finalAt updatedAt status')
    .sort({ updatedAt: -1 })
    .limit(300)
    .lean();
  return {
    items: rows
      .map((c) => ({ c, alert: resistanceAlert(c) }))
      .filter((x) => x.alert)
      .map(({ c, alert }) => ({
        id: String(c._id),
        alert,
        sampleNo: c.sampleNo,
        patient: c.patient?.name,
        location: c.location,
        specimen: c.specimen,
        organism: c.organism,
        at: c.finalAt ?? c.updatedAt,
        final: c.status === 'FINAL',
      })),
  };
}
