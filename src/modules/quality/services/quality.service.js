import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { sendSms } from '../../../core/notify/notify.service.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { current, runInContext } from '../../../core/tenancy/context.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { Admission } from '../../ipd/index.js';
import { CriticalCall, LabItem } from '../../lab/index.js';
import { OpdVisit } from '../../opd/index.js';
import { Patient, patientCard } from '../../patients/index.js';
import { Bed } from '../../setup/index.js';
import {
  AuditTemplate,
  Complaint,
  DeviceDays,
  Feedback,
  HaiCase,
  Incident,
  QualityAudit,
  QualityDocument,
  QualitySettings,
} from '../models/quality.models.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const ymdDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

export async function settingsDoc() {
  return (await QualitySettings.findOne()) ?? (await QualitySettings.create([{}]))[0];
}

export async function getSettings() {
  const s = (await settingsDoc()).toObject();
  return {
    targets: { ...DEFAULT_TARGETS, ...(s.targets ?? {}) },
    complaintTatHours: s.complaintTatHours,
    feedbackOpd: s.feedbackOpd,
    feedbackIpd: s.feedbackIpd,
    reviewLink: s.reviewLink ?? null,
  };
}

export const settingsInput = z.object({
  targets: z.record(z.string(), z.number()).optional(),
  complaintTatHours: z
    .object({ HIGH: z.number().min(1), NORMAL: z.number().min(1), LOW: z.number().min(1) })
    .optional(),
  feedbackOpd: z.boolean().optional(),
  feedbackIpd: z.boolean().optional(),
  reviewLink: z.url().optional(),
});

export async function saveSettings(input) {
  const s = await settingsDoc();
  if (input.targets) {
    s.targets = { ...(s.targets ?? {}), ...input.targets };
    s.markModified('targets');
  }
  for (const k of ['complaintTatHours', 'feedbackOpd', 'feedbackIpd', 'reviewLink'])
    if (input[k] !== undefined) s[k] = input[k];
  await s.save();
  return getSettings();
}

const snap = (p) =>
  p ? { id: p.id ?? p._id, uhid: p.uhid, name: p.name, mobile: p.mobile } : undefined;

// ---------------------------------------------------------------- feedback

async function webUrl() {
  const t = await Tenant.findById(current().tenantId).select('subdomain name').lean();
  return { url: env.WEB_URL_TEMPLATE.replace('{subdomain}', t.subdomain), name: t.name };
}

/** Invites the patient to rate the visit or stay (SMS with a one-time link valid 14 days). */
async function invite({ source, refId, patient, department }) {
  if (await Feedback.exists({ source, refId })) return null;
  const token = randomBytes(16).toString('hex');
  const [f] = await Feedback.create([
    {
      token,
      source,
      refId,
      patient: snap(patient),
      department,
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 14 * DAY),
    },
  ]);
  if (patient?.mobile) {
    const { url, name } = await webUrl();
    await sendSms({
      to: patient.mobile,
      template: 'FEEDBACK_REQUEST',
      vars: { hospital: name, link: `${url}/feedback/${token}` },
    });
  }
  return f;
}

/** opd.visit.closed: feedback after the OPD visit. */
export async function onVisitClosed({ visitId }) {
  const s = await settingsDoc();
  if (!s.feedbackOpd) return null;
  const v = await OpdVisit.findById(visitId).lean();
  if (!v) return null;
  return invite({
    source: 'OPD',
    refId: String(v._id),
    patient: v.patient,
    department: v.doctor?.department ?? v.department,
  });
}

/** ipd.discharged: feedback at discharge (not after a death). */
export async function onDischarged({ admissionId, outcome }) {
  const s = await settingsDoc();
  if (!s.feedbackIpd || outcome === 'DEATH') return null;
  const a = await Admission.findById(admissionId).lean();
  if (!a) return null;
  return invite({
    source: 'IPD',
    refId: String(a._id),
    patient: a.patient,
    department: a.consultant?.department ?? a.bed?.ward,
  });
}

async function openFeedback(token) {
  const f = await Feedback.findOne({ token });
  if (!f || (f.expiresAt && f.expiresAt < new Date()))
    throw new AppError(404, 'NOT_FOUND', 'This feedback link is not valid any more.');
  return f;
}

/** Public: what the feedback page shows before answering. */
export async function feedbackForm(token) {
  const f = await openFeedback(token);
  const { name } = await webUrl();
  return {
    hospital: name,
    patient: f.patient?.name?.split(' ')[0] ?? null,
    source: f.source,
    department: f.department ?? null,
    answered: Boolean(f.respondedAt),
  };
}

const rating = z.number().int().min(1).max(5);
export const feedbackInput = z.object({
  overall: rating,
  doctor: rating.optional(),
  nursing: rating.optional(),
  cleanliness: rating.optional(),
  billing: rating.optional(),
  food: rating.optional(),
  nps: z.number().int().min(0).max(10),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * Public: the patient's answers. A poor score with a comment becomes a complaint; a promoter is
 * offered the hospital's public review link.
 */
export async function submitFeedback(token, input) {
  const f = await openFeedback(token);
  if (f.respondedAt)
    throw new AppError(409, 'ALREADY_ANSWERED', 'Thank you, we have your feedback.');
  const { nps, comment, ...ratings } = input;
  f.ratings = ratings;
  f.nps = nps;
  f.comment = comment;
  f.respondedAt = new Date();
  await f.save();
  if (comment && (ratings.overall <= 2 || nps <= 4)) {
    const c = await createComplaint(
      {
        source: 'FEEDBACK',
        category: 'OTHER',
        department: f.department,
        priority: ratings.overall === 1 ? 'HIGH' : 'NORMAL',
        description: comment,
        patientId: f.patient?.id ? String(f.patient.id) : undefined,
        contactName: f.patient?.name,
        contactMobile: f.patient?.mobile,
      },
      { feedbackId: f._id },
    );
    f.complaintId = c.id;
    await f.save();
  }
  const s = await settingsDoc();
  return { thanks: true, review: nps >= 9 && s.reviewLink ? s.reviewLink : null };
}

/** Feedback for a period: averages by department and the Net Promoter Score. */
export async function feedbackSummary({ from, to }) {
  const rows = await Feedback.find({
    respondedAt: {
      $gte: new Date(`${from}T00:00:00+05:30`),
      $lte: new Date(`${to}T23:59:59+05:30`),
    },
  }).lean();
  const sent = await Feedback.countDocuments({
    sentAt: { $gte: new Date(`${from}T00:00:00+05:30`), $lte: new Date(`${to}T23:59:59+05:30`) },
  });
  const avg = (xs) =>
    xs.length ? Math.round((xs.reduce((t, x) => t + x, 0) / xs.length) * 10) / 10 : null;
  const npsOf = (rs) => {
    const n = rs.filter((r) => r.nps != null);
    if (!n.length) return null;
    const pro = n.filter((r) => r.nps >= 9).length;
    const det = n.filter((r) => r.nps <= 6).length;
    return Math.round(((pro - det) * 100) / n.length);
  };
  const departments = [...new Set(rows.map((r) => r.department ?? '—'))].sort();
  const KEYS = ['overall', 'doctor', 'nursing', 'cleanliness', 'billing', 'food'];
  return {
    from,
    to,
    sent,
    responses: rows.length,
    responseRate: sent ? Math.round((rows.length * 100) / sent) : 0,
    nps: npsOf(rows),
    averages: Object.fromEntries(
      KEYS.map((k) => [k, avg(rows.map((r) => r.ratings?.[k]).filter((x) => x != null))]),
    ),
    byDepartment: departments.map((d) => {
      const rs = rows.filter((r) => (r.department ?? '—') === d);
      return {
        department: d,
        responses: rs.length,
        overall: avg(rs.map((r) => r.ratings.overall)),
        nps: npsOf(rs),
      };
    }),
    comments: rows
      .filter((r) => r.comment)
      .sort((a, b) => b.respondedAt - a.respondedAt)
      .slice(0, 50)
      .map((r) => ({
        at: r.respondedAt,
        department: r.department ?? null,
        overall: r.ratings.overall,
        nps: r.nps,
        comment: r.comment,
        complaintId: r.complaintId ? String(r.complaintId) : null,
      })),
  };
}

// ---------------------------------------------------------------- complaints

export const complaintInput = z.object({
  source: z.enum(['FEEDBACK', 'FRONT_OFFICE', 'PHONE', 'EMAIL', 'PORTAL', 'WRITTEN']),
  patientId: z.string().optional(),
  contactName: z.string().trim().max(80).optional(),
  contactMobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/)
    .optional(),
  category: z.enum([
    'BILLING',
    'CLINICAL',
    'NURSING',
    'FACILITY',
    'FOOD',
    'STAFF_BEHAVIOUR',
    'WAITING',
    'OTHER',
  ]),
  department: z.string().trim().max(60).optional(),
  priority: z.enum(['HIGH', 'NORMAL', 'LOW']).default('NORMAL'),
  description: z.string().trim().min(5).max(2000),
  owner: z.string().trim().max(80).optional(),
});

const complaintOut = (c) => ({
  id: String(c._id),
  complaintNo: c.complaintNo,
  source: c.source,
  patient: c.patient?.name ?? c.contactName ?? null,
  uhid: c.patient?.uhid ?? null,
  mobile: c.contactMobile ?? c.patient?.mobile ?? null,
  category: c.category,
  department: c.department ?? null,
  priority: c.priority,
  description: c.description,
  owner: c.owner ?? null,
  status: c.status,
  createdAt: c.createdAt,
  dueAt: c.dueAt,
  overdue: !['RESOLVED', 'CLOSED'].includes(c.status) && c.dueAt < new Date(),
  escalatedAt: c.escalatedAt ?? null,
  resolution: c.resolution ?? null,
  closedAt: c.closedAt ?? null,
  messageSentAt: c.messageSentAt ?? null,
  log: c.log ?? [],
});

export async function createComplaint(input, extra = {}) {
  const s = await settingsDoc();
  const p = input.patientId ? await Patient.findById(input.patientId).lean() : null;
  const by = await userName();
  const [c] = await Complaint.create([
    {
      ...input,
      ...extra,
      complaintNo: await documentNumber('CMP'),
      patient: p ? snap(patientCard(p)) : undefined,
      contactMobile: input.contactMobile ?? p?.mobile,
      dueAt: new Date(Date.now() + s.complaintTatHours[input.priority ?? 'NORMAL'] * HOUR),
      log: [{ at: new Date(), status: 'OPEN', by }],
    },
  ]);
  await publish('quality.complaint.raised', {
    complaintId: String(c._id),
    complaintNo: c.complaintNo,
    category: c.category,
    priority: c.priority,
  });
  return complaintOut(c.toObject());
}

export async function listComplaints({ status } = {}) {
  const filter = status ? { status: { $in: status.split(',') } } : {};
  const rows = await Complaint.find(filter).sort({ dueAt: 1 }).limit(300).lean();
  return { items: rows.map(complaintOut) };
}

export const complaintActionInput = z.object({
  action: z.enum(['ASSIGN', 'START', 'ESCALATE', 'RESOLVE', 'CLOSE']),
  owner: z.string().trim().max(80).optional(),
  note: z.string().trim().max(1000).optional(),
  notifyPatient: z.boolean().default(true),
});

const NEXT = {
  ASSIGN: { from: ['OPEN', 'ESCALATED'], to: 'IN_PROGRESS' },
  START: { from: ['OPEN'], to: 'IN_PROGRESS' },
  ESCALATE: { from: ['OPEN', 'IN_PROGRESS'], to: 'ESCALATED' },
  RESOLVE: { from: ['OPEN', 'IN_PROGRESS', 'ESCALATED'], to: 'RESOLVED' },
  CLOSE: { from: ['RESOLVED'], to: 'CLOSED' },
};

/** Moves a complaint on; closing sends the patient the closure message. */
export async function complaintAction(id, input) {
  const c = await Complaint.findById(id);
  if (!c) throw errors.notFound('Complaint');
  const step = NEXT[input.action];
  if (!step.from.includes(c.status))
    throw new AppError(
      409,
      'INVALID_STATE',
      `The complaint is ${c.status.toLowerCase().replace('_', ' ')}.`,
    );
  if (input.action === 'ASSIGN' && !input.owner)
    throw errors.validation([{ path: 'owner', message: 'Who owns it?' }]);
  if (input.action === 'RESOLVE' && !input.note)
    throw errors.validation([{ path: 'note', message: 'What was done?' }]);
  const by = await userName();
  if (input.owner) c.owner = input.owner;
  if (input.action === 'ESCALATE') c.escalatedAt = new Date();
  if (input.action === 'RESOLVE') {
    c.resolution = input.note;
    c.resolvedAt = new Date();
  }
  if (input.action === 'CLOSE') {
    c.closedAt = new Date();
    const to = c.contactMobile ?? c.patient?.mobile;
    if (to && input.notifyPatient) {
      const { name } = await webUrl();
      await sendSms({
        to,
        template: 'COMPLAINT_CLOSED',
        vars: { hospital: name, complaintNo: c.complaintNo },
      });
      c.messageSentAt = new Date();
    }
  }
  c.status = step.to;
  c.log.push({ at: new Date(), status: step.to, by, note: input.note ?? input.owner });
  await c.save();
  if (input.action === 'ESCALATE')
    await publish('quality.complaint.escalated', {
      complaintId: String(c._id),
      complaintNo: c.complaintNo,
    });
  return complaintOut(c.toObject());
}

/** Scheduled: complaints past their turnaround escalate to the Medical Superintendent. */
export async function escalateOverdue(now = new Date()) {
  const rows = await Complaint.find({
    status: { $in: ['OPEN', 'IN_PROGRESS'] },
    dueAt: { $lt: now },
  });
  for (const c of rows) {
    c.status = 'ESCALATED';
    c.escalatedAt = now;
    c.log.push({ at: now, status: 'ESCALATED', by: 'System', note: 'Past turnaround time' });
    await c.save();
    await publish('quality.complaint.escalated', {
      complaintId: String(c._id),
      complaintNo: c.complaintNo,
    });
  }
  return rows.length;
}

// ---------------------------------------------------------------- incidents

export const incidentInput = z.object({
  type: z.enum([
    'FALL',
    'MEDICATION_ERROR',
    'NEEDLE_STICK',
    'EQUIPMENT_FAILURE',
    'PRESSURE_INJURY',
    'INFECTION',
    'NEAR_MISS',
    'VIOLENCE',
    'OTHER',
  ]),
  severity: z.enum(['NEAR_MISS', 'NO_HARM', 'MILD', 'MODERATE', 'SEVERE', 'SENTINEL']),
  occurredAt: z.iso.datetime({ offset: true }),
  location: z.string().trim().min(2).max(80),
  patientId: z.string().optional(),
  description: z.string().trim().min(10).max(3000),
  immediateAction: z.string().trim().max(1000).optional(),
});

const incidentOut = (i, { manage } = {}) => ({
  id: String(i._id),
  incidentNo: i.incidentNo,
  type: i.type,
  severity: i.severity,
  occurredAt: i.occurredAt,
  location: i.location,
  patient: i.patient?.name ?? null,
  uhid: i.patient?.uhid ?? null,
  description: i.description,
  immediateAction: i.immediateAction ?? null,
  anonymous: i.anonymous,
  reportedBy: i.anonymous ? null : (i.reportedBy?.name ?? null),
  status: i.status,
  investigator: i.investigator ?? null,
  rootCause: manage ? (i.rootCause ?? null) : undefined,
  contributing: manage ? (i.contributing ?? []) : undefined,
  actions: (i.actions ?? []).map((a) => ({
    id: String(a._id),
    text: a.text,
    kind: a.kind,
    owner: a.owner,
    dueOn: a.dueOn,
    done: a.done,
    doneAt: a.doneAt ?? null,
  })),
  approvalId: i.approvalId ? String(i.approvalId) : null,
  closedAt: i.closedAt ?? null,
  createdAt: i.createdAt,
  log: manage ? (i.log ?? []) : undefined,
});

/**
 * Any staff member reports an incident. Anonymous reports are written without the user (no
 * createdBy, no name); the Quality Manager and the HOD are notified.
 */
export async function reportIncident(input, { anonymous = false } = {}) {
  const p = input.patientId ? await Patient.findById(input.patientId).lean() : null;
  const c = current();
  const name = anonymous ? null : await userName();
  const write = async () => {
    const [i] = await Incident.create([
      {
        ...input,
        occurredAt: new Date(input.occurredAt),
        patient: p ? snap(patientCard(p)) : undefined,
        incidentNo: await documentNumber('INC'),
        anonymous,
        reportedBy: anonymous ? undefined : { userId: c.userId, name },
        log: [{ at: new Date(), status: 'REPORTED', by: name ?? 'Anonymous' }],
      },
    ]);
    await publish('quality.incident.reported', {
      incidentId: String(i._id),
      incidentNo: i.incidentNo,
      type: i.type,
      severity: i.severity,
      location: i.location,
    });
    return i;
  };
  const i = anonymous
    ? await runInContext({ ...c, userId: undefined, userName: 'Anonymous' }, write)
    : await write();
  return { id: String(i._id), incidentNo: i.incidentNo, status: i.status };
}

export async function listIncidents({ status, type, mine } = {}) {
  const filter = {};
  if (status) filter.status = { $in: status.split(',') };
  if (type) filter.type = type;
  if (mine) filter['reportedBy.userId'] = current().userId;
  const rows = await Incident.find(filter).sort({ occurredAt: -1 }).limit(300).lean();
  return { items: rows.map((i) => incidentOut(i, { manage: !mine })) };
}

export async function getIncident(id) {
  const i = await Incident.findById(id).lean();
  if (!i) throw errors.notFound('Incident');
  return incidentOut(i, { manage: true });
}

export const investigationInput = z.object({
  investigator: z.string().trim().min(2).max(80).optional(),
  rootCause: z.string().trim().max(2000).optional(),
  contributing: z.array(z.string().trim().max(120)).max(20).optional(),
  actions: z
    .array(
      z.object({
        text: z.string().trim().min(3).max(300),
        kind: z.enum(['CORRECTIVE', 'PREVENTIVE']),
        owner: z.string().trim().min(2).max(80),
        dueOn: ymdDate,
      }),
    )
    .max(20)
    .optional(),
});

/** Investigation: owner, root cause and the CAPA plan. */
export async function investigate(id, input) {
  const i = await Incident.findById(id);
  if (!i) throw errors.notFound('Incident');
  if (['PENDING_CLOSURE', 'CLOSED'].includes(i.status))
    throw new AppError(409, 'INVALID_STATE', 'The incident is going for closure.');
  const by = await userName();
  if (input.investigator) i.investigator = input.investigator;
  if (input.rootCause !== undefined) i.rootCause = input.rootCause;
  if (input.contributing) i.contributing = input.contributing;
  if (input.actions) i.actions.push(...input.actions);
  const next = i.actions.length ? 'CAPA' : 'INVESTIGATING';
  if (i.status !== next) i.log.push({ at: new Date(), status: next, by });
  i.status = next;
  await i.save();
  return incidentOut(i.toObject(), { manage: true });
}

export async function completeAction(id, actionId) {
  const i = await Incident.findById(id);
  if (!i) throw errors.notFound('Incident');
  const a = i.actions.id(actionId);
  if (!a) throw errors.notFound('Action');
  a.done = true;
  a.doneAt = new Date();
  a.doneBy = await userName();
  await i.save();
  return incidentOut(i.toObject(), { manage: true });
}

/** Closure needs the root cause and every action done; the Quality Manager approves. */
export async function requestClosure(id, res) {
  const i = await Incident.findById(id);
  if (!i) throw errors.notFound('Incident');
  if (i.status !== 'CAPA')
    throw new AppError(409, 'INVALID_STATE', 'Record the root cause and actions first.');
  if (!i.rootCause)
    throw errors.validation([{ path: 'rootCause', message: 'Record the root cause' }]);
  const open = i.actions.filter((a) => !a.done);
  if (open.length)
    throw new AppError(409, 'ACTIONS_OPEN', `${open.length} action(s) are not done yet.`);
  return withTransaction(async () => {
    const approval = await requestApproval({
      action: 'quality.incidentClosure',
      module: 'QLT',
      entity: 'Incident',
      entityId: i._id,
      title: `Close ${i.incidentNo} · ${i.type.toLowerCase().replace('_', ' ')}`,
      before: {},
      after: { rootCause: i.rootCause },
      payload: { incidentId: String(i._id) },
      metrics: {},
      reason: i.rootCause,
    });
    const by = await userName();
    if (approval) {
      i.status = 'PENDING_CLOSURE';
      i.approvalId = approval._id;
      if (res) res.locals.status = 202;
    } else {
      i.status = 'CLOSED';
      i.closedAt = new Date();
    }
    i.log.push({ at: new Date(), status: i.status, by });
    await i.save();
    return incidentOut(i.toObject(), { manage: true });
  });
}

onApprovalDecided('quality.incidentClosure', async (req, outcome) => {
  const i = await Incident.findById(req.payload.incidentId);
  if (!i || i.status !== 'PENDING_CLOSURE') return;
  i.status = outcome === 'APPROVED' ? 'CLOSED' : 'CAPA';
  if (outcome === 'APPROVED') i.closedAt = new Date();
  i.log.push({ at: new Date(), status: i.status, by: 'Quality Manager' });
  await i.save();
});

// ---------------------------------------------------------------- audits

const DEFAULT_TEMPLATES = [
  [
    'HAND_HYGIENE',
    'Hand hygiene (WHO 5 moments)',
    [
      'Before touching a patient',
      'Before a clean or aseptic procedure',
      'After body fluid exposure risk',
      'After touching a patient',
      'After touching patient surroundings',
    ],
  ],
  [
    'MAR',
    'Medication administration record',
    [
      'Allergies recorded on the chart',
      'Every dose signed with time',
      'Held doses have a reason',
      'High-alert drugs double-checked',
      'Verbal orders countersigned within 24 h',
    ],
  ],
  [
    'CONSENT',
    'Consent',
    [
      'Consent signed before the procedure',
      'Risks written in the patient’s language',
      'Witness signature present',
      'Doctor’s name and signature legible',
    ],
  ],
  [
    'CRASH_CART',
    'Crash cart',
    [
      'Seal intact and number logged',
      'Defibrillator tested today',
      'Emergency drugs within expiry',
      'Airway equipment complete',
      'Oxygen cylinder full',
    ],
  ],
];

export async function ensureTemplates() {
  for (const [code, name, items] of DEFAULT_TEMPLATES)
    if (!(await AuditTemplate.exists({ code })))
      await AuditTemplate.create([{ code, name, items }]);
}

export async function listTemplates() {
  await ensureTemplates();
  const rows = await AuditTemplate.find({ active: true }).sort({ name: 1 }).lean();
  return { items: rows.map((t) => ({ code: t.code, name: t.name, items: t.items })) };
}

export const auditInput = z.object({
  templateCode: z.string().trim().toUpperCase(),
  area: z.string().trim().min(2).max(80),
  date: ymdDate.optional(),
  answers: z
    .array(
      z.object({
        item: z.string(),
        result: z.enum(['YES', 'NO', 'NA']),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1),
  actions: z
    .array(
      z.object({
        text: z.string().trim().min(3).max(200),
        owner: z.string().trim().max(80),
        dueOn: ymdDate,
      }),
    )
    .max(20)
    .default([]),
});

const auditOut = (a) => ({
  id: String(a._id),
  templateCode: a.templateCode,
  templateName: a.templateName,
  area: a.area,
  date: a.date,
  auditor: a.auditor,
  answers: a.answers,
  score: a.score,
  actions: (a.actions ?? []).map((x) => ({
    id: String(x._id),
    text: x.text,
    owner: x.owner,
    dueOn: x.dueOn,
    done: x.done,
  })),
});

/** A completed audit: score = items met out of those that apply; failed items need an action. */
export async function recordAudit(input) {
  await ensureTemplates();
  const t = await AuditTemplate.findOne({ code: input.templateCode }).lean();
  if (!t) throw errors.validation([{ path: 'templateCode', message: 'Unknown audit' }]);
  const unknown = input.answers.find((a) => !t.items.includes(a.item));
  if (unknown)
    throw errors.validation([
      { path: 'answers', message: `Not in the checklist: ${unknown.item}` },
    ]);
  const applicable = input.answers.filter((a) => a.result !== 'NA');
  const met = applicable.filter((a) => a.result === 'YES').length;
  if (applicable.some((a) => a.result === 'NO') && !input.actions.length)
    throw errors.validation([{ path: 'actions', message: 'Add an action for the items not met' }]);
  const [a] = await QualityAudit.create([
    {
      ...input,
      templateName: t.name,
      date: input.date ?? todayIST(),
      auditor: await userName(),
      score: applicable.length ? Math.round((met * 1000) / applicable.length) / 10 : 100,
    },
  ]);
  return auditOut(a.toObject());
}

export async function listAudits({ templateCode } = {}) {
  const rows = await QualityAudit.find(templateCode ? { templateCode } : {})
    .sort({ date: -1 })
    .limit(200)
    .lean();
  return { items: rows.map(auditOut) };
}

export async function closeAuditAction(id, actionId) {
  const a = await QualityAudit.findById(id);
  if (!a) throw errors.notFound('Audit');
  const x = a.actions.id(actionId);
  if (!x) throw errors.notFound('Action');
  x.done = true;
  x.doneAt = new Date();
  await a.save();
  return auditOut(a.toObject());
}

// ---------------------------------------------------------------- documents

export const documentInput = z.object({
  code: z.string().trim().toUpperCase().min(2).max(30),
  title: z.string().trim().min(3).max(150),
  kind: z.enum(['POLICY', 'SOP', 'FORM', 'PROTOCOL']).default('SOP'),
  department: z.string().trim().max(60).optional(),
  summary: z.string().trim().max(2000).optional(),
  fileId: z.string().optional(),
  reviewOn: ymdDate,
});

const docOut = (d, userId) => ({
  id: String(d._id),
  code: d.code,
  title: d.title,
  kind: d.kind,
  department: d.department ?? null,
  docVersion: d.docVersion,
  summary: d.summary ?? null,
  fileId: d.fileId ? String(d.fileId) : null,
  status: d.status,
  reviewOn: d.reviewOn,
  reviewDue: d.status === 'ACTIVE' && d.reviewOn <= todayIST(),
  preparedBy: d.preparedBy ?? null,
  approvedBy: d.approvedBy ?? null,
  approvedAt: d.approvedAt ?? null,
  acknowledged: (d.acknowledgements ?? []).length,
  acknowledgedByMe: userId
    ? (d.acknowledgements ?? []).some((a) => String(a.userId) === String(userId))
    : false,
});

/** A new document or a new version of an existing code (DRAFT until approved). */
export async function draftDocument(input) {
  const last = await QualityDocument.findOne({ code: input.code }).sort({ docVersion: -1 }).lean();
  if (last?.status === 'DRAFT')
    throw new AppError(
      409,
      'DRAFT_EXISTS',
      `Version ${last.docVersion} of ${input.code} is still a draft.`,
    );
  const [d] = await QualityDocument.create([
    { ...input, docVersion: (last?.docVersion ?? 0) + 1, preparedBy: await userName() },
  ]);
  return docOut(d.toObject());
}

/** Approval by someone other than the author; the previous version retires. */
export async function approveDocument(id) {
  const d = await QualityDocument.findById(id);
  if (!d) throw errors.notFound('Document');
  if (d.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATE', 'Only a draft is approved.');
  const by = await userName();
  if (by === d.preparedBy)
    throw new AppError(409, 'MAKER_CANNOT_CHECK', 'Someone other than the author approves.');
  return withTransaction(async () => {
    await QualityDocument.updateMany(
      { code: d.code, status: 'ACTIVE', _id: { $ne: d._id } },
      { $set: { status: 'RETIRED' } },
    );
    d.status = 'ACTIVE';
    d.approvedBy = by;
    d.approvedAt = new Date();
    await d.save();
    await publish('quality.document.published', { documentId: String(d._id), code: d.code });
    return docOut(d.toObject());
  });
}

export async function listDocuments({ status = 'ACTIVE,DRAFT' } = {}) {
  const rows = await QualityDocument.find({ status: { $in: status.split(',') } })
    .sort({ code: 1, docVersion: -1 })
    .lean();
  const uid = current().userId;
  return { items: rows.map((d) => docOut(d, uid)) };
}

/** Staff confirm they have read the current version. */
export async function acknowledge(id) {
  const d = await QualityDocument.findById(id);
  if (!d || d.status !== 'ACTIVE') throw errors.notFound('Document');
  const c = current();
  if (!d.acknowledgements.some((a) => String(a.userId) === String(c.userId))) {
    d.acknowledgements.push({ userId: c.userId, name: await userName(), at: new Date() });
    await d.save();
  }
  return docOut(d.toObject(), c.userId);
}

// ---------------------------------------------------------------- infection control

export const haiInput = z.object({
  type: z.enum(['CAUTI', 'CLABSI', 'VAP', 'SSI']),
  patientId: z.string().optional(),
  ward: z.string().trim().min(2).max(60),
  onsetOn: ymdDate,
  organism: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function recordHai(input) {
  const p = input.patientId ? await Patient.findById(input.patientId).lean() : null;
  const [h] = await HaiCase.create([
    { ...input, patient: p ? snap(patientCard(p)) : undefined, recordedBy: await userName() },
  ]);
  return { id: String(h._id), ...input };
}

export const deviceDaysInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  ward: z.string().trim().min(2).max(60),
  catheter: z.number().int().min(0),
  centralLine: z.number().int().min(0),
  ventilator: z.number().int().min(0),
  surgeries: z.number().int().min(0).default(0),
});

export async function saveDeviceDays(input) {
  const row = await DeviceDays.findOne({ month: input.month, ward: input.ward });
  if (row) {
    Object.assign(row, input);
    await row.save();
  } else await DeviceDays.create([input]);
  return infectionRates({ month: input.month });
}

/** HAI rates: CAUTI, CLABSI and VAP per 1,000 device days; SSI per 100 surgeries. */
export async function infectionRates({ month }) {
  const [cases, days] = await Promise.all([
    HaiCase.find({ onsetOn: { $gte: `${month}-01`, $lte: `${month}-31` } }).lean(),
    DeviceDays.find({ month }).lean(),
  ]);
  const sum = (k) => days.reduce((t, d) => t + (d[k] ?? 0), 0);
  const count = (type) => cases.filter((c) => c.type === type).length;
  const rate = (n, d, per) => (d ? Math.round((n * per * 100) / d) / 100 : null);
  return {
    month,
    cauti: {
      cases: count('CAUTI'),
      deviceDays: sum('catheter'),
      rate: rate(count('CAUTI'), sum('catheter'), 1000),
    },
    clabsi: {
      cases: count('CLABSI'),
      deviceDays: sum('centralLine'),
      rate: rate(count('CLABSI'), sum('centralLine'), 1000),
    },
    vap: {
      cases: count('VAP'),
      deviceDays: sum('ventilator'),
      rate: rate(count('VAP'), sum('ventilator'), 1000),
    },
    ssi: {
      cases: count('SSI'),
      surgeries: sum('surgeries'),
      rate: rate(count('SSI'), sum('surgeries'), 100),
    },
    cases: cases.map((c) => ({
      id: String(c._id),
      type: c.type,
      ward: c.ward,
      onsetOn: c.onsetOn,
      patient: c.patient?.name ?? null,
      organism: c.organism ?? null,
    })),
  };
}

// ---------------------------------------------------------------- indicators

/** Targets: lower is better unless `higher` is set (NABH-style monthly indicators). */
export const DEFAULT_TARGETS = {
  opdWaitMin: 30,
  dischargeTatMin: 180,
  labTatMin: 240,
  criticalCallMin: 30,
  medErrorsPer1000: 1,
  fallsPer1000: 0.5,
  bedOccupancyPct: 85,
  icuReturn48h: 0,
  nps: 50,
  complaintsOnTimePct: 90,
};
const HIGHER_BETTER = new Set(['bedOccupancyPct', 'nps', 'complaintsOnTimePct']);

const median = (xs) => {
  const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const mins = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : null);

/** Patient days in the month from the stays overlapping it. */
async function patientDays(from, to) {
  const stays = await Admission.find({
    admittedAt: { $lt: to },
    $or: [{ leftAt: null }, { leftAt: { $gte: from } }],
  })
    .select('admittedAt leftAt bedHistory bed')
    .lean();
  const end = Math.min(to.getTime(), Date.now());
  const days = stays.reduce((t, a) => {
    const s = Math.max(new Date(a.admittedAt).getTime(), from.getTime());
    const e = Math.min(a.leftAt ? new Date(a.leftAt).getTime() : end, end);
    return t + Math.max(0, e - s) / DAY;
  }, 0);
  return { days, stays };
}

/** Return to ICU within 48 hours of stepping down (from the stay's bed history). */
function icuReturns(stays, from, to) {
  let n = 0;
  for (const a of stays) {
    const beds = [...(a.bedHistory ?? []), ...(a.bed ? [{ ...a.bed, from: null, to: null }] : [])];
    for (let i = 0; i < beds.length - 1; i += 1) {
      const out = beds[i];
      const next = beds[i + 1];
      if (out?.category !== 'ICU' || !next || next.category === 'ICU' || !out.to) continue;
      const back = beds.slice(i + 2).find((b) => b.category === 'ICU');
      if (!back) continue;
      const at = back.from ?? new Date();
      if (new Date(at) - new Date(out.to) <= 2 * DAY && new Date(at) >= from && new Date(at) < to)
        n += 1;
    }
  }
  return n;
}

/**
 * Monthly quality indicators computed from system data (spec "Quality indicators"): OPD wait,
 * discharge TAT, lab TAT, critical value reporting time, medication errors and falls per 1,000
 * patient days, bed occupancy, return to ICU within 48 h, NPS and complaints closed on time.
 */
export async function indicators({ month }) {
  const from = new Date(`${month}-01T00:00:00+05:30`);
  const to = new Date(from);
  to.setMonth(to.getMonth() + 1);
  const range = { $gte: from, $lt: to };
  const [visits, discharged, lab, calls, incidents, beds, complaints, feedback, pd] =
    await Promise.all([
      OpdVisit.find({ checkedInAt: range }).select('checkedInAt consultStartedAt calledAt').lean(),
      Admission.find({ leftAt: range, dischargeAdviceAt: { $ne: null } })
        .select('dischargeAdviceAt leftAt')
        .lean(),
      LabItem.find({ releasedAt: range, receivedAt: { $ne: null } })
        .select('receivedAt releasedAt')
        .lean(),
      CriticalCall.find({ createdAt: range, doneAt: { $ne: null } })
        .select('createdAt doneAt')
        .lean(),
      Incident.find({ occurredAt: range }).select('type').lean(),
      Bed.countDocuments({ isActive: { $ne: false } }),
      Complaint.find({ closedAt: range }).select('dueAt resolvedAt').lean(),
      Feedback.find({ respondedAt: range, nps: { $ne: null } })
        .select('nps')
        .lean(),
      patientDays(from, to),
    ]);
  const s = await getSettings();
  const daysInMonth = (Math.min(to.getTime(), Date.now()) - from.getTime()) / DAY;
  const per1000 = (n) => (pd.days > 0 ? Math.round((n * 1000 * 100) / pd.days) / 100 : null);
  const npsVal = feedback.length
    ? Math.round(
        ((feedback.filter((f) => f.nps >= 9).length - feedback.filter((f) => f.nps <= 6).length) *
          100) /
          feedback.length,
      )
    : null;
  const values = {
    opdWaitMin: median(visits.map((v) => mins(v.checkedInAt, v.consultStartedAt ?? v.calledAt))),
    dischargeTatMin: median(discharged.map((a) => mins(a.dischargeAdviceAt, a.leftAt))),
    labTatMin: median(lab.map((l) => mins(l.receivedAt, l.releasedAt))),
    criticalCallMin: median(calls.map((c) => mins(c.createdAt, c.doneAt))),
    medErrorsPer1000: per1000(incidents.filter((i) => i.type === 'MEDICATION_ERROR').length),
    fallsPer1000: per1000(incidents.filter((i) => i.type === 'FALL').length),
    bedOccupancyPct:
      beds && daysInMonth > 0 ? Math.round((pd.days * 1000) / (beds * daysInMonth)) / 10 : null,
    icuReturn48h: icuReturns(pd.stays, from, to),
    nps: npsVal,
    complaintsOnTimePct: complaints.length
      ? Math.round(
          (complaints.filter((c) => c.resolvedAt && c.resolvedAt <= c.dueAt).length * 100) /
            complaints.length,
        )
      : null,
  };
  return {
    month,
    patientDays: Math.round(pd.days * 10) / 10,
    items: Object.entries(values).map(([key, value]) => {
      const target = s.targets[key];
      const higher = HIGHER_BETTER.has(key);
      return {
        key,
        value,
        target,
        higherIsBetter: higher,
        met: value == null || target == null ? null : higher ? value >= target : value <= target,
      };
    }),
  };
}

/** Dashboard counts for the quality home. */
export async function overview() {
  const [incidentsOpen, complaintsOpen, overdue, docsDue] = await Promise.all([
    Incident.countDocuments({ status: { $ne: 'CLOSED' } }),
    Complaint.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } }),
    Complaint.countDocuments({
      status: { $in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] },
      dueAt: { $lt: new Date() },
    }),
    QualityDocument.countDocuments({ status: 'ACTIVE', reviewOn: { $lte: todayIST() } }),
  ]);
  return { incidentsOpen, complaintsOpen, complaintsOverdue: overdue, documentsForReview: docsDue };
}
