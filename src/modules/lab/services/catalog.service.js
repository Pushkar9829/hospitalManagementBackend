import { z } from 'zod';
import { errors } from '../../../core/errors/index.js';
import { Service } from '../../setup/index.js';
import { DEFAULT_TESTS, genericTest } from '../data/tests.js';
import { LabTest } from '../models/lab.models.js';
import { escape, settingsDoc } from './common.js';

/**
 * Every active LAB service gets a test definition (defaults for common tests, a single result
 * line otherwise), so a test ordered anywhere can be collected and resulted. Idempotent.
 */
export async function ensureTests() {
  const services = await Service.find({ category: 'LAB', isActive: true }).lean();
  const have = new Set(
    (await LabTest.find({}).select('serviceId').lean()).map((t) => String(t.serviceId)),
  );
  let added = 0;
  for (const s of services) {
    if (have.has(String(s._id))) continue;
    const def = DEFAULT_TESTS[s.code] ?? genericTest(s.name);
    try {
      await LabTest.create([{ serviceId: s._id, code: s.code, name: s.name, ...def }]);
      added += 1;
    } catch (e) {
      if (e?.code !== 11000) throw e; // created meanwhile by another request
    }
  }
  return added;
}

/** The test for a billable service, created on first use. */
export async function testForService(serviceId) {
  let t = await LabTest.findOne({ serviceId, isActive: true }).lean();
  if (!t) {
    await ensureTests();
    t = await LabTest.findOne({ serviceId, isActive: true }).lean();
  }
  return t;
}

export const testOut = (t) => ({
  id: String(t._id),
  serviceId: String(t.serviceId),
  code: t.code,
  name: t.name,
  department: t.department,
  sampleType: t.sampleType,
  container: t.container,
  method: t.method ?? null,
  analyser: t.analyser ?? null,
  tatMin: t.tatMin ?? null,
  stabilityHours: t.stabilityHours,
  sensitive: Boolean(t.sensitive),
  nabl: t.nabl !== false,
  autoverify: Boolean(t.autoverify),
  isActive: t.isActive !== false,
  analytes: (t.analytes ?? []).map((a) => ({
    code: a.code,
    name: a.name,
    unit: a.unit ?? null,
    kind: a.kind,
    choices: a.choices ?? [],
    abnormal: a.abnormal ?? [],
    decimals: a.decimals ?? 1,
    ranges: (a.ranges ?? []).map((r) => ({
      sex: r.sex,
      ageMinDays: r.ageMinDays ?? 0,
      ageMaxDays: r.ageMaxDays ?? null,
      low: r.low ?? null,
      high: r.high ?? null,
      text: r.text ?? null,
    })),
    criticalLow: a.criticalLow ?? null,
    criticalHigh: a.criticalHigh ?? null,
    deltaPct: a.deltaPct ?? null,
    repeatOnCritical: Boolean(a.repeatOnCritical),
  })),
});

export async function listTests({ q, department } = {}) {
  await ensureTests();
  const filter = {};
  if (department) filter.department = department;
  if (q) filter.$or = [{ name: new RegExp(escape(q), 'i') }, { code: new RegExp(escape(q), 'i') }];
  const items = await LabTest.find(filter).sort({ department: 1, name: 1 }).lean();
  return { items: items.map(testOut), total: items.length, page: 1, limit: items.length };
}

export async function getTest(id) {
  const t = await LabTest.findById(id).lean();
  if (!t) throw errors.notFound('Test');
  return testOut(t);
}

const n = z.number().finite().nullable().optional();
export const testInput = z.object({
  department: z
    .enum([
      'BIOCHEMISTRY',
      'HAEMATOLOGY',
      'CLINICAL_PATHOLOGY',
      'SEROLOGY',
      'MICROBIOLOGY',
      'HISTOPATHOLOGY',
    ])
    .optional(),
  sampleType: z.string().trim().max(30).optional(),
  container: z.string().trim().max(30).optional(),
  method: z.string().trim().max(120).optional(),
  analyser: z.string().trim().max(40).nullable().optional(),
  tatMin: z
    .number()
    .int()
    .min(10)
    .max(30 * 24 * 60)
    .nullable()
    .optional(),
  stabilityHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
  sensitive: z.boolean().optional(),
  nabl: z.boolean().optional(),
  autoverify: z.boolean().optional(),
  isActive: z.boolean().optional(),
  analytes: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(12),
        name: z.string().trim().min(1).max(80),
        unit: z.string().trim().max(20).nullable().optional(),
        kind: z.enum(['NUMBER', 'TEXT', 'CHOICE']).default('NUMBER'),
        choices: z.array(z.string().trim().max(40)).max(20).optional(),
        abnormal: z.array(z.string().trim().max(40)).max(20).optional(),
        decimals: z.number().int().min(0).max(4).optional(),
        ranges: z
          .array(
            z.object({
              sex: z.enum(['ANY', 'M', 'F']).default('ANY'),
              ageMinDays: z.number().int().min(0).default(0),
              ageMaxDays: z.number().int().min(0).nullable().optional(),
              low: n,
              high: n,
              text: z.string().trim().max(60).nullable().optional(),
            }),
          )
          .max(20)
          .optional(),
        criticalLow: n,
        criticalHigh: n,
        deltaPct: z.number().min(1).max(1000).nullable().optional(),
        repeatOnCritical: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(40)
    .optional(),
});

/** Lab in-charge edits a test (ranges, critical and delta limits); prices stay in setup. */
export async function updateTest(id, input) {
  const t = await LabTest.findById(id);
  if (!t) throw errors.notFound('Test');
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));
  const { analytes, ...rest } = input;
  t.set(clean(rest));
  if ('analyser' in input && input.analyser === null) t.analyser = undefined;
  if ('tatMin' in input && input.tatMin === null) t.tatMin = undefined;
  if (analytes) {
    const codes = analytes.map((a) => a.code);
    if (new Set(codes).size !== codes.length)
      throw errors.validation([{ path: 'analytes', message: 'Each analyte needs its own code' }]);
    t.analytes = analytes.map((a) => ({
      ...clean(a),
      ranges: (a.ranges ?? []).map(clean),
    }));
  }
  await t.save();
  return testOut(t.toObject());
}

// ---------------------------------------------------------------- settings

export const settingsInput = z.object({
  criticalCallMin: z.number().int().min(5).max(120).optional(),
  escalateMin: z.number().int().min(5).max(60).optional(),
  deltaDays: z.number().int().min(1).max(90).optional(),
  autoverify: z.boolean().optional(),
  labelVoidHours: z.number().int().min(1).max(24).optional(),
  tatMin: z
    .object({
      STAT: z.number().int().min(15).max(240),
      URGENT: z.number().int().min(30).max(720),
      ROUTINE: z.number().int().min(60).max(2880),
    })
    .partial()
    .optional(),
  rejectReasons: z.array(z.string().trim().min(2).max(40)).min(1).max(20).optional(),
  retentionDays: z
    .object({
      serum: z.number().int().min(1).max(60),
      blocks: z.number().int().min(365).max(36500),
    })
    .partial()
    .optional(),
  qcRules: z
    .array(
      z.object({
        analyser: z.string().trim().min(2).max(60),
        warning: z.enum(['1-2s']).default('1-2s'),
        reject: z
          .array(z.enum(['1-2s', '1-3s', '2-2s', 'R-4s']))
          .min(1)
          .max(4),
        levels: z.number().int().min(1).max(3).optional(),
        frequency: z.string().trim().max(60).optional(),
      }),
    )
    .max(30)
    .optional(),
  homeCollection: z
    .object({
      fee: z.number().int().min(0).max(1_00_000_00),
      slots: z.array(z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)).max(24),
      areas: z.array(z.string().trim().min(2).max(60)).max(100),
    })
    .partial()
    .optional(),
  report: z
    .object({
      header: z.string().trim().max(300),
      footer: z.string().trim().max(300),
      signatories: z
        .array(
          z.object({
            department: z.string().trim().max(40),
            name: z.string().trim().min(2).max(80),
            qualification: z.string().trim().max(80).optional(),
          }),
        )
        .max(20),
    })
    .partial()
    .optional(),
});

const settingsOut = (s) => ({
  criticalCallMin: s.criticalCallMin,
  escalateMin: s.escalateMin,
  deltaDays: s.deltaDays,
  autoverify: s.autoverify,
  labelVoidHours: s.labelVoidHours,
  tatMin: { STAT: s.tatMin.STAT, URGENT: s.tatMin.URGENT, ROUTINE: s.tatMin.ROUTINE },
  rejectReasons: s.rejectReasons,
  retentionDays: { serum: s.retentionDays.serum, blocks: s.retentionDays.blocks },
  qcRules: (s.qcRules ?? []).map((r) => ({ ...(r.toObject?.() ?? r) })),
  homeCollection: {
    fee: s.homeCollection?.fee ?? 0,
    slots: [...(s.homeCollection?.slots ?? [])],
    areas: [...(s.homeCollection?.areas ?? [])],
  },
  report: {
    header: s.report?.header ?? '',
    footer: s.report?.footer ?? '',
    signatories: (s.report?.signatories ?? []).map((x) => ({ ...(x.toObject?.() ?? x) })),
  },
  version: s.version,
});

export async function getSettings() {
  return settingsOut(await settingsDoc());
}

export async function saveSettings(input) {
  const s = await settingsDoc();
  const { tatMin, retentionDays, homeCollection, report, ...rest } = input;
  s.set(rest);
  if (homeCollection)
    s.homeCollection = { ...(s.homeCollection?.toObject?.() ?? {}), ...homeCollection };
  if (report) s.report = { ...(s.report?.toObject?.() ?? {}), ...report };
  if (tatMin) s.tatMin = { ...s.tatMin.toObject(), ...tatMin };
  if (retentionDays) s.retentionDays = { ...s.retentionDays.toObject(), ...retentionDays };
  await s.save();
  return settingsOut(s);
}
