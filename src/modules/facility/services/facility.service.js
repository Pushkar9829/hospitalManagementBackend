import { z } from 'zod';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { current } from '../../../core/tenancy/context.js';
import {
  Asset,
  FacilitySettings,
  HkRound,
  HkSchedule,
  LaundryBatch,
  LinenCondemnation,
  LinenStock,
  PmRecord,
  PorterRequest,
  Ticket,
  WasteEntry,
  WasteHandover,
} from '../models/facility.models.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const ymd = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const ymdDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const COLOURS = ['yellow', 'red', 'white', 'blue'];

export async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

export async function settingsDoc() {
  return (await FacilitySettings.findOne()) ?? (await FacilitySettings.create([{}]))[0];
}

export async function getSettings() {
  const s = (await settingsDoc()).toObject();
  return {
    linenTypes: s.linenTypes,
    par: s.par,
    ticketTargets: s.ticketTargets,
    amcAlertDays: s.amcAlertDays,
    wasteFacility: s.wasteFacility,
    wasteTolerancePct: s.wasteTolerancePct,
  };
}

export const settingsInput = z.object({
  linenTypes: z
    .array(
      z.object({
        code: z.string().trim().toUpperCase().min(2).max(20),
        name: z.string().trim().min(2).max(60),
      }),
    )
    .max(40)
    .optional(),
  par: z
    .array(
      z.object({
        ward: z.string().trim().min(2).max(60),
        code: z.string().trim().toUpperCase(),
        qty: z.number().int().min(0).max(5000),
      }),
    )
    .max(500)
    .optional(),
  ticketTargets: z
    .object({
      URGENT: z.number().min(0.5).max(720),
      HIGH: z.number().min(0.5).max(720),
      NORMAL: z.number().min(0.5).max(720),
      LOW: z.number().min(0.5).max(720),
    })
    .optional(),
  amcAlertDays: z.number().int().min(7).max(365).optional(),
  wasteFacility: z.string().trim().max(120).optional(),
  wasteTolerancePct: z.number().min(0).max(50).optional(),
});

export async function saveSettings(input) {
  const s = await settingsDoc();
  Object.assign(s, input);
  await s.save();
  return getSettings();
}

// ---------------------------------------------------------------- housekeeping schedules

export const scheduleInput = z.object({
  area: z.string().trim().min(2).max(60),
  kind: z.enum(['WARD', 'TOILET', 'OPD', 'ICU', 'OT', 'COMMON']).default('WARD'),
  times: z
    .array(z.string().regex(/^\d{2}:\d{2}$/))
    .min(1)
    .max(12),
  checklist: z.array(z.string().trim().min(2).max(80)).min(1).max(30),
  assignee: z.string().trim().max(60).optional(),
});

const scheduleOut = (s) => ({
  id: String(s._id),
  area: s.area,
  kind: s.kind,
  times: s.times,
  checklist: s.checklist,
  assignee: s.assignee ?? null,
  active: s.active,
});

export async function createSchedule(input) {
  const [s] = await HkSchedule.create([input]);
  return scheduleOut(s.toObject());
}

export async function listSchedules() {
  const rows = await HkSchedule.find({ active: true }).sort({ area: 1 }).lean();
  return { items: rows.map(scheduleOut) };
}

const roundOut = (r) => ({
  id: String(r._id),
  scheduleId: String(r.scheduleId),
  area: r.area,
  date: r.date,
  time: r.time,
  status: r.status,
  items: r.items,
  doneBy: r.doneBy ?? null,
  doneAt: r.doneAt ?? null,
  verifiedBy: r.verifiedBy ?? null,
  verifiedAt: r.verifiedAt ?? null,
  remarks: r.remarks ?? null,
  overdue:
    r.status === 'DUE' && new Date(`${r.date}T${r.time}:00+05:30`).getTime() + HOUR < Date.now(),
});

/** The day's rounds: created from the active schedules on first look. */
export async function rounds({ date = todayIST() } = {}) {
  const schedules = await HkSchedule.find({ active: true }).lean();
  for (const s of schedules)
    for (const time of s.times)
      if (!(await HkRound.exists({ scheduleId: s._id, date, time })))
        await HkRound.create([
          {
            scheduleId: s._id,
            area: s.area,
            date,
            time,
            items: s.checklist.map((text) => ({ text, ok: false })),
          },
        ]).catch((err) => {
          if (err?.code !== 11000) throw err; // created by a parallel request
        });
  const rows = await HkRound.find({ date }).sort({ time: 1, area: 1 }).lean();
  return { date, items: rows.map(roundOut) };
}

export const roundInput = z.object({
  done: z.array(z.string()).max(30), // checklist items done
  remarks: z.string().trim().max(200).optional(),
});

export async function completeRound(id, { done, remarks }) {
  const r = await HkRound.findById(id);
  if (!r) throw errors.notFound('Round');
  if (r.status !== 'DUE') throw new AppError(409, 'INVALID_STATE', 'Already done.');
  r.items = r.items.map((i) => ({ text: i.text, ok: done.includes(i.text) }));
  r.status = 'DONE';
  r.doneBy = await userName();
  r.doneAt = new Date();
  r.remarks = remarks;
  await r.save();
  return roundOut(r.toObject());
}

/** The supervisor signs off; the person who cleaned cannot verify their own round. */
export async function verifyRound(id) {
  const r = await HkRound.findById(id);
  if (!r) throw errors.notFound('Round');
  if (r.status !== 'DONE') throw new AppError(409, 'INVALID_STATE', 'Mark the round done first.');
  const by = await userName();
  if (by === r.doneBy)
    throw new AppError(409, 'MAKER_CANNOT_CHECK', 'Someone else verifies the round.');
  r.status = 'VERIFIED';
  r.verifiedBy = by;
  r.verifiedAt = new Date();
  await r.save();
  return roundOut(r.toObject());
}

// ---------------------------------------------------------------- linen and laundry

async function addStock(ward, code, delta) {
  const row = await LinenStock.findOne({ ward, code });
  if (row) {
    row.qty += delta;
    await row.save();
  } else await LinenStock.create([{ ward, code, qty: delta }]);
}

/** Linen in each ward against its par level. */
export async function linenBoard() {
  const s = await settingsDoc();
  const stock = await LinenStock.find({}).lean();
  const wards = [...new Set([...s.par.map((p) => p.ward), ...stock.map((x) => x.ward)])].sort();
  const inLaundry = await LaundryBatch.find({ status: 'SENT' }).lean();
  return {
    types: s.linenTypes,
    items: wards.map((ward) => ({
      ward,
      lines: s.linenTypes.map((t) => {
        const qty = stock.find((x) => x.ward === ward && x.code === t.code)?.qty ?? 0;
        const par = s.par.find((p) => p.ward === ward && p.code === t.code)?.qty ?? 0;
        const away = inLaundry
          .filter((b) => b.ward === ward)
          .reduce((n, b) => n + (b.lines.find((l) => l.code === t.code)?.sent ?? 0), 0);
        return {
          code: t.code,
          name: t.name,
          qty,
          par,
          inLaundry: away,
          short: Math.max(0, par - qty),
        };
      }),
    })),
  };
}

const linesInput = z
  .array(
    z.object({
      code: z.string().trim().toUpperCase(),
      qty: z.number().int().min(1).max(5000),
    }),
  )
  .min(1)
  .max(40);

export const issueInput = z.object({ ward: z.string().trim().min(2).max(60), lines: linesInput });

/** New or replacement linen issued to a ward from the store. */
export async function issueLinen({ ward, lines }) {
  await assertCodes(lines);
  for (const l of lines) await addStock(ward, l.code, l.qty);
  return linenBoard();
}

async function assertCodes(lines) {
  const s = await settingsDoc();
  const bad = lines.find((l) => !s.linenTypes.some((t) => t.code === l.code));
  if (bad) throw errors.validation([{ path: 'lines', message: `Unknown linen ${bad.code}` }]);
}

const batchOut = (b) => ({
  id: String(b._id),
  batchNo: b.batchNo,
  ward: b.ward,
  laundry: b.laundry,
  lines: b.lines,
  status: b.status,
  sentAt: b.sentAt,
  sentBy: b.sentBy ?? null,
  receivedAt: b.receivedAt ?? null,
  shortage: b.shortage,
});

export const laundryInput = issueInput.extend({
  laundry: z.string().trim().max(60).optional(),
});

/** Soiled linen counted out of a ward to the laundry. */
export async function sendLaundry({ ward, lines, laundry }) {
  await assertCodes(lines);
  return withTransaction(async () => {
    for (const l of lines) await addStock(ward, l.code, -l.qty);
    const [b] = await LaundryBatch.create([
      {
        batchNo: await documentNumber('LDY'),
        ward,
        laundry,
        lines: lines.map((l) => ({ code: l.code, sent: l.qty })),
        sentBy: await userName(),
      },
    ]);
    return batchOut(b.toObject());
  });
}

export const receiveInput = z.object({
  lines: z
    .array(z.object({ code: z.string().trim().toUpperCase(), qty: z.number().int().min(0) }))
    .min(1),
});

/** Clean linen counted back; anything short is recorded against the batch. */
export async function receiveLaundry(id, { lines }) {
  const b = await LaundryBatch.findById(id);
  if (!b) throw errors.notFound('Laundry batch');
  if (b.status !== 'SENT') throw new AppError(409, 'INVALID_STATE', 'Already received.');
  return withTransaction(async () => {
    let shortage = 0;
    b.lines = b.lines.map((l) => {
      const got = Math.min(lines.find((x) => x.code === l.code)?.qty ?? 0, l.sent);
      shortage += l.sent - got;
      return { code: l.code, sent: l.sent, received: got };
    });
    for (const l of b.lines) if (l.received) await addStock(b.ward, l.code, l.received);
    b.status = 'RECEIVED';
    b.receivedAt = new Date();
    b.receivedBy = await userName();
    b.shortage = shortage;
    await b.save();
    return batchOut(b.toObject());
  });
}

export async function listLaundry({ status } = {}) {
  const rows = await LaundryBatch.find(status ? { status } : {})
    .sort({ sentAt: -1 })
    .limit(200)
    .lean();
  return { items: rows.map(batchOut) };
}

export const condemnInput = z.object({
  ward: z.string().trim().min(2).max(60),
  code: z.string().trim().toUpperCase(),
  qty: z.number().int().min(1).max(1000),
  reason: z.string().trim().min(3).max(200),
});

/** Damaged linen to write off; the Hospital Admin approves (facility.condemnation). */
export async function condemn(input, res) {
  await assertCodes([{ code: input.code, qty: input.qty }]);
  return withTransaction(async () => {
    const [c] = await LinenCondemnation.create([{ ...input, requestedBy: await userName() }]);
    const approval = await requestApproval({
      action: 'facility.condemnation',
      module: 'FAC',
      entity: 'LinenCondemnation',
      entityId: c._id,
      title: `Condemn ${input.qty} ${input.code.toLowerCase()} · ${input.ward}`,
      before: {},
      after: { qty: input.qty },
      payload: { condemnationId: String(c._id) },
      metrics: {},
      reason: input.reason,
    });
    if (approval) {
      c.approvalId = approval._id;
      if (res) res.locals.status = 202;
    } else {
      c.status = 'APPROVED';
      await addStock(input.ward, input.code, -input.qty);
    }
    await c.save();
    return {
      id: String(c._id),
      ...input,
      status: c.status,
      approvalId: c.approvalId ? String(c.approvalId) : null,
    };
  });
}

onApprovalDecided('facility.condemnation', async (req, outcome) => {
  const c = await LinenCondemnation.findById(req.payload.condemnationId);
  if (!c || c.status !== 'PENDING_APPROVAL') return;
  c.status = outcome === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  if (c.status === 'APPROVED') await addStock(c.ward, c.code, -c.qty);
  await c.save();
});

// ---------------------------------------------------------------- porters

export const porterInput = z.object({
  patient: z
    .object({
      id: z.string().optional(),
      uhid: z.string().optional(),
      name: z.string().trim().max(80),
    })
    .optional(),
  from: z.string().trim().min(2).max(60),
  to: z.string().trim().min(2).max(60),
  mode: z.enum(['WHEELCHAIR', 'STRETCHER', 'BED', 'WALK']).default('WHEELCHAIR'),
  priority: z.enum(['ROUTINE', 'URGENT']).default('ROUTINE'),
  notes: z.string().trim().max(200).optional(),
});

const porterOut = (p) => ({
  id: String(p._id),
  requestNo: p.requestNo,
  patient: p.patient?.name ?? null,
  uhid: p.patient?.uhid ?? null,
  from: p.from,
  to: p.to,
  mode: p.mode,
  priority: p.priority,
  notes: p.notes ?? null,
  status: p.status,
  porter: p.porter ?? null,
  requestedBy: p.requestedBy ?? null,
  requestedAt: p.requestedAt,
  pickedAt: p.pickedAt ?? null,
  doneAt: p.doneAt ?? null,
  waitMin: Math.round(((p.pickedAt ?? new Date()) - p.requestedAt) / 60000),
});

export async function requestPorter(input) {
  const [p] = await PorterRequest.create([
    { ...input, requestNo: await documentNumber('PT'), requestedBy: await userName() },
  ]);
  return porterOut(p.toObject());
}

export async function porters({ status = 'REQUESTED,ASSIGNED,PICKED' } = {}) {
  const rows = await PorterRequest.find({ status: { $in: status.split(',') } })
    .sort({ priority: -1, requestedAt: 1 })
    .limit(200)
    .lean();
  return { items: rows.map(porterOut) };
}

const PORTER_FLOW = {
  ASSIGN: ['REQUESTED', 'ASSIGNED'],
  PICK: ['ASSIGNED', 'PICKED'],
  DONE: ['PICKED', 'DONE'],
};

export async function movePorter(id, { action, porter }) {
  const p = await PorterRequest.findById(id);
  if (!p) throw errors.notFound('Transport request');
  if (action === 'CANCEL') {
    if (['DONE', 'CANCELLED'].includes(p.status))
      throw new AppError(409, 'INVALID_STATE', 'The move is finished.');
    p.status = 'CANCELLED';
  } else {
    const [fromStatus, toStatus] = PORTER_FLOW[action];
    if (p.status !== fromStatus)
      throw new AppError(409, 'INVALID_STATE', `The request is ${p.status.toLowerCase()}.`);
    if (action === 'ASSIGN') {
      if (!porter) throw errors.validation([{ path: 'porter', message: 'Who is going?' }]);
      p.porter = porter;
      p.assignedAt = new Date();
    }
    if (action === 'PICK') p.pickedAt = new Date();
    if (action === 'DONE') p.doneAt = new Date();
    p.status = toStatus;
  }
  await p.save();
  return porterOut(p.toObject());
}

// ---------------------------------------------------------------- equipment

export const assetInput = z.object({
  code: z.string().trim().toUpperCase().min(2).max(20),
  name: z.string().trim().min(2).max(80),
  category: z.enum(['BIOMEDICAL', 'ELECTRICAL', 'HVAC', 'IT', 'FURNITURE', 'OTHER']),
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  serialNo: z.string().trim().max(60).optional(),
  location: z.string().trim().min(2).max(60),
  department: z.string().trim().max(60).optional(),
  vendor: z.string().trim().max(80).optional(),
  purchasedOn: ymdDate.optional(),
  cost: z.number().int().min(0).optional(),
  warrantyUntil: ymdDate.optional(),
  riskClass: z.enum(['A', 'B', 'C']).default('B'),
  pmEveryDays: z.number().int().min(7).max(1095).optional(),
  calibrationEveryDays: z.number().int().min(7).max(1095).optional(),
  amc: z
    .object({
      vendor: z.string().trim().min(2).max(80),
      kind: z.enum(['AMC', 'CMC']),
      from: ymdDate,
      until: ymdDate,
      cost: z.number().int().min(0).optional(),
      phone: z.string().trim().max(20).optional(),
    })
    .optional(),
});

const dateOf = (s) => (s ? new Date(`${s}T00:00:00+05:30`) : undefined);

export const assetOut = (a, now = Date.now()) => ({
  id: String(a._id),
  code: a.code,
  name: a.name,
  category: a.category,
  make: a.make ?? null,
  model: a.model ?? null,
  serialNo: a.serialNo ?? null,
  location: a.location ?? null,
  department: a.department ?? null,
  vendor: a.vendor ?? null,
  warrantyUntil: a.warrantyUntil ? ymd(a.warrantyUntil) : null,
  riskClass: a.riskClass,
  status: a.status,
  outSince: a.outSince ?? null,
  pmEveryDays: a.pmEveryDays ?? null,
  nextPmDue: a.nextPmDue ? ymd(a.nextPmDue) : null,
  pmOverdue: Boolean(a.nextPmDue && a.nextPmDue.getTime() < now),
  calibrationEveryDays: a.calibrationEveryDays ?? null,
  nextCalibrationDue: a.nextCalibrationDue ? ymd(a.nextCalibrationDue) : null,
  calibrationOverdue: Boolean(a.nextCalibrationDue && a.nextCalibrationDue.getTime() < now),
  amc: a.amc?.until
    ? {
        ...a.amc,
        from: ymd(a.amc.from),
        until: ymd(a.amc.until),
        daysLeft: Math.ceil((a.amc.until.getTime() - now) / DAY),
      }
    : null,
  downtimeMin: a.downtimeMin ?? 0,
  history: a.history ?? [],
});

export async function createAsset(input) {
  if (await Asset.exists({ code: input.code }))
    throw new AppError(409, 'DUPLICATE', `Asset ${input.code} exists.`);
  const now = Date.now();
  const [a] = await Asset.create([
    {
      ...input,
      purchasedOn: dateOf(input.purchasedOn),
      warrantyUntil: dateOf(input.warrantyUntil),
      amc: input.amc
        ? { ...input.amc, from: dateOf(input.amc.from), until: dateOf(input.amc.until) }
        : undefined,
      nextPmDue: input.pmEveryDays ? new Date(now + input.pmEveryDays * DAY) : undefined,
      nextCalibrationDue: input.calibrationEveryDays
        ? new Date(now + input.calibrationEveryDays * DAY)
        : undefined,
      history: [
        { at: new Date(), kind: 'ADDED', text: 'Added to the register', by: await userName() },
      ],
    },
  ]);
  return assetOut(a.toObject());
}

export async function listAssets({ q, status, category } = {}) {
  const filter = {};
  if (status) filter.status = { $in: status.split(',') };
  if (category) filter.category = category;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { serialNo: rx }, { location: rx }];
  }
  const rows = await Asset.find(filter).sort({ code: 1 }).limit(500).lean();
  return { items: rows.map((a) => assetOut(a)) };
}

export async function getAsset(id) {
  const a = await Asset.findById(id).lean();
  if (!a) throw errors.notFound('Asset');
  const pm = await PmRecord.find({ assetId: id }).sort({ doneAt: -1 }).limit(20).lean();
  const tickets = await Ticket.find({ assetId: id }).sort({ createdAt: -1 }).limit(20).lean();
  return {
    ...assetOut(a),
    pm: pm.map((p) => ({
      id: String(p._id),
      kind: p.kind,
      doneAt: p.doneAt,
      doneBy: p.doneBy,
      passed: p.passed,
      notes: p.notes ?? null,
      nextDue: p.nextDue ?? null,
      certificateFileId: p.certificateFileId ? String(p.certificateFileId) : null,
    })),
    tickets: tickets.map(ticketOut),
  };
}

/** PM and calibration due (or overdue) in the next days, and AMC/CMC ending soon. */
export async function dueList({ days = 30 } = {}) {
  const s = await settingsDoc();
  const until = new Date(Date.now() + days * DAY);
  const amcUntil = new Date(Date.now() + s.amcAlertDays * DAY);
  const [pm, cal, amc] = await Promise.all([
    Asset.find({ status: { $ne: 'CONDEMNED' }, nextPmDue: { $lte: until } })
      .sort({ nextPmDue: 1 })
      .lean(),
    Asset.find({ status: { $ne: 'CONDEMNED' }, nextCalibrationDue: { $lte: until } })
      .sort({ nextCalibrationDue: 1 })
      .lean(),
    Asset.find({ status: { $ne: 'CONDEMNED' }, 'amc.until': { $lte: amcUntil } })
      .sort({ 'amc.until': 1 })
      .lean(),
  ]);
  return {
    pm: pm.map((a) => assetOut(a)),
    calibration: cal.map((a) => assetOut(a)),
    amc: amc.map((a) => assetOut(a)),
  };
}

export const pmInput = z.object({
  kind: z.enum(['PM', 'CALIBRATION']),
  doneOn: ymdDate.optional(),
  passed: z.boolean().default(true),
  vendorVisit: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
  certificateFileId: z.string().optional(),
});

/** Records PM or calibration; the next due date moves on. A failed check takes it out of service. */
export async function recordPm(id, input) {
  const a = await Asset.findById(id);
  if (!a) throw errors.notFound('Asset');
  const every = input.kind === 'PM' ? a.pmEveryDays : a.calibrationEveryDays;
  if (!every)
    throw errors.validation([{ path: 'kind', message: `No ${input.kind.toLowerCase()} schedule` }]);
  const done = input.doneOn ? dateOf(input.doneOn) : new Date();
  const next = new Date(done.getTime() + every * DAY);
  const by = await userName();
  return withTransaction(async () => {
    await PmRecord.create([{ assetId: a._id, ...input, doneAt: done, doneBy: by, nextDue: next }]);
    if (input.kind === 'PM') a.nextPmDue = next;
    else a.nextCalibrationDue = next;
    a.history.push({
      at: new Date(),
      kind: input.kind,
      text: input.passed ? `${input.kind} done` : `${input.kind} failed: ${input.notes ?? ''}`,
      by,
    });
    if (!input.passed && a.status === 'IN_SERVICE') {
      a.status = 'OUT_OF_SERVICE';
      a.outSince = new Date();
      await publish('facility.asset.status', {
        assetId: String(a._id),
        code: a.code,
        status: a.status,
        location: a.location,
      });
    }
    await a.save();
    return assetOut(a.toObject());
  });
}

async function setAssetStatus(a, status, by, text) {
  const now = new Date();
  if (status === 'IN_SERVICE' && a.outSince) {
    a.downtimeMin = (a.downtimeMin ?? 0) + Math.round((now - a.outSince) / 60000);
    a.outSince = undefined;
  }
  if (status === 'OUT_OF_SERVICE' && a.status !== 'OUT_OF_SERVICE') a.outSince = now;
  a.status = status;
  a.history.push({ at: now, kind: status, text, by });
  await a.save();
  await publish('facility.asset.status', {
    assetId: String(a._id),
    code: a.code,
    status,
    location: a.location,
  });
}

export async function changeAssetStatus(id, { status, reason }) {
  const a = await Asset.findById(id);
  if (!a) throw errors.notFound('Asset');
  if (a.status === 'CONDEMNED') throw new AppError(409, 'INVALID_STATE', 'The asset is condemned.');
  await setAssetStatus(a, status, await userName(), reason);
  return assetOut(a.toObject());
}

// ---------------------------------------------------------------- tickets

export const ticketInput = z.object({
  category: z.enum([
    'ELECTRICAL',
    'PLUMBING',
    'AC',
    'CIVIL',
    'IT',
    'BIOMEDICAL',
    'CARPENTRY',
    'OTHER',
  ]),
  priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).default('NORMAL'),
  location: z.string().trim().min(2).max(80),
  description: z.string().trim().min(5).max(1000),
  assetId: z.string().optional(),
  breakdown: z.boolean().default(false),
  photoFileId: z.string().optional(),
});

export function ticketOut(t) {
  const now = Date.now();
  return {
    id: String(t._id),
    ticketNo: t.ticketNo,
    category: t.category,
    priority: t.priority,
    location: t.location,
    description: t.description,
    assetId: t.assetId ? String(t.assetId) : null,
    assetName: t.assetName ?? null,
    breakdown: t.breakdown,
    photoFileId: t.photoFileId ? String(t.photoFileId) : null,
    raisedBy: t.raisedBy?.name ?? null,
    assignee: t.assignee ?? null,
    status: t.status,
    createdAt: t.createdAt,
    dueAt: t.dueAt ?? null,
    overdue: Boolean(
      t.dueAt && !['RESOLVED', 'CLOSED'].includes(t.status) && t.dueAt.getTime() < now,
    ),
    resolution: t.resolution ?? null,
    resolvedAt: t.resolvedAt ?? null,
    closedAt: t.closedAt ?? null,
    downtimeMin: t.downtimeMin ?? null,
    log: t.log ?? [],
    version: t.version,
  };
}

/**
 * Any user raises a ticket. Biomedical breakdowns go high priority by default and take the
 * equipment out of service so it is not scheduled.
 */
export async function raiseTicket(input) {
  const s = await settingsDoc();
  const c = current();
  const by = await userName();
  let asset = null;
  if (input.assetId) {
    asset = await Asset.findById(input.assetId);
    if (!asset) throw errors.notFound('Asset');
  }
  const priority =
    input.breakdown && asset?.riskClass === 'A' && ['NORMAL', 'LOW'].includes(input.priority)
      ? 'URGENT'
      : input.breakdown && ['NORMAL', 'LOW'].includes(input.priority)
        ? 'HIGH'
        : input.priority;
  return withTransaction(async () => {
    const [t] = await Ticket.create([
      {
        ...input,
        priority,
        assetName: asset?.name,
        ticketNo: await documentNumber('TKT'),
        raisedBy: { userId: c.userId, name: by },
        dueAt: new Date(Date.now() + s.ticketTargets[priority] * HOUR),
        log: [{ at: new Date(), status: 'OPEN', by }],
      },
    ]);
    if (asset && input.breakdown && asset.status === 'IN_SERVICE')
      await setAssetStatus(asset, 'OUT_OF_SERVICE', by, `Breakdown ${t.ticketNo}`);
    await publish('facility.ticket.raised', {
      ticketId: String(t._id),
      ticketNo: t.ticketNo,
      category: t.category,
      priority,
    });
    return ticketOut(t.toObject());
  });
}

export async function listTickets({ status, mine, category } = {}) {
  const filter = {};
  if (status) filter.status = { $in: status.split(',') };
  if (category) filter.category = category;
  if (mine) filter['raisedBy.userId'] = current().userId;
  const order = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  const rows = await Ticket.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  rows.sort((a, b) => order[a.priority] - order[b.priority]);
  return { items: rows.map(ticketOut) };
}

const FLOW = {
  ASSIGN: { from: ['OPEN', 'REOPENED', 'ASSIGNED'], to: 'ASSIGNED' },
  START: { from: ['ASSIGNED'], to: 'IN_PROGRESS' },
  RESOLVE: { from: ['ASSIGNED', 'IN_PROGRESS'], to: 'RESOLVED' },
  CONFIRM: { from: ['RESOLVED'], to: 'CLOSED' },
  REOPEN: { from: ['RESOLVED'], to: 'REOPENED' },
};

export const ticketActionInput = z.object({
  action: z.enum(['ASSIGN', 'START', 'RESOLVE', 'CONFIRM', 'REOPEN']),
  assignee: z.string().trim().max(60).optional(),
  note: z.string().trim().max(500).optional(),
  backInService: z.boolean().default(true),
});

/**
 * Moves a ticket on. Only the person who raised it (or facility staff) confirms closure; a
 * resolved breakdown returns the equipment to service and records the downtime.
 */
export async function ticketAction(id, input, { canManage }) {
  const t = await Ticket.findById(id);
  if (!t) throw errors.notFound('Ticket');
  const step = FLOW[input.action];
  if (!step.from.includes(t.status))
    throw new AppError(
      409,
      'INVALID_STATE',
      `The ticket is ${t.status.toLowerCase().replace('_', ' ')}.`,
    );
  const c = current();
  const mineTicket = String(t.raisedBy?.userId) === String(c.userId);
  if (['CONFIRM', 'REOPEN'].includes(input.action) ? !mineTicket && !canManage : !canManage)
    throw new AppError(403, 'FORBIDDEN', 'Only the facility team or the requester can do this.');
  const by = await userName();
  return withTransaction(async () => {
    if (input.action === 'ASSIGN') {
      if (!input.assignee)
        throw errors.validation([{ path: 'assignee', message: 'Assign to whom?' }]);
      t.assignee = input.assignee;
    }
    if (input.action === 'RESOLVE') {
      if (!input.note) throw errors.validation([{ path: 'note', message: 'What was done?' }]);
      t.resolution = input.note;
      t.resolvedAt = new Date();
      if (t.assetId && t.breakdown) {
        const a = await Asset.findById(t.assetId);
        if (a?.status === 'OUT_OF_SERVICE' && input.backInService) {
          const out = a.outSince;
          await setAssetStatus(a, 'IN_SERVICE', by, `Repaired ${t.ticketNo}`);
          t.downtimeMin = out ? Math.round((Date.now() - out) / 60000) : 0;
        }
      }
    }
    if (input.action === 'CONFIRM') t.closedAt = new Date();
    t.status = step.to;
    t.log.push({ at: new Date(), status: step.to, by, note: input.note ?? input.assignee });
    await t.save();
    return ticketOut(t.toObject());
  });
}

// ---------------------------------------------------------------- biomedical waste

export const wasteInput = z.object({
  date: ymdDate.optional(),
  ward: z.string().trim().min(2).max(60),
  yellow: z.number().min(0).max(1000),
  red: z.number().min(0).max(1000),
  white: z.number().min(0).max(1000),
  blue: z.number().min(0).max(1000),
});

export async function recordWaste(input) {
  const date = input.date ?? todayIST();
  const by = await userName();
  const row = await WasteEntry.findOne({ date, ward: input.ward });
  if (row) {
    for (const k of COLOURS) row[k] = input[k];
    row.enteredBy = by;
    await row.save();
  } else await WasteEntry.create([{ ...input, date, enteredBy: by }]);
  return wasteDay({ date });
}

const sumColours = (rows) =>
  Object.fromEntries(
    COLOURS.map((k) => [k, Math.round(rows.reduce((t, r) => t + (r[k] ?? 0), 0) * 100) / 100]),
  );

export async function wasteDay({ date = todayIST() } = {}) {
  const [rows, handovers] = await Promise.all([
    WasteEntry.find({ date }).sort({ ward: 1 }).lean(),
    WasteHandover.find({ date }).lean(),
  ]);
  return {
    date,
    items: rows.map((r) => ({
      id: String(r._id),
      ward: r.ward,
      ...Object.fromEntries(COLOURS.map((k) => [k, r[k]])),
      enteredBy: r.enteredBy,
    })),
    total: sumColours(rows),
    handovers: handovers.map((h) => ({
      id: String(h._id),
      manifestNo: h.manifestNo,
      vehicle: h.vehicle ?? null,
      facility: h.facility ?? null,
      weights: h.weights,
      recorded: h.recorded,
      mismatch: h.mismatch,
      by: h.by,
    })),
  };
}

export const handoverInput = z.object({
  date: ymdDate.optional(),
  manifestNo: z.string().trim().min(3).max(40),
  vehicle: z.string().trim().max(20).optional(),
  weights: z.object({
    yellow: z.number().min(0),
    red: z.number().min(0),
    white: z.number().min(0),
    blue: z.number().min(0),
  }),
});

/** Handover to the CBWTF; weights more than the tolerance away from the wards' total are flagged. */
export async function handoverWaste(input) {
  const s = await settingsDoc();
  const date = input.date ?? todayIST();
  const recorded = sumColours(await WasteEntry.find({ date }).lean());
  const mismatch = COLOURS.some((k) => {
    const r = recorded[k];
    const w = input.weights[k];
    if (!r && !w) return false;
    return Math.abs(w - r) > (Math.max(r, w) * s.wasteTolerancePct) / 100;
  });
  const [h] = await WasteHandover.create([
    { ...input, date, facility: s.wasteFacility, recorded, mismatch, by: await userName() },
  ]);
  if (mismatch)
    await publish('facility.waste.mismatch', {
      handoverId: String(h._id),
      manifestNo: h.manifestNo,
      date,
    });
  return wasteDay({ date });
}

/** Monthly report by ward and colour (the format the Pollution Control Board asks for). */
export async function wasteMonth({ month }) {
  const rows = await WasteEntry.find({ date: { $gte: `${month}-01`, $lte: `${month}-31` } }).lean();
  const wards = [...new Set(rows.map((r) => r.ward))].sort();
  const handovers = await WasteHandover.find({
    date: { $gte: `${month}-01`, $lte: `${month}-31` },
  }).lean();
  return {
    month,
    byWard: wards.map((w) => ({ ward: w, ...sumColours(rows.filter((r) => r.ward === w)) })),
    total: sumColours(rows),
    days: new Set(rows.map((r) => r.date)).size,
    handovers: handovers.length,
    mismatches: handovers.filter((h) => h.mismatch).length,
  };
}
