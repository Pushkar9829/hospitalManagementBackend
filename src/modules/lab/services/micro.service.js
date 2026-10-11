import { z } from 'zod';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { LabItem } from '../models/lab.models.js';
import { Culture, HistoCase } from '../models/micro.models.js';
import { escape, itemOut, me, patientOut } from './common.js';

const snap = (p) => ({ id: p.id, uhid: p.uhid, name: p.name, gender: p.gender, age: p.age });

/** On receipt: a culture for microbiology tests, a case for histopathology (idempotent). */
export async function openForItem(item, sample) {
  if (item.department === 'MICROBIOLOGY' && !(await Culture.exists({ itemId: item._id })))
    await Culture.create([
      {
        itemId: item._id,
        orderNo: item.orderNo,
        sampleNo: item.sampleNo,
        test: item.name,
        specimen: sample?.sampleType,
        patient: snap(item.patient),
        location: item.location,
      },
    ]);
  if (item.department === 'HISTOPATHOLOGY' && !(await HistoCase.exists({ itemId: item._id })))
    await HistoCase.create([
      {
        itemId: item._id,
        caseNo: await documentNumber('HP'),
        orderNo: item.orderNo,
        test: item.name,
        patient: snap(item.patient),
        location: item.location,
        clinicalNotes: item.clinicalNotes,
        specimen: sample?.sampleType,
        history: [{ status: 'RECEIVED', at: new Date(), by: (await me()).name }],
      },
    ]);
}

/** Writes the final report onto the test; it then waits for the pathologist's release (R9). */
async function reportOnItem(itemId, { value, flag, comment }, by) {
  const i = await LabItem.findById(itemId);
  if (!i) throw errors.notFound('Lab test');
  if (!['RECEIVED', 'RESULTED', 'VERIFIED'].includes(i.status))
    throw new AppError(409, 'INVALID_STATE', 'This test is already released or not received.');
  const now = new Date();
  i.results = [{ code: 'RESULT', name: i.name, value, flag }];
  i.comment = comment;
  i.status = 'VERIFIED';
  i.enteredBy = by;
  i.enteredAt = now;
  i.verifiedBy = by;
  i.verifiedAt = now;
  await i.save();
  return itemOut(i.toObject());
}

// ---------------------------------------------------------------- cultures (flow H)

const cultureOut = (c) => ({
  id: String(c._id),
  itemId: String(c.itemId),
  orderNo: c.orderNo,
  sampleNo: c.sampleNo ?? null,
  test: c.test,
  specimen: c.specimen ?? null,
  patient: patientOut(c.patient),
  location: c.location ?? null,
  status: c.status,
  media: c.media ?? [],
  platedAt: c.platedAt ?? null,
  hoursSincePlating: c.platedAt ? Math.floor((Date.now() - c.platedAt) / 3_600_000) : null,
  readings: c.readings ?? [],
  noGrowth: Boolean(c.noGrowth),
  organism: c.organism ?? null,
  colonyCount: c.colonyCount ?? null,
  sensitivity: c.sensitivity ?? [],
  prelimAt: c.prelimAt ?? null,
  finalAt: c.finalAt ?? null,
  finalBy: c.finalBy ?? null,
  createdAt: c.createdAt,
});

export async function listCultures({ status, q, open = true } = {}) {
  const filter = status
    ? { status: { $in: status.split(',') } }
    : open
      ? { status: { $ne: 'FINAL' } }
      : {};
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [
      { 'patient.name': rx },
      { 'patient.uhid': rx },
      { sampleNo: rx },
      { orderNo: rx },
    ];
  }
  const rows = await Culture.find(filter).sort({ createdAt: 1 }).limit(300).lean();
  return { items: rows.map(cultureOut), total: rows.length, page: 1, limit: 300 };
}

async function findCulture(id) {
  const c = await Culture.findById(id);
  if (!c) throw errors.notFound('Culture');
  return c;
}

export async function getCulture(id) {
  return cultureOut((await findCulture(id)).toObject());
}

export async function plate(id, { media }) {
  const c = await findCulture(id);
  if (c.status !== 'RECEIVED')
    throw new AppError(409, 'INVALID_STATE', 'This culture is already plated.');
  c.media = media;
  c.platedAt = new Date();
  c.status = 'PLATED';
  await c.save();
  return cultureOut(c.toObject());
}

/**
 * A plate reading. Growth at 24 hours sends a preliminary report to the doctor; no growth at 48
 * hours or later lets the culture be finalised as "no growth".
 */
export async function addReading(id, { growth, text }) {
  const c = await findCulture(id);
  if (!['PLATED', 'GROWTH_READ', 'IDENTIFIED'].includes(c.status))
    throw new AppError(409, 'INVALID_STATE', 'Plate the sample before reading it.');
  const by = await me();
  const hours = Math.floor((Date.now() - c.platedAt) / 3_600_000);
  c.readings.push({ at: new Date(), hours, growth, text, by: by.name });
  if (c.status === 'PLATED') c.status = 'GROWTH_READ';
  c.noGrowth = !growth && hours >= 48;
  if (growth && !c.prelimAt) {
    c.prelimAt = new Date();
    await publish('lab.culture.prelim', {
      cultureId: String(c._id),
      itemId: String(c.itemId),
      patientName: c.patient.name,
      text,
    });
  }
  await c.save();
  return cultureOut(c.toObject());
}

export async function identify(id, { organism, colonyCount }) {
  const c = await findCulture(id);
  if (!['GROWTH_READ', 'IDENTIFIED', 'SENSITIVITY_DONE'].includes(c.status))
    throw new AppError(409, 'INVALID_STATE', 'Record growth before identifying the organism.');
  if (!c.readings.some((r) => r.growth))
    throw new AppError(409, 'NO_GROWTH_READ', 'No growth is recorded on this culture.');
  c.organism = organism;
  c.colonyCount = colonyCount;
  if (c.status === 'GROWTH_READ') c.status = 'IDENTIFIED';
  await c.save();
  return cultureOut(c.toObject());
}

export const sensitivityInput = z.object({
  rows: z
    .array(
      z.object({
        antibiotic: z.string().trim().min(2).max(60),
        result: z.enum(['S', 'I', 'R']),
        mic: z.string().trim().max(20).optional(),
      }),
    )
    .min(1)
    .max(40),
});

export async function setSensitivity(id, { rows }) {
  const c = await findCulture(id);
  if (!['IDENTIFIED', 'SENSITIVITY_DONE'].includes(c.status))
    throw new AppError(409, 'INVALID_STATE', 'Identify the organism before sensitivity.');
  const names = rows.map((r) => r.antibiotic.toLowerCase());
  if (new Set(names).size !== names.length)
    throw errors.validation([{ path: 'rows', message: 'Each antibiotic once' }]);
  c.sensitivity = rows;
  c.status = 'SENSITIVITY_DONE';
  await c.save();
  return cultureOut(c.toObject());
}

/** Final report: no growth (48 h or more) or organism with sensitivity; then release as usual. */
export async function finalizeCulture(id) {
  const c = await findCulture(id);
  if (c.status === 'FINAL') throw new AppError(409, 'INVALID_STATE', 'Already final.');
  const ready = c.noGrowth || c.status === 'SENSITIVITY_DONE';
  if (!ready)
    throw new AppError(
      409,
      'CULTURE_NOT_READY',
      'Finalise after 48 hours with no growth, or after identification and sensitivity.',
    );
  const by = await me();
  return withTransaction(async () => {
    const lines = c.noGrowth
      ? null
      : c.sensitivity.map((s) => `${s.antibiotic}: ${s.result}${s.mic ? ` (MIC ${s.mic})` : ''}`);
    await reportOnItem(
      c.itemId,
      c.noGrowth
        ? { value: 'No growth after 48 hours of incubation', flag: 'N', comment: undefined }
        : {
            value: `${c.organism}${c.colonyCount ? `, ${c.colonyCount}` : ''}`,
            flag: 'A',
            comment: `Sensitivity:\n${lines.join('\n')}`,
          },
      by,
    );
    c.status = 'FINAL';
    c.finalAt = new Date();
    c.finalBy = by.name;
    await c.save();
    return cultureOut(c.toObject());
  });
}

/** Antibiogram (infection control): % susceptible per organism and antibiotic, final cultures. */
export async function antibiogram({ days = 180 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await Culture.find({
    status: 'FINAL',
    organism: { $ne: null },
    finalAt: { $gte: since },
  })
    .select('organism sensitivity')
    .lean();
  const table = new Map();
  for (const c of rows)
    for (const s of c.sensitivity ?? []) {
      const k = `${c.organism}|${s.antibiotic}`;
      const r = table.get(k) ?? {
        organism: c.organism,
        antibiotic: s.antibiotic,
        tested: 0,
        susceptible: 0,
      };
      r.tested += 1;
      if (s.result === 'S') r.susceptible += 1;
      table.set(k, r);
    }
  const items = [...table.values()]
    .map((r) => ({ ...r, pct: Math.round((r.susceptible * 1000) / r.tested) / 10 }))
    .sort(
      (a, b) => a.organism.localeCompare(b.organism) || a.antibiotic.localeCompare(b.antibiotic),
    );
  return { days, isolates: rows.length, items };
}

// ---------------------------------------------------------------- histopathology (flow I)

const NEXT = { RECEIVED: 'GROSSED', GROSSED: 'PROCESSED', PROCESSED: 'SLIDES', SLIDES: 'REPORTED' };

const caseOut = (h) => ({
  id: String(h._id),
  itemId: String(h.itemId),
  caseNo: h.caseNo,
  orderNo: h.orderNo,
  test: h.test,
  patient: patientOut(h.patient),
  location: h.location ?? null,
  clinicalNotes: h.clinicalNotes ?? null,
  status: h.status,
  specimen: h.specimen ?? null,
  fixative: h.fixative ?? null,
  gross: h.gross ?? null,
  blocks: h.blocks ?? null,
  slides: h.slides ?? null,
  specialStains: h.specialStains ?? [],
  microscopy: h.microscopy ?? null,
  diagnosis: h.diagnosis ?? null,
  icdO: h.icdO ?? null,
  archive: h.archive ?? null,
  history: h.history ?? [],
  reportedAt: h.reportedAt ?? null,
  reportedBy: h.reportedBy ?? null,
  workingDays: Math.floor((Date.now() - new Date(h.createdAt)) / 86_400_000),
  createdAt: h.createdAt,
});

export async function listCases({ status, q, open = true } = {}) {
  const filter = status
    ? { status: { $in: status.split(',') } }
    : open
      ? { status: { $ne: 'REPORTED' } }
      : {};
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ 'patient.name': rx }, { caseNo: rx }, { orderNo: rx }];
  }
  const rows = await HistoCase.find(filter).sort({ createdAt: 1 }).limit(300).lean();
  return { items: rows.map(caseOut), total: rows.length, page: 1, limit: 300 };
}

async function findCase(id) {
  const h = await HistoCase.findById(id);
  if (!h) throw errors.notFound('Histopathology case');
  return h;
}

export async function getCase(id) {
  return caseOut((await findCase(id)).toObject());
}

export const caseInput = z.object({
  specimen: z.string().trim().max(200).optional(),
  fixative: z.string().trim().max(60).optional(),
  gross: z.string().trim().max(4000).optional(),
  blocks: z.number().int().min(0).max(200).optional(),
  slides: z.number().int().min(0).max(500).optional(),
  specialStains: z.array(z.string().trim().max(40)).max(20).optional(),
  microscopy: z.string().trim().max(6000).optional(),
  diagnosis: z.string().trim().max(2000).optional(),
  icdO: z.string().trim().max(20).optional(),
  archive: z.string().trim().max(60).optional(),
  advance: z.boolean().default(false),
});

/** Save the case; `advance` moves it one step (grossing needs the gross description). */
export async function updateCase(id, { advance, ...input }) {
  const h = await findCase(id);
  if (h.status === 'REPORTED') throw new AppError(409, 'INVALID_STATE', 'The case is reported.');
  h.set(input);
  if (advance) {
    const next = NEXT[h.status];
    if (next === 'REPORTED')
      throw new AppError(409, 'INVALID_STATE', 'Use “Report” to sign out the diagnosis.');
    if (next === 'GROSSED' && !h.gross)
      throw errors.validation([{ path: 'gross', message: 'Write the gross description' }]);
    if (next === 'SLIDES' && !(h.blocks > 0))
      throw errors.validation([{ path: 'blocks', message: 'Record the blocks cut' }]);
    h.status = next;
    h.history.push({ status: next, at: new Date(), by: (await me()).name });
  }
  await h.save();
  return caseOut(h.toObject());
}

/** Sign out the diagnosis: written onto the test for the pathologist's release. */
export async function reportCase(id) {
  const h = await findCase(id);
  if (h.status !== 'SLIDES')
    throw new AppError(409, 'INVALID_STATE', 'Report once the slides are ready.');
  if (!h.diagnosis?.trim())
    throw errors.validation([{ path: 'diagnosis', message: 'Write the diagnosis' }]);
  const by = await me();
  return withTransaction(async () => {
    await reportOnItem(
      h.itemId,
      {
        value: h.diagnosis,
        flag: null,
        comment: [
          h.gross && `Gross: ${h.gross}`,
          h.microscopy && `Microscopy: ${h.microscopy}`,
          h.icdO && `ICD-O: ${h.icdO}`,
          `Blocks ${h.blocks ?? 0}, slides ${h.slides ?? 0}${h.archive ? `, archived at ${h.archive}` : ''}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
      by,
    );
    h.status = 'REPORTED';
    h.reportedAt = new Date();
    h.reportedBy = by.name;
    h.history.push({ status: 'REPORTED', at: h.reportedAt, by: by.name });
    await h.save();
    return caseOut(h.toObject());
  });
}
