import { z } from 'zod';
import { User } from '../../../core/auth/models/user.model.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { sendSms } from '../../../core/notify/notify.service.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { current } from '../../../core/tenancy/context.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { Bill } from '../../billing/index.js';
import { Admission } from '../../ipd/index.js';
import { Appointment, OpdVisit } from '../../opd/index.js';
import { Patient, patientCard } from '../../patients/index.js';
import { PaymentMode, ReferralSource } from '../../setup/index.js';
import {
  Campaign,
  CommsPreference,
  Enquiry,
  HealthCamp,
  Lead,
  Membership,
  MembershipPlan,
  ReferralAgreement,
  ReferralStatement,
} from '../models/crm.models.js';

const DAY = 86_400_000;
const mobileRx = /^[6-9]\d{9}$/;
const ymdDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const istStart = (d) => new Date(`${d}T00:00:00+05:30`);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function userName() {
  const c = current();
  if (!c.userId) return c.userName ?? 'System';
  return (await User.findById(c.userId).select('name').lean())?.name ?? 'System';
}

const snap = (p) => (p ? { id: p.id ?? p._id, uhid: p.uhid, name: p.name } : undefined);

async function patientSnap(id) {
  if (!id) return undefined;
  const p = await Patient.findById(id).lean();
  if (!p) throw errors.validation([{ path: 'patientId', message: 'Patient not found' }]);
  return snap(patientCard(p));
}

// ---------------------------------------------------------------- call centre

/**
 * Caller lookup by phone number (spec "Call centre"): matching patients with their upcoming
 * appointments and last visits, open leads, memberships and recent enquiries.
 */
export async function lookup({ mobile }) {
  const patients = await Patient.find({ mobile, status: 'ACTIVE' }).limit(10).lean();
  const ids = patients.map((p) => p._id);
  const today = todayIST();
  const [appointments, visits, leads, memberships, enquiries] = await Promise.all([
    Appointment.find({
      'patient.id': { $in: ids },
      date: { $gte: today },
      status: { $nin: ['CANCELLED', 'NO_SHOW'] },
    })
      .sort({ date: 1, time: 1 })
      .limit(10)
      .lean(),
    OpdVisit.find({ 'patient.id': { $in: ids } })
      .sort({ checkedInAt: -1 })
      .limit(5)
      .lean(),
    Lead.find({ mobile, stage: { $nin: ['CONVERTED', 'LOST'] } }).lean(),
    Membership.find({ 'members.id': { $in: ids } }).lean(),
    Enquiry.find({ mobile }).sort({ at: -1 }).limit(10).lean(),
  ]);
  const pref = await CommsPreference.findOne({ mobile }).lean();
  return {
    mobile,
    patients: patients.map(patientCard),
    appointments: appointments.map((a) => ({
      id: String(a._id),
      patient: a.patient?.name,
      date: a.date,
      time: a.time,
      doctor: a.doctor?.name ?? null,
      status: a.status,
    })),
    visits: visits.map((v) => ({
      id: String(v._id),
      patient: v.patient?.name,
      at: v.checkedInAt,
      doctor: v.doctor?.name ?? null,
      department: v.doctor?.department ?? null,
    })),
    leads: leads.map(leadOut),
    memberships: memberships.map(membershipOut),
    enquiries: enquiries.map(enquiryOut),
    optedOut: Boolean(pref?.optedOutAt),
  };
}

const enquiryOut = (e) => ({
  id: String(e._id),
  mobile: e.mobile,
  name: e.name ?? e.patient?.name ?? null,
  channel: e.channel,
  direction: e.direction,
  topic: e.topic,
  notes: e.notes ?? null,
  outcome: e.outcome ?? null,
  leadId: e.leadId ? String(e.leadId) : null,
  by: e.by,
  at: e.at,
});

export const enquiryInput = z.object({
  mobile: z.string().trim().regex(mobileRx, 'Enter a 10-digit mobile'),
  name: z.string().trim().max(80).optional(),
  patientId: z.string().optional(),
  channel: z.enum(['CALL', 'WALK_IN', 'WHATSAPP', 'WEB', 'EMAIL']).default('CALL'),
  direction: z.enum(['INBOUND', 'OUTBOUND']).default('INBOUND'),
  topic: z.enum(['APPOINTMENT', 'PACKAGE', 'REPORT', 'BILLING', 'GENERAL', 'COMPLAINT']),
  notes: z.string().trim().max(1000).optional(),
  outcome: z.string().trim().max(200).optional(),
  // A package or surgery enquiry can open a lead straight away.
  lead: z
    .object({
      interest: z.string().trim().min(3).max(120),
      department: z.string().trim().max(60).optional(),
    })
    .optional(),
});

export async function logEnquiry(input) {
  const by = await userName();
  return withTransaction(async () => {
    let lead;
    if (input.lead)
      lead = await createLead({
        name: input.name ?? 'Caller',
        mobile: input.mobile,
        patientId: input.patientId,
        interest: input.lead.interest,
        department: input.lead.department,
        source: input.channel === 'WALK_IN' ? 'WALK_IN' : 'CALL',
      });
    const [e] = await Enquiry.create([
      {
        ...input,
        patient: await patientSnap(input.patientId),
        leadId: lead?.id,
        by,
      },
    ]);
    return { ...enquiryOut(e.toObject()), lead: lead ?? null };
  });
}

// ---------------------------------------------------------------- leads

export const leadInput = z.object({
  name: z.string().trim().min(2).max(80),
  mobile: z.string().trim().regex(mobileRx, 'Enter a 10-digit mobile'),
  patientId: z.string().optional(),
  interest: z.string().trim().min(3).max(120),
  department: z.string().trim().max(60).optional(),
  source: z
    .enum(['CALL', 'WALK_IN', 'WEBSITE', 'CAMP', 'REFERRAL', 'CAMPAIGN', 'SOCIAL', 'OTHER'])
    .default('CALL'),
  campId: z.string().optional(),
  campaignId: z.string().optional(),
  referralSourceId: z.string().optional(),
  estimate: z.number().int().min(0).optional(),
  owner: z.string().trim().max(80).optional(),
  nextFollowUp: ymdDate.optional(),
});

export const leadOut = (l) => ({
  id: String(l._id),
  leadNo: l.leadNo,
  name: l.name,
  mobile: l.mobile,
  patientId: l.patient?.id ? String(l.patient.id) : null,
  uhid: l.patient?.uhid ?? null,
  interest: l.interest,
  department: l.department ?? null,
  source: l.source,
  estimate: l.estimate ?? null,
  stage: l.stage,
  owner: l.owner ?? null,
  nextFollowUp: l.nextFollowUp ?? null,
  due: Boolean(
    l.nextFollowUp && !['CONVERTED', 'LOST'].includes(l.stage) && l.nextFollowUp <= new Date(),
  ),
  lostReason: l.lostReason ?? null,
  convertedAt: l.convertedAt ?? null,
  convertedRef: l.convertedRef ?? null,
  notes: l.notes ?? [],
  createdAt: l.createdAt,
});

export async function createLead(input) {
  const by = await userName();
  let patient = await patientSnap(input.patientId);
  if (!patient) {
    // Link to the patient record when the number belongs to exactly one patient.
    const found = await Patient.find({ mobile: input.mobile, status: 'ACTIVE' }).limit(2).lean();
    if (found.length === 1) patient = snap(patientCard(found[0]));
  }
  const [l] = await Lead.create([
    {
      ...input,
      leadNo: await documentNumber('LD'),
      patient,
      nextFollowUp: input.nextFollowUp ? istStart(input.nextFollowUp) : new Date(Date.now() + DAY),
      owner: input.owner ?? by,
      notes: [{ at: new Date(), by, text: `Lead opened: ${input.interest}` }],
    },
  ]);
  return leadOut(l.toObject());
}

export async function listLeads({ stage, due, q, source } = {}) {
  const filter = {};
  if (stage) filter.stage = { $in: stage.split(',') };
  if (source) filter.source = source;
  if (due) {
    filter.stage = { $nin: ['CONVERTED', 'LOST'] };
    filter.nextFollowUp = { $lte: new Date() };
  }
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ name: rx }, { mobile: rx }, { interest: rx }, { leadNo: rx }];
  }
  const rows = await Lead.find(filter).sort({ nextFollowUp: 1 }).limit(300).lean();
  return { items: rows.map(leadOut) };
}

const STAGES = ['NEW', 'CONTACTED', 'COUNSELLED', 'BOOKED', 'CONVERTED', 'LOST'];

export const leadUpdateInput = z.object({
  stage: z.enum(['NEW', 'CONTACTED', 'COUNSELLED', 'BOOKED', 'LOST']).optional(),
  note: z.string().trim().max(500).optional(),
  nextFollowUp: ymdDate.optional(),
  estimate: z.number().int().min(0).optional(),
  owner: z.string().trim().max(80).optional(),
  lostReason: z.string().trim().max(200).optional(),
});

/** Moves a lead on (CONVERTED comes from the admission or visit itself). */
export async function updateLead(id, input) {
  const l = await Lead.findById(id);
  if (!l) throw errors.notFound('Lead');
  if (['CONVERTED', 'LOST'].includes(l.stage))
    throw new AppError(409, 'INVALID_STATE', 'The lead is closed.');
  if (input.stage === 'LOST' && !input.lostReason)
    throw errors.validation([{ path: 'lostReason', message: 'Why was it lost?' }]);
  const by = await userName();
  if (input.stage && input.stage !== l.stage) {
    l.notes.push({ at: new Date(), by, text: `${l.stage} → ${input.stage}` });
    l.stage = input.stage;
  }
  if (input.lostReason) l.lostReason = input.lostReason;
  if (input.note) l.notes.push({ at: new Date(), by, text: input.note });
  if (input.nextFollowUp) l.nextFollowUp = istStart(input.nextFollowUp);
  if (input.estimate != null) l.estimate = input.estimate;
  if (input.owner) l.owner = input.owner;
  await l.save();
  return leadOut(l.toObject());
}

async function convert(match, ref) {
  const open = await Lead.find({ ...match, stage: { $in: ['CONTACTED', 'COUNSELLED', 'BOOKED'] } });
  for (const l of open) {
    l.stage = 'CONVERTED';
    l.convertedAt = new Date();
    l.convertedRef = ref;
    l.notes.push({ at: new Date(), by: 'System', text: `Converted: ${ref}` });
    await l.save();
    await publish('crm.lead.converted', { leadId: String(l._id), ref });
  }
  return open.length;
}

/** ipd.admitted: a lead for the patient (by record or mobile) is converted. */
export async function onAdmitted({ admissionId }) {
  const a = await Admission.findById(admissionId).select('ipNo patient').lean();
  if (!a) return 0;
  return convert(
    {
      $or: [
        { 'patient.id': a.patient.id },
        ...(a.patient.mobile ? [{ mobile: a.patient.mobile }] : []),
      ],
    },
    a.ipNo,
  );
}

/** opd.visit.closed: an OPD lead (consultation booked) is converted when the patient is seen. */
export async function onVisitClosed({ visitId }) {
  const v = await OpdVisit.findById(visitId).select('patient visitNo').lean();
  if (!v) return 0;
  return convert({ 'patient.id': v.patient.id, stage: 'BOOKED' }, v.visitNo ?? String(v._id));
}

// ---------------------------------------------------------------- health camps

export const campInput = z.object({
  name: z.string().trim().min(3).max(120),
  date: ymdDate,
  venue: z.string().trim().min(2).max(120),
  partner: z.string().trim().max(120).optional(),
  screenings: z.array(z.string().trim().min(2).max(30)).max(20).default([]),
  cost: z.number().int().min(0).default(0),
});

const campOut = (c) => ({
  id: String(c._id),
  campNo: c.campNo,
  name: c.name,
  date: c.date,
  venue: c.venue,
  partner: c.partner ?? null,
  screenings: c.screenings,
  cost: c.cost,
  status: c.status,
  registrations: (c.registrations ?? []).map((r) => ({
    id: String(r._id),
    name: r.name,
    mobile: r.mobile,
    age: r.age ?? null,
    gender: r.gender ?? null,
    results: r.results ?? {},
    advice: r.advice ?? null,
    followUp: r.followUp,
    leadId: r.leadId ? String(r.leadId) : null,
    patientId: r.patientId ? String(r.patientId) : null,
  })),
});

export async function createCamp(input) {
  const [c] = await HealthCamp.create([{ ...input, campNo: await documentNumber('CAMP') }]);
  return campOut(c.toObject());
}

export async function listCamps() {
  const rows = await HealthCamp.find({}).sort({ date: -1 }).limit(100).lean();
  return { items: rows.map(campOut) };
}

export const registrationInput = z.object({
  name: z.string().trim().min(2).max(80),
  mobile: z.string().trim().regex(mobileRx, 'Enter a 10-digit mobile'),
  age: z.number().int().min(0).max(120).optional(),
  gender: z.enum(['M', 'F', 'O']).optional(),
  results: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  advice: z.string().trim().max(300).optional(),
  followUp: z.boolean().default(false),
  interest: z.string().trim().max(120).optional(),
});

/** On-site registration with screening results; a follow-up opens a lead for the camp. */
export async function registerAtCamp(id, input) {
  const c = await HealthCamp.findById(id);
  if (!c) throw errors.notFound('Camp');
  if (c.status === 'CANCELLED') throw new AppError(409, 'INVALID_STATE', 'The camp is cancelled.');
  return withTransaction(async () => {
    let lead;
    if (input.followUp)
      lead = await createLead({
        name: input.name,
        mobile: input.mobile,
        interest: input.interest ?? input.advice ?? `Follow-up from ${c.name}`,
        source: 'CAMP',
        campId: String(c._id),
      });
    c.registrations.push({ ...input, leadId: lead?.id, at: new Date() });
    await c.save();
    return campOut(c.toObject());
  });
}

export async function closeCamp(id) {
  const c = await HealthCamp.findById(id);
  if (!c) throw errors.notFound('Camp');
  c.status = 'DONE';
  await c.save();
  return campOut(c.toObject());
}

/** Revenue billed to patients linked to a set of leads since a date. */
async function revenueOf(patientIds, since) {
  if (!patientIds.length) return 0;
  const bills = await Bill.find({
    'patient.id': { $in: patientIds },
    status: { $in: ['FINAL', 'PARTLY_PAID', 'PAID'] },
    finalizedAt: { $gte: since },
  })
    .select('totals')
    .lean();
  return bills.reduce((t, b) => t + (b.totals?.total ?? 0), 0);
}

/** Camp ROI: registrations, follow-ups, leads converted, revenue from them against the cost. */
export async function campReport(id) {
  const c = await HealthCamp.findById(id).lean();
  if (!c) throw errors.notFound('Camp');
  const leads = await Lead.find({ campId: c._id }).lean();
  const converted = leads.filter((l) => l.stage === 'CONVERTED');
  const revenue = await revenueOf(
    converted.map((l) => l.patient?.id).filter(Boolean),
    istStart(c.date),
  );
  return {
    ...campOut(c),
    registered: c.registrations.length,
    followUps: c.registrations.filter((r) => r.followUp).length,
    leads: leads.length,
    converted: converted.length,
    revenue,
    roi: c.cost ? Math.round(((revenue - c.cost) * 100) / c.cost) : null,
  };
}

// ---------------------------------------------------------------- campaigns and consent

export const optOutInput = z.object({
  mobile: z.string().trim().regex(mobileRx, 'Enter a 10-digit mobile'),
  optOut: z.boolean().default(true),
  source: z.string().trim().max(60).optional(),
});

/** Records a patient's choice about promotional messages (campaigns skip opted-out numbers). */
export async function setPreference({ mobile, optOut, source }) {
  const p = (await CommsPreference.findOne({ mobile })) ?? new CommsPreference({ mobile });
  p.sms = !optOut;
  p.whatsapp = !optOut;
  p.optedOutAt = optOut ? new Date() : undefined;
  p.source = source ?? (await userName());
  await p.save();
  return { mobile, optedOut: Boolean(p.optedOutAt) };
}

/**
 * patients.consent.changed: a patient's messaging consents decide what campaigns may send.
 * MARKETING covers both channels; SMS and WHATSAPP one each.
 */
export async function onConsentChanged({ mobile, type, status }) {
  if (!mobile || !['MARKETING', 'SMS', 'WHATSAPP'].includes(type)) return null;
  const allowed = status !== 'WITHDRAWN';
  const p = (await CommsPreference.findOne({ mobile })) ?? new CommsPreference({ mobile });
  if (type !== 'WHATSAPP') p.sms = allowed;
  if (type !== 'SMS') p.whatsapp = allowed;
  p.optedOutAt = !p.sms && !p.whatsapp ? new Date() : undefined;
  p.source = 'Patient consent';
  await p.save();
  return { mobile, sms: p.sms, whatsapp: p.whatsapp };
}

export const campaignInput = z.object({
  name: z.string().trim().min(3).max(120),
  channel: z.enum(['SMS', 'WHATSAPP']).default('SMS'),
  dltTemplateId: z.string().trim().max(40).optional(),
  text: z.string().trim().min(10).max(300),
  audience: z
    .object({
      conditions: z.array(z.string().trim().max(60)).max(10).default([]),
      gender: z.enum(['M', 'F', 'O']).optional(),
      ageMin: z.number().int().min(0).max(120).optional(),
      ageMax: z.number().int().min(0).max(120).optional(),
      lastVisitBefore: ymdDate.optional(),
      lastVisitAfter: ymdDate.optional(),
    })
    .default({ conditions: [] }),
});

const campaignOut = (c) => ({
  id: String(c._id),
  campaignNo: c.campaignNo,
  name: c.name,
  channel: c.channel,
  dltTemplateId: c.dltTemplateId ?? null,
  text: c.text,
  audience: c.audience ?? {},
  status: c.status,
  audienceCount: c.audienceCount ?? null,
  sent: c.sent,
  skippedOptOut: c.skippedOptOut,
  responses: c.responses,
  sentAt: c.sentAt ?? null,
  sentBy: c.sentBy ?? null,
});

/** Patients matching the audience (with a mobile), split into reachable and opted out. */
async function audience(a = {}) {
  const filter = { status: 'ACTIVE', mobile: { $exists: true, $ne: null } };
  if (a.conditions?.length)
    filter.chronicConditions = { $in: a.conditions.map((x) => new RegExp(`^${escape(x)}$`, 'i')) };
  if (a.gender) filter.gender = a.gender;
  const now = new Date();
  if (a.ageMin != null || a.ageMax != null) {
    filter.dob = {};
    if (a.ageMin != null)
      filter.dob.$lte = new Date(now.getFullYear() - a.ageMin, now.getMonth(), now.getDate());
    if (a.ageMax != null)
      filter.dob.$gt = new Date(now.getFullYear() - a.ageMax - 1, now.getMonth(), now.getDate());
  }
  let patients = await Patient.find(filter).select('_id mobile').limit(20000).lean();
  if (a.lastVisitBefore || a.lastVisitAfter) {
    const last = await OpdVisit.aggregate([
      {
        $match: { tenantId: current().tenantId, 'patient.id': { $in: patients.map((p) => p._id) } },
      },
      { $group: { _id: '$patient.id', at: { $max: '$checkedInAt' } } },
    ]);
    const lastBy = new Map(last.map((x) => [String(x._id), x.at]));
    patients = patients.filter((p) => {
      const at = lastBy.get(String(p._id));
      if (a.lastVisitBefore && !(at && at < istStart(a.lastVisitBefore))) return false;
      if (a.lastVisitAfter && !(at && at >= istStart(a.lastVisitAfter))) return false;
      return true;
    });
  }
  const mobiles = [...new Set(patients.map((p) => p.mobile))];
  const out = new Set(
    (
      await CommsPreference.find({ mobile: { $in: mobiles }, optedOutAt: { $ne: null } })
        .select('mobile')
        .lean()
    ).map((p) => p.mobile),
  );
  return { reach: mobiles.filter((m) => !out.has(m)), optedOut: mobiles.filter((m) => out.has(m)) };
}

export async function createCampaign(input) {
  const a = await audience(input.audience);
  const [c] = await Campaign.create([
    { ...input, campaignNo: await documentNumber('CMPGN'), audienceCount: a.reach.length },
  ]);
  return { ...campaignOut(c.toObject()), optedOut: a.optedOut.length };
}

export async function previewAudience(audienceInput) {
  const a = await audience(audienceInput);
  return { reach: a.reach.length, optedOut: a.optedOut.length };
}

export async function listCampaigns() {
  const rows = await Campaign.find({}).sort({ createdAt: -1 }).limit(100).lean();
  const counts = await Lead.aggregate([
    { $match: { tenantId: current().tenantId, campaignId: { $in: rows.map((r) => r._id) } } },
    { $group: { _id: '$campaignId', n: { $sum: 1 } } },
  ]);
  const by = new Map(counts.map((x) => [String(x._id), x.n]));
  return { items: rows.map((r) => ({ ...campaignOut(r), responses: by.get(String(r._id)) ?? 0 })) };
}

/** Sends a draft campaign to the reachable audience (opted-out numbers are skipped). */
export async function sendCampaign(id) {
  const c = await Campaign.findById(id);
  if (!c) throw errors.notFound('Campaign');
  if (c.status !== 'DRAFT') throw new AppError(409, 'INVALID_STATE', 'Already sent.');
  const a = await audience(c.audience);
  const hospital = (await Tenant.findById(current().tenantId).select('name').lean())?.name;
  let sent = 0;
  for (const to of a.reach) {
    await sendSms({ to, template: 'CAMPAIGN', vars: { hospital, text: c.text } });
    sent += 1;
  }
  c.status = 'SENT';
  c.sent = sent;
  c.skippedOptOut = a.optedOut.length;
  c.audienceCount = a.reach.length;
  c.sentAt = new Date();
  c.sentBy = await userName();
  await c.save();
  return campaignOut(c.toObject());
}

// ---------------------------------------------------------------- memberships

export const planInput = z.object({
  code: z.string().trim().toUpperCase().min(2).max(20),
  name: z.string().trim().min(3).max(80),
  price: z.number().int().min(0),
  validityDays: z.number().int().min(30).max(3650).default(365),
  maxMembers: z.number().int().min(1).max(10).default(4),
  discountPct: z.number().min(0).max(50).default(0),
  freeVisits: z.number().int().min(0).max(50).default(0),
  walletCredit: z.number().int().min(0).default(0),
});

const planOut = (p) => ({
  id: String(p._id),
  code: p.code,
  name: p.name,
  price: p.price,
  validityDays: p.validityDays,
  maxMembers: p.maxMembers,
  discountPct: p.discountPct,
  freeVisits: p.freeVisits,
  walletCredit: p.walletCredit,
  active: p.active,
});

export async function createPlan(input) {
  if (await MembershipPlan.exists({ code: input.code }))
    throw new AppError(409, 'DUPLICATE', `Plan ${input.code} exists.`);
  const [p] = await MembershipPlan.create([input]);
  return planOut(p.toObject());
}

export async function listPlans() {
  const rows = await MembershipPlan.find({ active: true }).sort({ price: 1 }).lean();
  return { items: rows.map(planOut) };
}

const statusOf = (m) => (m.status === 'ACTIVE' && m.validUntil < new Date() ? 'EXPIRED' : m.status);

export const membershipOut = (m) => ({
  id: String(m._id),
  cardNo: m.cardNo,
  planName: m.planName,
  discountPct: m.discountPct,
  holder: m.holder?.name ?? null,
  members: (m.members ?? []).map((x) => ({ id: String(x.id), uhid: x.uhid, name: x.name })),
  validFrom: m.validFrom,
  validUntil: m.validUntil,
  status: statusOf(m),
  freeVisitsLeft: m.freeVisitsLeft,
  wallet: m.wallet,
  ledger: m.ledger ?? [],
  renewDue: statusOf(m) === 'ACTIVE' && m.validUntil - Date.now() < 30 * DAY,
});

/** Makes sure the counter has a WALLET payment mode for membership cards. */
async function ensureWalletMode() {
  if (!(await PaymentMode.exists({ kind: 'WALLET' })))
    await PaymentMode.create([
      {
        code: 'WALLET',
        name: 'Membership wallet',
        kind: 'WALLET',
        requiresReference: true,
        isActive: true,
      },
    ]);
}

export const membershipInput = z.object({
  planCode: z.string().trim().toUpperCase(),
  holderId: z.string(),
  memberIds: z.array(z.string()).max(10).default([]),
  paymentRef: z.string().trim().min(3).max(40), // receipt number of the plan fee
});

/** Sells a family health card (the fee is collected at the counter; its receipt is recorded). */
export async function sell(input) {
  const plan = await MembershipPlan.findOne({ code: input.planCode, active: true }).lean();
  if (!plan) throw errors.validation([{ path: 'planCode', message: 'Unknown plan' }]);
  const ids = [...new Set([input.holderId, ...input.memberIds])];
  if (ids.length > plan.maxMembers)
    throw errors.validation([{ path: 'memberIds', message: `At most ${plan.maxMembers} members` }]);
  const members = [];
  for (const pid of ids) members.push(await patientSnap(pid));
  const active = await Membership.findOne({
    'members.id': { $in: ids },
    status: 'ACTIVE',
    validUntil: { $gt: new Date() },
  }).lean();
  if (active) throw new AppError(409, 'ALREADY_MEMBER', `Already on card ${active.cardNo}.`);
  await ensureWalletMode();
  const by = await userName();
  const now = new Date();
  const [m] = await Membership.create([
    {
      cardNo: await documentNumber('MEM'),
      planId: plan._id,
      planName: plan.name,
      discountPct: plan.discountPct,
      holder: members[0],
      members,
      validFrom: now,
      validUntil: new Date(now.getTime() + plan.validityDays * DAY),
      paymentRef: input.paymentRef,
      freeVisitsLeft: plan.freeVisits,
      wallet: plan.walletCredit,
      ledger: plan.walletCredit
        ? [{ at: now, kind: 'CREDIT', amount: plan.walletCredit, ref: 'Plan credit', by }]
        : [],
    },
  ]);
  return membershipOut(m.toObject());
}

export async function listMemberships({ q, renewDue } = {}) {
  const filter = {};
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ cardNo: rx }, { 'members.name': rx }, { 'members.uhid': rx }];
  }
  if (renewDue) filter.validUntil = { $lte: new Date(Date.now() + 30 * DAY), $gt: new Date() };
  const rows = await Membership.find(filter).sort({ validUntil: 1 }).limit(300).lean();
  return { items: rows.map(membershipOut) };
}

/** Membership of a patient, for the billing and OPD counters. */
export async function memberOf(patientId) {
  const m = await Membership.findOne({
    'members.id': patientId,
    status: 'ACTIVE',
    validUntil: { $gt: new Date() },
  }).lean();
  return { membership: m ? membershipOut(m) : null };
}

export async function useFreeVisit(id, { patientId, ref }) {
  const m = await Membership.findById(id);
  if (!m || statusOf(m) !== 'ACTIVE')
    throw new AppError(409, 'NOT_ACTIVE', 'The card is not active.');
  if (!m.members.some((x) => String(x.id) === patientId))
    throw errors.validation([{ path: 'patientId', message: 'Not a member on this card' }]);
  if (m.freeVisitsLeft < 1) throw new AppError(409, 'NO_FREE_VISITS', 'No free visits left.');
  m.freeVisitsLeft -= 1;
  m.ledger.push({ at: new Date(), kind: 'FREE_VISIT', amount: 0, ref, by: await userName() });
  await m.save();
  return membershipOut(m.toObject());
}

/**
 * Billing's WALLET payment hook: the reference is the card number; the patient must be a member
 * of an active card with enough balance. Runs inside the receipt's transaction.
 */
export async function debitWallet({ patientId, amount, reference }) {
  const m = await Membership.findOne({ cardNo: reference });
  if (!m || statusOf(m) !== 'ACTIVE')
    throw errors.validation([
      { path: 'reference', message: 'No active membership card with that number' },
    ]);
  if (!m.members.some((x) => String(x.id) === String(patientId)))
    throw errors.validation([
      { path: 'reference', message: 'The patient is not a member on this card' },
    ]);
  if (m.wallet < amount)
    throw errors.validation([
      { path: 'amount', message: `Only ${m.wallet / 100} left on the card` },
    ]);
  m.wallet -= amount;
  m.ledger.push({
    at: new Date(),
    kind: 'DEBIT',
    amount,
    ref: 'Counter payment',
    by: await userName(),
  });
  await m.save();
}

// ---------------------------------------------------------------- referral partners

export const agreementInput = z.object({
  referralSourceId: z.string(),
  feePct: z.number().min(0).max(30),
  categories: z.array(z.string().trim().toUpperCase()).max(20).default([]),
  notes: z.string().trim().max(200).optional(),
});

export async function saveAgreement(input) {
  if (!(await ReferralSource.exists({ _id: input.referralSourceId })))
    throw errors.validation([{ path: 'referralSourceId', message: 'Unknown referral source' }]);
  const a =
    (await ReferralAgreement.findOne({ referralSourceId: input.referralSourceId })) ??
    new ReferralAgreement({ referralSourceId: input.referralSourceId });
  Object.assign(a, input, { active: true });
  await a.save();
  return { id: String(a._id), ...input };
}

/**
 * Referral partners for a month: patients registered through each source, their visits and the
 * revenue billed in the month, and the agreed fee.
 */
export async function referrals({ month }) {
  const from = new Date(`${month}-01T00:00:00+05:30`);
  const to = new Date(from);
  to.setMonth(to.getMonth() + 1);
  const sources = await ReferralSource.find({ isActive: { $ne: false } }).lean();
  const agreements = await ReferralAgreement.find({ active: true }).lean();
  const items = [];
  for (const s of sources) {
    const patients = await Patient.find({ 'referral.sourceId': s._id })
      .select('_id createdAt')
      .lean();
    const ids = patients.map((p) => p._id);
    const [visits, bills] = await Promise.all([
      OpdVisit.countDocuments({ 'patient.id': { $in: ids }, checkedInAt: { $gte: from, $lt: to } }),
      Bill.find({
        'patient.id': { $in: ids },
        status: { $in: ['FINAL', 'PARTLY_PAID', 'PAID'] },
        finalizedAt: { $gte: from, $lt: to },
      })
        .select('lines totals')
        .lean(),
    ]);
    const ag = agreements.find((a) => String(a.referralSourceId) === String(s._id));
    const revenue = bills.reduce((t, b) => t + (b.totals?.total ?? 0), 0);
    const feeBase = ag?.categories?.length
      ? bills.reduce(
          (t, b) =>
            t +
            b.lines
              .filter((l) => ag.categories.includes(l.category))
              .reduce((x, l) => x + (l.taxable ?? 0), 0),
          0,
        )
      : revenue;
    items.push({
      id: String(s._id),
      code: s.code,
      name: s.name,
      kind: s.kind,
      phone: s.phone ?? null,
      newPatients: patients.filter((p) => p.createdAt >= from && p.createdAt < to).length,
      totalPatients: patients.length,
      visits,
      revenue,
      feePct: ag?.feePct ?? null,
      fee: ag ? Math.round((feeBase * ag.feePct) / 100) : 0,
    });
  }
  items.sort((a, b) => b.revenue - a.revenue);
  return { month, items };
}

/** Monthly referral statements (one per partner with a fee) sent to Finance. */
export async function generateStatements({ month }) {
  const r = await referrals({ month });
  const out = [];
  for (const x of r.items.filter((i) => i.feePct != null && i.fee > 0)) {
    const existing = await ReferralStatement.findOne({ month, referralSourceId: x.id });
    if (existing?.status === 'SENT') {
      out.push(existing);
      continue;
    }
    const st = existing ?? new ReferralStatement({ month, referralSourceId: x.id });
    Object.assign(st, {
      sourceName: x.name,
      patients: x.totalPatients,
      revenue: x.revenue,
      fee: x.fee,
    });
    await st.save();
    out.push(st);
  }
  return { month, items: out.map(statementOut) };
}

const statementOut = (s) => ({
  id: String(s._id),
  month: s.month,
  referralSourceId: String(s.referralSourceId),
  sourceName: s.sourceName,
  patients: s.patients,
  revenue: s.revenue,
  fee: s.fee,
  status: s.status,
  sentAt: s.sentAt ?? null,
});

export async function sendStatement(id) {
  const s = await ReferralStatement.findById(id);
  if (!s) throw errors.notFound('Statement');
  if (s.status === 'SENT') throw new AppError(409, 'INVALID_STATE', 'Already sent.');
  s.status = 'SENT';
  s.sentAt = new Date();
  await s.save();
  await publish('crm.referral.statement', {
    statementId: String(s._id),
    month: s.month,
    source: s.sourceName,
    fee: s.fee,
  });
  return statementOut(s.toObject());
}

// ---------------------------------------------------------------- reports

/** Lead funnel by source, campaign responses, camp conversion and memberships due for renewal. */
export async function report({ from, to }) {
  const range = { $gte: istStart(from), $lte: new Date(`${to}T23:59:59+05:30`) };
  const leads = await Lead.find({ createdAt: range }).select('stage source').lean();
  const sources = [...new Set(leads.map((l) => l.source))].sort();
  const funnel = sources.map((source) => {
    const ls = leads.filter((l) => l.source === source);
    const converted = ls.filter((l) => l.stage === 'CONVERTED').length;
    return {
      source,
      leads: ls.length,
      ...Object.fromEntries(STAGES.map((st) => [st, ls.filter((l) => l.stage === st).length])),
      conversionPct: ls.length ? Math.round((converted * 100) / ls.length) : 0,
    };
  });
  const [camps, renewals, members] = await Promise.all([
    HealthCamp.find({ date: { $gte: from, $lte: to } })
      .select('_id')
      .lean(),
    Membership.countDocuments({
      status: 'ACTIVE',
      validUntil: { $gt: new Date(), $lte: new Date(Date.now() + 30 * DAY) },
    }),
    Membership.countDocuments({ status: 'ACTIVE', validUntil: { $gt: new Date() } }),
  ]);
  const campRows = [];
  for (const c of camps) campRows.push(await campReport(c._id));
  return {
    from,
    to,
    leads: leads.length,
    converted: leads.filter((l) => l.stage === 'CONVERTED').length,
    funnel,
    camps: campRows.map((c) => ({
      id: c.id,
      name: c.name,
      date: c.date,
      registered: c.registered,
      leads: c.leads,
      converted: c.converted,
      revenue: c.revenue,
      cost: c.cost,
      roi: c.roi,
    })),
    activeMemberships: members,
    renewalsDue: renewals,
  };
}
