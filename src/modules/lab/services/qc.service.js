import { z } from 'zod';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { errors } from '../../../core/errors/index.js';
import { LabItem, QcControl, QcRun } from '../models/lab.models.js';
import { me, settingsDoc } from './common.js';

const DAY = 86_400_000;

const controlOut = (c, last) => ({
  id: String(c._id),
  analyser: c.analyser,
  analyte: c.analyte,
  name: c.name ?? c.analyte,
  level: c.level,
  lot: c.lot ?? null,
  mean: c.mean,
  sd: c.sd,
  unit: c.unit ?? null,
  isActive: c.isActive !== false,
  last: last ? runOut(last) : null,
});
const runOut = (r) => ({
  id: String(r._id),
  controlId: String(r.controlId),
  value: r.value,
  z: r.z,
  rules: r.rules ?? [],
  status: r.status,
  at: r.at,
  by: r.by,
  note: r.note ?? null,
});

export const controlInput = z.object({
  analyser: z.string().trim().min(2).max(40),
  analyte: z.string().trim().min(1).max(12),
  name: z.string().trim().max(80).optional(),
  level: z.string().trim().min(1).max(10).default('L1'),
  lot: z.string().trim().max(40).optional(),
  mean: z.number().finite(),
  sd: z.number().positive(),
  unit: z.string().trim().max(20).optional(),
});

export async function createControl(input) {
  const [c] = await QcControl.create([input]);
  return controlOut(c.toObject());
}

/** Controls with their latest run, grouped by analyser on the QC screen. */
export async function listControls() {
  const controls = await QcControl.find({ isActive: true })
    .sort({ analyser: 1, analyte: 1, level: 1 })
    .lean();
  const out = [];
  for (const c of controls) {
    const last = await QcRun.findOne({ controlId: c._id }).sort({ at: -1 }).lean();
    out.push(controlOut(c, last));
  }
  return { items: out, total: out.length, page: 1, limit: out.length };
}

/**
 * Westgard (R5) with the analyser's configured rules (default: 1-3s and 2-2s reject, 1-2s
 * warns). 1-3s: beyond 3 SD. 2-2s: this run and the last beyond 2 SD on the same side. R-4s:
 * this run and the last more than 4 SD apart. 1-2s: beyond 2 SD (a warning unless listed to
 * reject).
 */
export const DEFAULT_QC_RULE = Object.freeze({ warning: '1-2s', reject: ['1-3s', '2-2s'] });

export function westgard(z, prevZ, rule = DEFAULT_QC_RULE) {
  const reject = new Set(rule.reject ?? DEFAULT_QC_RULE.reject);
  const broken = [];
  if (Math.abs(z) > 3) broken.push('1-3s');
  if (prevZ != null && Math.abs(z) > 2 && Math.abs(prevZ) > 2 && Math.sign(prevZ) === Math.sign(z))
    broken.push('2-2s');
  if (prevZ != null && Math.abs(z - prevZ) > 4) broken.push('R-4s');
  if (Math.abs(z) > 2) broken.push('1-2s');
  const rejecting = broken.filter((r) => reject.has(r));
  if (rejecting.length) return { status: 'REJECTED', rules: [rejecting[0]] };
  const warning = rule.warning ?? DEFAULT_QC_RULE.warning;
  if (broken.includes(warning) || broken.length) return { status: 'WARNING', rules: [broken[0]] };
  return { status: 'IN_CONTROL', rules: [] };
}

/**
 * A QC run. A rejected run holds every result from that analyser entered since its last
 * in-control run (alternate flow F); they are rerun once QC is back in control.
 */
export async function recordRun({ controlId, value, note }) {
  const c = await QcControl.findById(controlId).lean();
  if (!c) throw errors.notFound('QC control');
  const prev = await QcRun.findOne({ controlId }).sort({ at: -1 }).lean();
  const z = Math.round(((value - c.mean) / c.sd) * 100) / 100;
  const rule = (await settingsDoc()).qcRules?.find((r) => r.analyser === c.analyser);
  const verdict = westgard(z, prev?.z, rule ?? DEFAULT_QC_RULE);
  const by = await me();
  const now = new Date();
  return withTransaction(async () => {
    const [run] = await QcRun.create([
      {
        controlId,
        analyser: c.analyser,
        analyte: c.analyte,
        level: c.level,
        value,
        z,
        ...verdict,
        at: now,
        by: by.name,
        note,
      },
    ]);
    let held = 0;
    if (verdict.status === 'REJECTED') {
      const lastGood = await QcRun.findOne({
        analyser: c.analyser,
        status: 'IN_CONTROL',
        _id: { $ne: run._id },
      })
        .sort({ at: -1 })
        .lean();
      const since = lastGood?.at ?? new Date(now.getTime() - DAY);
      const items = await LabItem.find({
        analyser: c.analyser,
        status: { $in: ['RESULTED', 'VERIFIED'] },
        enteredAt: { $gte: since },
      });
      for (const i of items) {
        if (i.holds.some((h) => h.kind === 'QC' && h.open)) continue;
        i.holds.push({
          kind: 'QC',
          note: `${c.analyser} ${c.analyte} ${c.level} ${verdict.rules[0]}`,
          at: now,
        });
        await i.save();
        held += 1;
      }
      await publish('lab.qc.failed', {
        analyser: c.analyser,
        analyte: c.analyte,
        level: c.level,
        rule: verdict.rules[0],
        held,
      });
    }
    return { ...runOut(run.toObject()), held };
  });
}

/** Levey-Jennings data: the last 30 runs of a control with mean and SD lines. */
export async function leveyJennings(controlId) {
  const c = await QcControl.findById(controlId).lean();
  if (!c) throw errors.notFound('QC control');
  const runs = await QcRun.find({ controlId }).sort({ at: -1 }).limit(30).lean();
  return { control: controlOut(c), runs: runs.reverse().map(runOut) };
}

/**
 * R4 gate for result entry on an analyser: a run in the last 24 hours, and the latest run of
 * every control on it not rejected.
 */
export async function qcGate(analyser) {
  const controls = await QcControl.find({ analyser, isActive: true })
    .select('_id analyte level')
    .lean();
  if (!controls.length) return { ok: true };
  const since = new Date(Date.now() - DAY);
  const recent = await QcRun.exists({ analyser, at: { $gte: since } });
  if (!recent)
    return {
      ok: false,
      message: `Run QC on ${analyser} first: no QC run in the last 24 hours (rule R4).`,
    };
  for (const c of controls) {
    const last = await QcRun.findOne({ controlId: c._id }).sort({ at: -1 }).select('status').lean();
    if (last?.status === 'REJECTED')
      return {
        ok: false,
        message: `QC on ${analyser} is out of control (${c.analyte} ${c.level}). Fix and rerun QC before patient results (rule R4).`,
      };
  }
  return { ok: true };
}

/** Each analyser's state for the worklist banner. */
export async function qcStatus() {
  const analysers = await QcControl.distinct('analyser', { isActive: true });
  const out = [];
  for (const a of analysers.sort()) {
    const gate = await qcGate(a);
    out.push({ analyser: a, ok: gate.ok, message: gate.ok ? null : gate.message });
  }
  return { items: out };
}
