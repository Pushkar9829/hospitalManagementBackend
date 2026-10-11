import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { runAsSystem } from '../../../core/tenancy/context.js';
import { CriticalCall, LabItem, LabTest } from '../models/lab.models.js';
import { itemOut, me, patientOut, settingsDoc } from './common.js';
import { qcGate } from './qc.service.js';

const fmt = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)).toString() : String(v));

/** Reference range for this patient (R6): sex-specific beats ANY; age in days must fit. */
export function rangeFor(analyte, patient) {
  const age = patient?.ageDays ?? 30 * 365;
  const fits = (analyte.ranges ?? []).filter(
    (r) =>
      (r.sex === 'ANY' || r.sex === patient?.gender) &&
      age >= (r.ageMinDays ?? 0) &&
      age <= (r.ageMaxDays ?? Infinity),
  );
  return fits.find((r) => r.sex !== 'ANY') ?? fits[0] ?? null;
}

const rangeText = (r, a) => {
  if (!r) return null;
  if (r.text) return r.text;
  const d = a.decimals ?? 1;
  if (r.low != null && r.high != null) return `${fmt(r.low, d)} - ${fmt(r.high, d)}`;
  if (r.high != null) return `< ${fmt(r.high, d)}`;
  if (r.low != null) return `> ${fmt(r.low, d)}`;
  return null;
};

/**
 * Flags one result: L/H against the range, LL/HH at the critical limits (R7), A for an abnormal
 * choice, and the delta from the last released value within the look-back (R8).
 */
export function evaluate(analyte, raw, patient, prev) {
  const value = String(raw ?? '').trim();
  const out = {
    code: analyte.code,
    name: analyte.name,
    unit: analyte.unit,
    value,
    flag: null,
    critical: false,
  };
  const r = rangeFor(analyte, patient);
  out.range = rangeText(r, analyte);
  if (!value) return out;
  if (analyte.kind === 'NUMBER') {
    const n = Number(value.replace(/,/g, ''));
    if (!Number.isFinite(n))
      throw errors.validation([{ path: analyte.code, message: `${analyte.name}: enter a number` }]);
    out.num = n;
    out.value = fmt(n, analyte.decimals ?? 1);
    if (analyte.criticalLow != null && n <= analyte.criticalLow) out.flag = 'LL';
    else if (analyte.criticalHigh != null && n >= analyte.criticalHigh) out.flag = 'HH';
    else if (r?.low != null && n < r.low) out.flag = 'L';
    else if (r?.high != null && n > r.high) out.flag = 'H';
    else if (r) out.flag = 'N';
    out.critical = out.flag === 'LL' || out.flag === 'HH';
    if (prev?.num != null && analyte.deltaPct && prev.num !== 0) {
      const changePct = Math.round((Math.abs(n - prev.num) * 1000) / Math.abs(prev.num)) / 10;
      out.delta = { prev: prev.value, prevAt: prev.at, changePct };
    }
  } else if (analyte.kind === 'CHOICE') {
    if (analyte.choices?.length && !analyte.choices.includes(value))
      throw errors.validation([
        { path: analyte.code, message: `${analyte.name}: pick ${analyte.choices.join(', ')}` },
      ]);
    out.flag = (analyte.abnormal ?? []).includes(value) ? 'A' : 'N';
  }
  return out;
}

/** Last released value of each analyte for this patient within the delta look-back. */
async function previousValues(item, days) {
  const since = new Date(Date.now() - days * 86_400_000);
  const prior = await LabItem.find({
    'patient.id': item.patient.id,
    code: item.code,
    status: 'RELEASED',
    releasedAt: { $gte: since },
    _id: { $ne: item._id },
  })
    .sort({ releasedAt: -1 })
    .limit(1)
    .lean();
  const map = new Map();
  for (const r of prior[0]?.results ?? [])
    map.set(r.code, { num: r.num, value: r.value, at: prior[0].releasedAt });
  return map;
}

async function findItem(id) {
  const i = await LabItem.findById(id);
  if (!i) throw errors.notFound('Lab test');
  return i;
}

const openHold = (i, kind) => i.holds.find((h) => h.kind === kind && h.open);

/**
 * Result entry by the technician. R4: the analyser's QC must be in control. Critical values open
 * a call task (R7); a delta beyond the limit holds the result for the pathologist (R8). Results
 * can be re-entered until they are released (a QC rerun closes the QC hold).
 */
export async function enterResults(id, { results, comment }) {
  const i = await findItem(id);
  if (!['RECEIVED', 'RESULTED', 'VERIFIED'].includes(i.status))
    throw new AppError(
      409,
      'INVALID_STATE',
      i.status === 'RELEASED'
        ? 'This report is released. Amend it instead (rule R10).'
        : 'Receive the sample before entering results.',
    );
  const test = await LabTest.findById(i.testId).lean();
  if (i.analyser) {
    const gate = await qcGate(i.analyser);
    if (!gate.ok)
      throw new AppError(409, 'QC_NOT_IN_CONTROL', gate.message, { analyser: i.analyser });
  }
  const s = await settingsDoc();
  const prev = await previousValues(i, s.deltaDays);
  const given = new Map(results.map((r) => [r.code, r.value]));
  const unknown = results.filter((r) => !test.analytes.some((a) => a.code === r.code));
  if (unknown.length)
    throw errors.validation([{ path: 'results', message: `Unknown result ${unknown[0].code}` }]);
  const evaluated = test.analytes.map((a) =>
    evaluate(a, given.get(a.code), i.patient, prev.get(a.code)),
  );
  if (!evaluated.some((r) => r.value))
    throw errors.validation([{ path: 'results', message: 'Enter at least one result' }]);
  const by = await me();
  const now = new Date();
  return withTransaction(async () => {
    i.results = evaluated;
    i.comment = comment ?? i.comment;
    i.status = 'RESULTED';
    i.enteredBy = by;
    i.enteredAt = now;
    i.verifiedBy = undefined;
    i.verifiedAt = undefined;
    const qc = openHold(i, 'QC');
    if (qc)
      Object.assign(qc, { open: false, closedAt: now, closedBy: by.name, note: 'Rerun after QC' });

    const critical = evaluated.filter((r) => r.critical);
    if (critical.length) {
      if (!openHold(i, 'CRITICAL'))
        i.holds.push({
          kind: 'CRITICAL',
          note: critical.map((r) => `${r.name} ${r.value}`).join(', '),
          at: now,
        });
      for (const r of critical) {
        const exists = await CriticalCall.exists({
          itemId: i._id,
          analyte: r.code,
          status: 'OPEN',
        });
        if (exists) continue;
        await CriticalCall.create([
          {
            itemId: i._id,
            orderNo: i.orderNo,
            patient: i.patient,
            location: i.location,
            test: i.name,
            analyte: r.name,
            value: `${r.value}${r.unit ? ` ${r.unit}` : ''}`,
            flag: r.flag,
            doctor: i.doctor?.name,
            dueAt: new Date(now.getTime() + s.criticalCallMin * 60_000),
            escalateAt: new Date(now.getTime() + s.escalateMin * 60_000),
          },
        ]);
        await publish('lab.critical.found', {
          itemId: String(i._id),
          patientName: i.patient.name,
          location: i.location,
          analyte: r.name,
          value: r.value,
          doctorId: i.doctor?.id ? String(i.doctor.id) : null,
        });
      }
    }
    const deltaAnalytes = test.analytes.filter((a) => {
      const r = evaluated.find((x) => x.code === a.code);
      return a.deltaPct && r?.delta?.changePct > a.deltaPct;
    });
    if (deltaAnalytes.length && !openHold(i, 'DELTA'))
      i.holds.push({
        kind: 'DELTA',
        note: deltaAnalytes
          .map((a) => {
            const r = evaluated.find((x) => x.code === a.code);
            return `${a.name} ${r.delta.prev} → ${r.value} (${r.delta.changePct}%)`;
          })
          .join(', '),
        at: now,
      });
    await i.save();
    return itemOut(i.toObject());
  });
}

/** Technical verification by the technician (step one of R9). */
export async function verify(id) {
  const i = await findItem(id);
  if (i.status !== 'RESULTED')
    throw new AppError(409, 'INVALID_STATE', 'Enter the results before verifying.');
  i.status = 'VERIFIED';
  i.verifiedBy = await me();
  i.verifiedAt = new Date();
  await i.save();
  return itemOut(i.toObject());
}

/**
 * Validation and release by the pathologist (R9): never by the person who entered the results;
 * blocked while a critical call is not logged or QC holds the run; a delta hold needs a comment.
 */
export async function release(id, { comment, acceptDelta = false }) {
  const i = await findItem(id);
  if (i.status !== 'VERIFIED')
    throw new AppError(409, 'INVALID_STATE', 'The technician verifies the results first.');
  const by = await me();
  if (by.id && i.enteredBy?.id && String(by.id) === String(i.enteredBy.id))
    throw new AppError(
      403,
      'MAKER_CHECKER',
      'You entered these results. Another pathologist must validate and release them (rule R9).',
    );
  if (openHold(i, 'QC'))
    throw new AppError(
      409,
      'QC_HOLD',
      'QC for this run failed. Rerun the sample after QC is in control.',
    );
  if (openHold(i, 'CRITICAL'))
    throw new AppError(
      409,
      'CRITICAL_CALL_PENDING',
      'Log the critical value call with read-back before release (rule R7).',
    );
  const delta = openHold(i, 'DELTA');
  if (delta && !(acceptDelta && comment?.trim()))
    throw errors.validation([
      {
        path: 'comment',
        message: 'Delta check: confirm the sample and write a comment to release',
      },
    ]);
  const now = new Date();
  if (delta) Object.assign(delta, { open: false, closedAt: now, closedBy: by.name });
  if (comment?.trim()) i.comment = [i.comment, comment.trim()].filter(Boolean).join('\n');
  i.status = 'RELEASED';
  i.releasedBy = by;
  i.releasedAt = now;
  await i.save();
  await publish('lab.report.released', reportEvent(i));
  return itemOut(i.toObject());
}

const reportEvent = (i) => ({
  itemId: String(i._id),
  orderNo: i.orderNo,
  test: i.name,
  patientId: String(i.patient.id),
  patientName: i.patient.name,
  mobile: i.patient.mobile,
  // R13: sensitive results (for example HIV) never go out by SMS or WhatsApp.
  sensitive: Boolean(i.sensitive),
  doctorId: i.doctor?.id ? String(i.doctor.id) : null,
  visitId: i.visitId ? String(i.visitId) : null,
  admissionId: i.admissionId ? String(i.admissionId) : null,
  critical: (i.results ?? []).some((r) => r.critical),
  version: i.reportVersion ?? 1,
});

/** Doctor acknowledges a released result (role-wise flow: doctor). */
export async function acknowledge(id) {
  const i = await findItem(id);
  if (i.status !== 'RELEASED')
    throw new AppError(409, 'INVALID_STATE', 'Only a released result can be acknowledged.');
  if (!i.acknowledgedAt) {
    i.acknowledgedAt = new Date();
    i.acknowledgedBy = (await me()).name;
    await i.save();
  }
  return itemOut(i.toObject());
}

// ---------------------------------------------------------------- amendments (R10)

async function applyAmendment(i, { reason, results }, byName) {
  const test = await LabTest.findById(i.testId).lean();
  const given = new Map(results.map((r) => [r.code, r.value]));
  const evaluated = test.analytes.map((a) =>
    evaluate(
      a,
      given.has(a.code) ? given.get(a.code) : i.results.find((r) => r.code === a.code)?.value,
      i.patient,
    ),
  );
  const now = new Date();
  i.amendments.push({
    version: i.reportVersion ?? 1,
    reason,
    results: i.results,
    releasedAt: i.releasedAt,
    releasedBy: i.releasedBy?.name,
    amendedAt: now,
    amendedBy: byName,
  });
  i.results = evaluated;
  i.reportVersion = (i.reportVersion ?? 1) + 1;
  i.releasedAt = now;
  i.acknowledgedAt = undefined;
  i.acknowledgedBy = undefined;
  await i.save();
  await publish('lab.report.amended', { ...reportEvent(i), reason });
}

/** A released report is never edited: the amendment is a new version, approved by the in-charge. */
export async function amend(id, { reason, results }, res) {
  const i = await findItem(id);
  if (i.status !== 'RELEASED')
    throw new AppError(409, 'INVALID_STATE', 'Only a released report can be amended.');
  const by = await me();
  const approval = await requestApproval({
    action: 'lab.reportAmend',
    module: 'LAB',
    entity: 'LabItem',
    entityId: i._id,
    title: `Amend report · ${i.name} · ${i.patient.name} (${i.orderNo})`,
    before: { results: i.results.map((r) => `${r.name} ${r.value}`) },
    after: { results: results.map((r) => `${r.code} ${r.value}`) },
    payload: { itemId: String(i._id), reason, results, by: by.name },
    reason,
  });
  if (approval) {
    if (res) res.locals.status = 202;
    return { approvalId: String(approval._id ?? approval.id), status: 'PENDING_APPROVAL' };
  }
  await applyAmendment(i, { reason, results }, by.name);
  return itemOut(i.toObject());
}

onApprovalDecided('lab.reportAmend', async (req, outcome) => {
  if (outcome !== 'APPROVED') return;
  const i = await LabItem.findById(req.payload.itemId);
  if (i && i.status === 'RELEASED') await applyAmendment(i, req.payload, req.payload.by);
});

// ---------------------------------------------------------------- critical calls (R7)

const callOut = (c) => ({
  id: String(c._id),
  itemId: String(c.itemId),
  orderNo: c.orderNo,
  patient: patientOut(c.patient),
  location: c.location ?? null,
  test: c.test,
  analyte: c.analyte,
  value: c.value,
  flag: c.flag,
  doctor: c.doctor ?? null,
  status: c.status,
  dueAt: c.dueAt,
  escalateAt: c.escalateAt,
  escalatedAt: c.escalatedAt ?? null,
  overdue: c.status === 'OPEN' && c.dueAt < new Date(),
  attempts: c.attempts ?? [],
  doneAt: c.doneAt ?? null,
});

export async function listCalls({ open = true } = {}) {
  const filter = open ? { status: 'OPEN' } : {};
  const rows = await CriticalCall.find(filter).sort({ dueAt: 1 }).limit(200).lean();
  return { items: rows.map(callOut), total: rows.length, page: 1, limit: 200 };
}

/**
 * One call attempt. Reached with read-back closes the call and its critical hold; not reached is
 * logged and the call stays open (escalation to the HOD after the set minutes).
 */
export async function logCall(id, { to, role, reached, readBack, note }) {
  const c = await CriticalCall.findById(id);
  if (!c) throw errors.notFound('Critical call');
  if (c.status !== 'OPEN') throw new AppError(409, 'INVALID_STATE', 'This call is already logged.');
  if (reached && !readBack)
    throw errors.validation([
      { path: 'readBack', message: 'Ask the person to read the value back, then confirm' },
    ]);
  const by = await me();
  const now = new Date();
  return withTransaction(async () => {
    c.attempts.push({ at: now, to, role, reached, readBack, note, by: by.name });
    if (reached) {
      c.status = 'DONE';
      c.doneAt = now;
      const open = await CriticalCall.countDocuments({
        itemId: c.itemId,
        status: 'OPEN',
        _id: { $ne: c._id },
      });
      if (!open) {
        const i = await LabItem.findById(c.itemId);
        const h = i && openHold(i, 'CRITICAL');
        if (h) {
          Object.assign(h, {
            open: false,
            closedAt: now,
            closedBy: by.name,
            note: `${h.note} · told ${to}`,
          });
          await i.save();
        }
      }
    }
    await c.save();
    return callOut(c.toObject());
  });
}

/** Calls not completed by the escalation time go to the HOD (worker, every 5 minutes). */
export async function escalateCalls(now = new Date()) {
  const due = await CriticalCall.find({
    status: 'OPEN',
    escalateAt: { $lt: now },
    escalatedAt: null,
  });
  for (const c of due) {
    c.escalatedAt = now;
    await c.save();
    await publish('lab.critical.escalated', {
      callId: String(c._id),
      patientName: c.patient.name,
      analyte: c.analyte,
      value: c.value,
      location: c.location,
    });
  }
  return due.length;
}

export async function sweepCriticalCalls(now = new Date()) {
  const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } })
    .select('_id')
    .lean();
  let n = 0;
  for (const t of tenants)
    n += await runAsSystem(t._id, () => escalateCalls(now), { userName: 'system: critical calls' });
  return { escalated: n };
}

// ---------------------------------------------------------------- reports for doctors and patients

/** The report for one order: released tests only (doctors never see unreleased values). */
export async function report(orderNo) {
  const items = await LabItem.find({ orderNo, status: { $ne: 'CANCELLED' } })
    .sort({ department: 1, name: 1 })
    .lean();
  if (!items.length) throw errors.notFound('Lab order');
  const tests = new Map(
    (await LabTest.find({ _id: { $in: items.map((i) => i.testId) } }).lean()).map((t) => [
      String(t._id),
      t,
    ]),
  );
  const released = items.filter((i) => i.status === 'RELEASED');
  const trends = await trendsFor(items[0].patient.id, released);
  return {
    orderNo,
    patient: patientOut(items[0].patient),
    doctor: items[0].doctor?.name ?? null,
    location: items[0].location ?? null,
    orderedAt: items[0].orderedAt,
    pending: items
      .filter((i) => i.status !== 'RELEASED')
      .map((i) => ({ code: i.code, name: i.name, status: i.status })),
    tests: released.map((i) => ({
      ...itemOut(i),
      method: tests.get(String(i.testId))?.method ?? null,
      nabl: tests.get(String(i.testId))?.nabl !== false,
      trend: trends.get(i.code) ?? [],
    })),
  };
}

/** Up to five earlier released values of each test, for the trend line on the report. */
async function trendsFor(patientId, items) {
  const out = new Map();
  for (const i of items) {
    const prior = await LabItem.find({
      'patient.id': patientId,
      code: i.code,
      status: 'RELEASED',
      releasedAt: { $lt: i.releasedAt },
    })
      .sort({ releasedAt: -1 })
      .limit(5)
      .lean();
    out.set(
      i.code,
      prior.map((p) => ({
        at: p.releasedAt,
        values: Object.fromEntries((p.results ?? []).map((r) => [r.code, r.value])),
      })),
    );
  }
  return out;
}

/** A patient's tests for the doctor: status for all, values only once released. */
export async function patientResults(patientId, { limit = 100 } = {}) {
  const rows = await LabItem.find({ 'patient.id': patientId, status: { $ne: 'CANCELLED' } })
    .sort({ orderedAt: -1 })
    .limit(limit)
    .lean();
  return {
    items: rows.map((r) => {
      const o = itemOut(r);
      if (r.status !== 'RELEASED') o.results = [];
      o.holds = [];
      return o;
    }),
    total: rows.length,
    page: 1,
    limit,
  };
}
