import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { errors } from '../../core/errors/index.js';
import { current } from '../../core/tenancy/context.js';
import { Patient } from './models/patient.model.js';

/**
 * The patient record's sections that belong to other modules: OPD visits and prescriptions,
 * IPD admissions, lab and imaging reports, and the summary card. Patients sits upstream of
 * those modules, so each registers its own provider (`registerPatientSection`) from its index;
 * a section whose module the hospital does not have answers an empty list.
 */
const sections = new Map(); // name -> [{ module, list(patientId) }]
const summaries = []; // [{ module, build(patientId) }]

export const SECTIONS = ['visits', 'admissions', 'reports', 'prescriptions'];

/** list(patientId) returns rows newest first, each with an `id` and a `date` (ISO or Date). */
export function registerPatientSection(name, module, list) {
  if (!SECTIONS.includes(name)) throw new Error(`Unknown patient section ${name}`);
  sections.set(name, [...(sections.get(name) ?? []), { module, list }]);
}

/** build(patientId) returns part of the summary card, e.g. { opdVisits, conditions }. */
export function registerPatientSummary(module, build) {
  summaries.push({ module, build });
}

const enabled = (module) => {
  const mods = current().modules;
  return !mods || mods.has(module);
};

async function mustExist(patientId) {
  if (!(await Patient.exists({ _id: patientId }))) throw errors.notFound('Patient');
}

export async function patientSection(name, patientId, { page = 1, limit = 25 } = {}) {
  await mustExist(patientId);
  const rows = [];
  for (const p of sections.get(name) ?? [])
    if (enabled(p.module)) rows.push(...(await p.list(patientId)));
  rows.sort((a, b) => new Date(b.date ?? b.since ?? 0) - new Date(a.date ?? a.since ?? 0));
  return { items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
}

export async function patientSummary(patientId) {
  await mustExist(patientId);
  const out = {
    conditions: [],
    activeMedicines: 0,
    opdVisits: 0,
    ipdStays: 0,
    outstanding: 0,
    wallet: 0,
    admission: null,
    membership: null,
  };
  for (const s of summaries) if (enabled(s.module)) Object.assign(out, await s.build(patientId));
  return out;
}

/** Patients registered today (IST), newest first (a UHID is hospital-wide, not per branch). */
export async function registeredToday({ limit = 6 } = {}) {
  const start = new Date(
    `${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00+05:30`,
  );
  const filter = { createdAt: { $gte: start }, mergedInto: { $exists: false } };
  const rows = await Patient.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('uhid name createdAt')
    .lean();
  const total = await Patient.countDocuments(filter);
  return {
    items: rows.map((p) => ({
      id: String(p._id),
      uhid: p.uhid,
      name: [p.name?.title, p.name?.first, p.name?.middle, p.name?.last].filter(Boolean).join(' '),
      registeredAt: p.createdAt,
    })),
    total,
    page: 1,
    limit,
  };
}

const id = z.object({ id: objectId });
const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const READ = 'patients:patient:read';

export const patientSectionRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/patients',
  routes: [
    {
      method: 'get',
      path: '/registered-today',
      permission: READ,
      audit: null,
      summary: 'Patients registered today',
      schema: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(6) }) },
      handler: (req) => registeredToday(req.valid.query),
    },
    {
      method: 'get',
      path: '/:id/summary',
      permission: READ,
      audit: 'VIEW',
      summary: 'Clinical and money summary for the patient record',
      schema: { params: id },
      handler: (req) => patientSummary(req.valid.params.id),
    },
    ...SECTIONS.map((name) => ({
      method: 'get',
      path: `/:id/${name}`,
      permission: READ,
      audit: 'VIEW',
      summary: `The patient's ${name}, newest first`,
      schema: { params: id, query: paging },
      handler: (req) => patientSection(name, req.valid.params.id, req.valid.query),
    })),
  ],
});

/**
 * ABDM Scan and Share: patients who scanned the hospital's QR with an ABHA app. Arrivals come
 * from the ABDM gateway callback once the hospital is linked (Settings, Integrations); until
 * then the list is empty and says so.
 */
export const abdmRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/abdm',
  routes: [
    {
      method: 'get',
      path: '/scan-share',
      permission: READ,
      audit: null,
      summary: 'ABDM Scan and Share arrivals today (empty until ABDM is connected)',
      schema: { query: paging },
      handler: (req) => ({
        items: [],
        total: 0,
        page: req.valid.query.page,
        limit: req.valid.query.limit,
        connected: false,
      }),
    },
  ],
});
