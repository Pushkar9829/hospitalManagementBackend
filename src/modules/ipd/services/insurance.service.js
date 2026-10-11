import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { runAsSystem } from '../../../core/tenancy/context.js';
import { Payer } from '../../setup/index.js';
import { Admission } from '../models/ipd.models.js';
import { PreAuth } from '../models/insurance.models.js';
import { userName } from './admission.service.js';
import { runningBill } from './charges.service.js';
import { settingsDoc } from './common.js';

const HOUR = 3_600_000;
const OPEN = [
  'SENT',
  'QUERY',
  'APPROVED',
  'ENHANCEMENT_SENT',
  'FINAL_SENT',
  'FINAL_APPROVED',
  'CLAIMED',
];

async function findCase(id) {
  const p = await PreAuth.findById(id);
  if (!p) throw errors.notFound('Pre-authorisation');
  return p;
}

const out = async (p, { withBill = false } = {}) => {
  const base = {
    id: String(p._id),
    admissionId: String(p.admissionId),
    ipNo: p.ipNo,
    patient: { id: String(p.patient.id), name: p.patient.name, uhid: p.patient.uhid },
    payer: { id: String(p.payer.id), name: p.payer.name, kind: p.payer.kind },
    policyNo: p.policyNo ?? null,
    diagnosis: p.diagnosis ?? null,
    status: p.status,
    requested: p.requested,
    approved: p.approved,
    finalApproved: p.finalApproved ?? null,
    patientShare: p.patientShare ?? null,
    settled: p.settled ?? null,
    deductions: p.deductions ?? [],
    claim: p.claim?.no ? p.claim : null,
    replyDueAt: p.replyDueAt ?? null,
    overdue: Boolean(
      p.replyDueAt &&
      p.replyDueAt < new Date() &&
      ['SENT', 'ENHANCEMENT_SENT', 'FINAL_SENT'].includes(p.status),
    ),
    events: p.events ?? [],
  };
  if (!withBill) return base;
  const a = await Admission.findById(p.admissionId).lean();
  const bill = a ? await runningBill(a) : null;
  const s = await settingsDoc();
  const pct = p.approved ? Math.round(((bill?.total ?? 0) * 100) / p.approved) : null;
  return {
    ...base,
    billTotal: bill?.total ?? 0,
    billPct: pct,
    // Rule R9: suggest an enhancement when the bill reaches the set share of the approval.
    enhancementDue: Boolean(pct != null && pct >= s.enhancementPct && p.status === 'APPROVED'),
  };
};

/** Rule R8: a cashless request for an insured stay, with the 1-hour reply clock. */
export async function sendPreAuth(
  admissionId,
  { requested, diagnosis, plannedTreatment, memberId },
) {
  const a = await Admission.findById(admissionId);
  if (!a) throw errors.notFound('Admission');
  if (!['INSURANCE', 'SCHEME', 'CORPORATE'].includes(a.payer?.kind) || !a.payer?.payerId)
    throw new AppError(
      409,
      'NOT_INSURED',
      'This stay has no insurer or scheme. Set the payer first.',
    );
  if (await PreAuth.exists({ admissionId, status: { $in: OPEN } }))
    throw new AppError(409, 'PREAUTH_EXISTS', 'This stay already has an open pre-authorisation.');
  const payer = await Payer.findById(a.payer.payerId).lean();
  const now = new Date();
  const [p] = await PreAuth.create([
    {
      admissionId,
      ipNo: a.ipNo,
      patient: { id: a.patient.id, name: a.patient.name, uhid: a.patient.uhid },
      payer: { id: payer._id, name: payer.name, kind: payer.kind },
      policyNo: a.payer.policyNo,
      memberId,
      diagnosis,
      plannedTreatment,
      requested,
      replyDueAt: new Date(now.getTime() + HOUR),
      events: [{ at: now, kind: 'SENT', amount: requested, by: await userName() }],
    },
  ]);
  await publish('ipd.preauth.sent', { preAuthId: String(p._id), ipNo: a.ipNo });
  return out(p);
}

/** The insurer's reply: approved (with amount), query (text) or denied (patient moves to cash). */
export async function recordReply(id, { outcome, amount, text }) {
  const p = await findCase(id);
  const by = await userName();
  const now = new Date();
  return withTransaction(async () => {
    if (p.status === 'FINAL_SENT') {
      if (outcome !== 'APPROVED')
        throw errors.validation([{ path: 'outcome', message: 'Record the final approved amount' }]);
      const a = await Admission.findById(p.admissionId).lean();
      const bill = await runningBill(a);
      p.finalApproved = amount;
      // Approved less than the bill: the difference is the patient's share.
      p.patientShare = Math.max(0, bill.total - amount);
      p.status = 'FINAL_APPROVED';
      p.replyDueAt = undefined;
      p.events.push({ at: now, kind: 'FINAL_APPROVED', amount, text, by });
      await p.save();
      await publish('ipd.preauth.finalApproved', {
        preAuthId: String(p._id),
        ipNo: p.ipNo,
        patientShare: p.patientShare,
      });
      return out(p, { withBill: true });
    }
    if (!['SENT', 'QUERY', 'ENHANCEMENT_SENT'].includes(p.status))
      throw new AppError(
        409,
        'INVALID_STATE',
        `This case is ${p.status.toLowerCase().replace('_', ' ')}.`,
      );
    if (outcome === 'APPROVED') {
      if (!(amount > 0))
        throw errors.validation([{ path: 'amount', message: 'Enter the approved amount' }]);
      p.approved = p.status === 'ENHANCEMENT_SENT' ? p.approved + amount : amount;
      p.status = 'APPROVED';
      p.replyDueAt = undefined;
      p.enhancementSuggestedAt = undefined;
    } else if (outcome === 'QUERY') {
      if (!text?.trim())
        throw errors.validation([{ path: 'text', message: 'Write the insurer’s query' }]);
      p.status = 'QUERY';
      p.replyDueAt = undefined;
    } else {
      // Flow F: denied; the stay becomes cash and the deposit for its category is due.
      p.status = 'DENIED';
      p.replyDueAt = undefined;
      await Admission.updateOne({ _id: p.admissionId }, { $set: { 'payer.kind': 'CASH' } });
    }
    p.events.push({ at: now, kind: outcome, amount, text, by });
    await p.save();
    await publish('ipd.preauth.reply', { preAuthId: String(p._id), ipNo: p.ipNo, outcome, amount });
    return out(p, { withBill: true });
  });
}

/** Answer to a query: the case goes back to the insurer with a fresh 1-hour clock. */
export async function answerQuery(id, { text }) {
  const p = await findCase(id);
  if (p.status !== 'QUERY') throw new AppError(409, 'INVALID_STATE', 'There is no open query.');
  p.status = 'SENT';
  p.replyDueAt = new Date(Date.now() + HOUR);
  p.events.push({ at: new Date(), kind: 'SENT', text, by: await userName() });
  await p.save();
  return out(p);
}

/** Rule R9: ask for more when the bill nears the approved amount. */
export async function requestEnhancement(id, { amount, reason }) {
  const p = await findCase(id);
  if (p.status !== 'APPROVED')
    throw new AppError(409, 'INVALID_STATE', 'Only an approved case can be enhanced.');
  p.status = 'ENHANCEMENT_SENT';
  p.replyDueAt = new Date(Date.now() + HOUR);
  p.events.push({
    at: new Date(),
    kind: 'ENHANCEMENT',
    amount,
    text: reason,
    by: await userName(),
  });
  await p.save();
  return out(p, { withBill: true });
}

/** Final bill sent for discharge approval: the 3-hour clock (IRDAI). */
export async function sendFinal(id) {
  const p = await findCase(id);
  if (p.status !== 'APPROVED')
    throw new AppError(409, 'INVALID_STATE', 'Send the final bill on an approved case.');
  const a = await Admission.findById(p.admissionId).lean();
  if (!a.billReadyAt) throw new AppError(409, 'FINAL_BILL_NEEDED', 'Make the final bill first.');
  const bill = await runningBill(a);
  p.status = 'FINAL_SENT';
  p.replyDueAt = new Date(Date.now() + 3 * HOUR);
  p.events.push({ at: new Date(), kind: 'FINAL_SENT', amount: bill.total, by: await userName() });
  await p.save();
  return out(p, { withBill: true });
}

export async function fileClaim(id, { claimNo }) {
  const p = await findCase(id);
  if (p.status !== 'FINAL_APPROVED')
    throw new AppError(409, 'INVALID_STATE', 'File the claim after final approval.');
  p.status = 'CLAIMED';
  p.claim = { no: claimNo, filedAt: new Date() };
  p.events.push({ at: new Date(), kind: 'CLAIMED', text: claimNo, by: await userName() });
  await p.save();
  return out(p);
}

/** Settlement matched to the claim; short payment is recorded as deductions. */
export async function settle(id, { amount, utr, deductions = [] }) {
  const p = await findCase(id);
  if (p.status !== 'CLAIMED')
    throw new AppError(409, 'INVALID_STATE', 'Record the settlement after the claim is filed.');
  const short = (p.finalApproved ?? 0) - amount;
  const listed = deductions.reduce((s, d) => s + d.amount, 0);
  if (short > 0 && listed !== short)
    throw errors.validation([
      {
        path: 'deductions',
        message: `List the deductions: ₹${(short / 100).toLocaleString('en-IN')} short of the approval`,
      },
    ]);
  p.status = 'SETTLED';
  p.settled = amount;
  p.deductions = deductions;
  p.settlement = { utr, at: new Date() };
  p.events.push({ at: new Date(), kind: 'SETTLED', amount, text: utr, by: await userName() });
  await p.save();
  await publish('ipd.claim.settled', {
    preAuthId: String(p._id),
    amount,
    short: Math.max(0, short),
  });
  return out(p);
}

/** TPA desk worklist: open cases, overdue replies first, then those due an enhancement. */
export async function listCases({ open = true, status } = {}) {
  const filter = status
    ? { status: { $in: status.split(',') } }
    : open
      ? { status: { $in: OPEN } }
      : {};
  const items = await PreAuth.find(filter).sort({ updatedAt: -1 }).limit(200);
  const rows = [];
  for (const p of items) rows.push(await out(p, { withBill: true }));
  rows.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) || Number(b.enhancementDue) - Number(a.enhancementDue),
  );
  return { items: rows, total: rows.length, page: 1, limit: 200 };
}

export async function getCase(id) {
  return out(await findCase(id), { withBill: true });
}

/** No insurer reply within the hour: tell the desk to escalate (job every 15 minutes). */
export async function overdueReplies(now = new Date()) {
  // Only the cases whose clock ran out since the last run, so the desk is told once.
  const since = new Date(now.getTime() - 15 * 60_000);
  const due = await PreAuth.find({
    status: { $in: ['SENT', 'ENHANCEMENT_SENT', 'FINAL_SENT'] },
    replyDueAt: { $lt: now, $gte: since },
  }).lean();
  for (const p of due)
    await publish('ipd.preauth.overdue', {
      preAuthId: String(p._id),
      ipNo: p.ipNo,
      payer: p.payer.name,
    });
  return due.length;
}

/** Overdue insurer replies in every hospital (worker job, every 15 minutes). */
export async function sweepOverdueReplies(now = new Date()) {
  const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } })
    .select('_id')
    .lean();
  let n = 0;
  for (const t of tenants)
    n += await runAsSystem(t._id, () => overdueReplies(now), {
      userName: 'system: insurer replies',
    });
  return { overdue: n };
}
