import { randomUUID } from 'node:crypto';
import { withTransaction } from '../../core/db/model.js';
import { publish } from '../../core/events/events.js';
import { AppError, errors } from '../../core/errors/index.js';
import { User } from '../../core/auth/models/user.model.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { current, runAsSystem } from '../../core/tenancy/context.js';
import { Bill, getBill } from '../billing/index.js';
import { Admission, syncStayBill } from '../ipd/index.js';
import { Payer } from '../setup/index.js';
import { HbpPackage, PmjayCase, PmjaySettings } from './models.js';
import { clock, missingDocuments, STANDARD_DOCUMENTS } from './rules.js';
import { claimBundle, claimResponse, readDecision } from './nhcx/fhir.js';
import { send } from './nhcx/gateway.js';

const ACTIVE = [
  'REGISTERED',
  'PREAUTH_SENT',
  'PREAUTH_QUERY',
  'PREAUTH_APPROVED',
  'DISCHARGED',
  'CLAIM_SUBMITTED',
  'CLAIM_QUERY',
  'CLAIM_APPROVED',
];
/** Clocks that run against the hospital (the others run against the payer). */
const OURS = new Set([
  'PREAUTH_INITIATE',
  'PREAUTH_QUERY_REPLY',
  'CLAIM_SUBMIT',
  'CLAIM_QUERY_REPLY',
]);

const userName = async () =>
  (current().userId && (await User.findById(current().userId).select('name').lean())?.name) ||
  current().userName ||
  'System';

const state = (s) => s.toLowerCase().replace(/_/g, ' ');
const invalid = (c, what) =>
  new AppError(409, 'INVALID_STATE', `${what} (this case is ${state(c.status)}).`);
const sum = (pkgs) => pkgs.reduce((s, p) => s + (p.rate ?? 0), 0);

// ---------------------------------------------------------------- settings

export async function settingsDoc() {
  return (await PmjaySettings.findOne()) ?? (await PmjaySettings.create([{}]))[0];
}

const settingsOut = (s) => ({
  hospitalType: s.hospitalType,
  stateCode: s.stateCode ?? null,
  hospitalCode: s.hospitalCode ?? null,
  hfrId: s.hfrId ?? null,
  payerId: s.payerId ? String(s.payerId) : null,
  channel: s.channel,
  nhcx: {
    mode: s.nhcx?.mode ?? 'MOCK',
    participantCode: s.nhcx?.participantCode ?? null,
    payerCode: s.nhcx?.payerCode ?? null,
  },
  standardDocuments: STANDARD_DOCUMENTS,
});

export async function getSettings() {
  return settingsOut(await settingsDoc());
}

export async function saveSettings(body) {
  const s = await settingsDoc();
  if (body.payerId) {
    const p = await Payer.findById(body.payerId).lean();
    if (!p || p.kind !== 'GOVT_SCHEME')
      throw errors.validation([
        { path: 'payerId', message: 'Pick the government scheme payer that stands for PM-JAY' },
      ]);
  }
  const { nhcx, ...rest } = body;
  s.set(rest);
  if (nhcx) s.set('nhcx', { ...(s.nhcx?.toObject?.() ?? {}), ...nhcx });
  await s.save();
  return settingsOut(s);
}

/** The PM-JAY payer, created on first use so a new hospital can start at once. */
async function schemePayer(s) {
  if (s.payerId) {
    const p = await Payer.findById(s.payerId).lean();
    if (p) return p;
  }
  let p = await Payer.findOne({ code: 'PMJAY' }).lean();
  if (!p)
    [p] = await Payer.create([
      { code: 'PMJAY', name: 'Ayushman Bharat PM-JAY', kind: 'GOVT_SCHEME' },
    ]);
  s.payerId = p._id;
  await s.save();
  return p;
}

// ---------------------------------------------------------------- packages (HBP master)

const pkgOut = (p) => ({
  id: String(p._id),
  code: p.code,
  name: p.name,
  specialty: p.specialty,
  rate: p.rate,
  stayDays: p.stayDays,
  preauthRequired: p.preauthRequired,
  reservedForPublic: p.reservedForPublic,
  documents: { preauth: p.documents?.preauth ?? [], claim: p.documents?.claim ?? [] },
  isActive: p.isActive,
});

export async function listPackages({ q, specialty, active = true }) {
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const filter = {
    ...(active ? { isActive: true } : {}),
    ...(specialty ? { specialty } : {}),
    ...(rx ? { $or: [{ code: rx }, { name: rx }] } : {}),
  };
  const items = await HbpPackage.find(filter).sort({ specialty: 1, code: 1 }).limit(500).lean();
  const specialties = await HbpPackage.distinct('specialty', { isActive: true });
  return { items: items.map(pkgOut), total: items.length, specialties: specialties.sort() };
}

export async function savePackage(body, id) {
  try {
    if (id) {
      const p = await HbpPackage.findById(id);
      if (!p) throw errors.notFound('Package');
      p.set(body);
      await p.save();
      return pkgOut(p);
    }
    return pkgOut((await HbpPackage.create([body]))[0]);
  } catch (e) {
    if (e?.code === 11000)
      throw new AppError(409, 'DUPLICATE', `Package ${body.code} is already in the list`);
    throw e;
  }
}

/** Upload of the State Health Agency's rate list: adds new codes and updates the rest. */
export async function importPackages({ rows }) {
  let added = 0;
  let updated = 0;
  for (const r of rows) {
    const code = r.code.toUpperCase();
    const p = await HbpPackage.findOne({ code });
    if (!p) {
      await HbpPackage.create([{ ...r, code }]);
      added++;
      continue;
    }
    const was = p.toObject();
    const same = Object.entries(r).every(
      ([k, v]) => k === 'code' || JSON.stringify(was[k]) === JSON.stringify(v),
    );
    if (same) continue;
    p.set({ ...r, code });
    await p.save();
    updated++;
  }
  return { added, updated, total: rows.length };
}

// ---------------------------------------------------------------- cases

const caseOut = (c, s) => {
  const overdue = Boolean(c.dueAt && c.dueAt < new Date() && ACTIVE.includes(c.status));
  return {
    id: String(c._id),
    admissionId: String(c.admissionId),
    ipNo: c.ipNo,
    patient: { id: String(c.patient.id), name: c.patient.name, uhid: c.patient.uhid },
    beneficiary: {
      pmjayId: c.beneficiary.pmjayId,
      name: c.beneficiary.name ?? null,
      familyId: c.beneficiary.familyId ?? null,
      abha: c.beneficiary.abha ?? null,
      verification: c.beneficiary.verification ?? null,
    },
    packages: (c.packages ?? []).map((p) => ({
      packageId: String(p.packageId),
      code: p.code,
      name: p.name,
      specialty: p.specialty,
      rate: p.rate,
      preauthRequired: p.preauthRequired,
    })),
    packageTotal: sum(c.packages ?? []),
    diagnosis: c.diagnosis ?? null,
    plannedTreatment: c.plannedTreatment ?? null,
    channel: c.channel,
    status: c.status,
    dueAt: c.dueAt ?? null,
    dueKind: c.dueKind ?? null,
    overdue,
    /** Our own clock ran out: the scheme auto-rejects. Theirs: the desk escalates. */
    atRisk: overdue && OURS.has(c.dueKind),
    tms: c.tms ?? {},
    nhcx: { correlationId: c.nhcx?.correlationId ?? null, calls: c.nhcx?.calls ?? [] },
    amounts: c.amounts,
    deductions: c.deductions ?? [],
    payment: c.payment?.utr ? c.payment : null,
    outcome: c.outcome ?? null,
    dischargedAt: c.dischargedAt ?? null,
    documents: (c.documents ?? []).map((d) => ({
      id: String(d._id),
      stage: d.stage,
      name: d.name,
      fileId: d.fileId,
      at: d.at,
      by: d.by,
    })),
    missing: s
      ? {
          preauth: missingDocuments(c, 'PREAUTH'),
          claim: missingDocuments(c, 'CLAIM'),
        }
      : undefined,
    events: c.events ?? [],
  };
};

async function findCase(id) {
  const c = await PmjayCase.findById(id);
  if (!c) throw errors.notFound('PM-JAY case');
  return c;
}

/** The stay left the hospital: the claim clock starts (also run by the ipd.discharged event). */
async function noteDischarge(c, s) {
  if (!['PREAUTH_APPROVED', 'PREAUTH_SENT', 'PREAUTH_QUERY'].includes(c.status)) return false;
  const a = await Admission.findById(c.admissionId).select('status outcome leftAt').lean();
  if (a?.status !== 'DISCHARGED') return false;
  c.outcome = a.outcome;
  c.dischargedAt = a.leftAt ?? new Date();
  if (c.status === 'PREAUTH_APPROVED') {
    c.status = 'DISCHARGED';
    c.dueKind = 'CLAIM_SUBMIT';
    c.dueAt = clock(s.hospitalType, 'CLAIM_SUBMIT', c.dischargedAt);
  }
  c.events.push({ at: c.dischargedAt, kind: 'DISCHARGED', text: a.outcome, by: 'System' });
  await c.save();
  return true;
}

export async function onDischarged({ admissionId }) {
  const c = await PmjayCase.findOne({ admissionId, status: { $in: ACTIVE } });
  if (c) await noteDischarge(c, await settingsDoc());
}

/**
 * The Ayushman Mitra registers a verified beneficiary on a stay. The stay is moved to the
 * PM-JAY payer: no deposit, nothing collected from the patient, the bill becomes the package.
 */
export async function registerCase({ admissionId, beneficiary, channel }) {
  const s = await settingsDoc();
  const a = await Admission.findById(admissionId);
  if (!a) throw errors.notFound('Admission');
  if (a.status === 'DISCHARGED')
    throw new AppError(409, 'INVALID_STATE', 'This patient has already left the hospital.');
  if (await PmjayCase.exists({ admissionId, status: { $in: ACTIVE } }))
    throw new AppError(409, 'CASE_EXISTS', 'This stay already has a PM-JAY case.');
  if (!beneficiary.verification?.method)
    throw errors.validation([
      {
        path: 'beneficiary.verification.method',
        message: 'Verify the beneficiary (Aadhaar OTP, biometric or fallback)',
      },
    ]);
  const payer = await schemePayer(s);
  const by = await userName();
  const now = new Date();
  return withTransaction(async () => {
    a.payer = {
      kind: 'SCHEME',
      payerId: payer._id,
      name: payer.name,
      policyNo: beneficiary.pmjayId,
    };
    await a.save();
    // The running bill now goes to the scheme (patient pays nothing).
    if (a.billId)
      await Bill.updateOne(
        { _id: a.billId, status: 'DRAFT' },
        { $set: { 'payer.kind': 'SCHEME', 'payer.payerId': payer._id, 'payer.name': payer.name } },
      );
    const [c] = await PmjayCase.create([
      {
        admissionId: a._id,
        ipNo: a.ipNo,
        patient: {
          id: a.patient.id,
          name: a.patient.name,
          uhid: a.patient.uhid,
          mobile: a.patient.mobile,
        },
        beneficiary: { ...beneficiary, verification: { ...beneficiary.verification, at: now, by } },
        channel: channel ?? s.channel,
        status: 'REGISTERED',
        dueKind: 'PREAUTH_INITIATE',
        dueAt: clock(s.hospitalType, 'PREAUTH_INITIATE', now),
        nhcx: { correlationId: randomUUID(), calls: [] },
        events: [{ at: now, kind: 'REGISTERED', text: beneficiary.pmjayId, by }],
      },
    ]);
    await publish('pmjay.case.registered', { caseId: String(c._id), ipNo: a.ipNo });
    return caseOut(c, s);
  });
}

/** Packages (HBP codes) for the stay; the IP bill is re-written to the package rates. */
export async function setPackages(id, { packageIds, diagnosis, plannedTreatment }) {
  const s = await settingsDoc();
  const c = await findCase(id);
  if (!['REGISTERED', 'PREAUTH_QUERY'].includes(c.status))
    throw invalid(c, 'Packages change before the pre-authorisation is sent or while it is queried');
  const pkgs = await HbpPackage.find({ _id: { $in: packageIds }, isActive: true }).lean();
  if (pkgs.length !== new Set(packageIds.map(String)).size)
    throw errors.validation([
      { path: 'packageIds', message: 'A package is not in the hospital’s list' },
    ]);
  if (s.hospitalType === 'PRIVATE') {
    const reserved = pkgs.filter((p) => p.reservedForPublic);
    if (reserved.length)
      throw new AppError(
        409,
        'PACKAGE_RESERVED',
        `${reserved.map((p) => p.code).join(', ')} is reserved for public hospitals.`,
      );
  }
  c.packages = pkgs.map((p) => ({
    packageId: p._id,
    code: p.code,
    name: p.name,
    specialty: p.specialty,
    rate: p.rate,
    preauthRequired: p.preauthRequired,
    documents: p.documents,
  }));
  if (diagnosis !== undefined) c.diagnosis = diagnosis;
  if (plannedTreatment !== undefined) c.plannedTreatment = plannedTreatment;
  c.amounts.preauthRequested = sum(c.packages);
  c.events.push({
    at: new Date(),
    kind: 'PACKAGES',
    amount: c.amounts.preauthRequested,
    text: c.packages.map((p) => p.code).join(', '),
    by: await userName(),
  });
  await c.save();
  await syncStayBill(c.admissionId);
  return caseOut(c, s);
}

export async function addDocument(id, { stage, name, fileId }) {
  const c = await findCase(id);
  if (['PAID', 'CANCELLED', 'CLAIM_REJECTED', 'PREAUTH_REJECTED'].includes(c.status))
    throw invalid(c, 'Documents cannot be added now');
  c.documents = c.documents.filter(
    (d) => d.name.toLowerCase() !== name.trim().toLowerCase() || d.stage !== stage,
  );
  c.documents.push({ stage, name: name.trim(), fileId, at: new Date(), by: await userName() });
  await c.save();
  return caseOut(c, await settingsDoc());
}

async function nhcxSend(c, s, action) {
  const bill =
    action === 'claim'
      ? await getBill((await Admission.findById(c.admissionId).lean()).billId)
      : null;
  const bundle = claimBundle({
    use: action === 'claim' ? 'claim' : 'preauthorization',
    c,
    settings: s,
    bill: bill?.totals,
  });
  const r = await send({ action, bundle, settings: s, correlationId: c.nhcx.correlationId });
  c.nhcx.calls.push({ action, apiCallId: r.apiCallId, at: new Date(), status: r.status });
}

/** Pre-authorisation request (TMS: the number TMS gave; NHCX: sent over the exchange). */
export async function submitPreauth(id, { tmsRegistrationId, tmsPreauthNo } = {}) {
  const s = await settingsDoc();
  const c = await findCase(id);
  if (c.status !== 'REGISTERED')
    throw invalid(c, 'Send the pre-authorisation on a registered case');
  if (!c.packages.length)
    throw errors.validation([{ path: 'packages', message: 'Choose the package(s) first' }]);
  const missing = missingDocuments(c, 'PREAUTH');
  if (missing.length)
    throw new AppError(
      422,
      'DOCUMENTS_MISSING',
      `Upload: ${missing.join(', ')}`,
      missing.map((m) => ({ path: 'documents', message: m })),
    );
  if (c.channel === 'TMS' && !tmsPreauthNo)
    throw errors.validation([
      { path: 'tmsPreauthNo', message: 'Enter the pre-auth number TMS gave' },
    ]);
  const by = await userName();
  const now = new Date();
  if (c.channel === 'NHCX') await nhcxSend(c, s, 'preauth');
  if (tmsRegistrationId) c.tms.registrationId = tmsRegistrationId;
  if (tmsPreauthNo) c.tms.preauthNo = tmsPreauthNo;
  c.events.push({
    at: now,
    kind: 'PREAUTH_SENT',
    amount: c.amounts.preauthRequested,
    text: c.channel,
    by,
  });
  // Auto-approved packages (no pre-auth needed) go straight to treatment.
  if (c.packages.every((p) => p.preauthRequired === false)) {
    c.status = 'PREAUTH_APPROVED';
    c.amounts.preauthApproved = c.amounts.preauthRequested;
    c.dueAt = undefined;
    c.dueKind = undefined;
    c.events.push({
      at: now,
      kind: 'PREAUTH_APPROVED',
      amount: c.amounts.preauthApproved,
      text: 'Auto-approved package',
      by: 'System',
    });
  } else {
    c.status = 'PREAUTH_SENT';
    c.dueKind = 'PREAUTH_DECISION';
    c.dueAt = clock(s.hospitalType, 'PREAUTH_DECISION', now);
  }
  await c.save();
  await publish('pmjay.preauth.sent', { caseId: String(c._id), ipNo: c.ipNo });
  return caseOut(c, s);
}

/** The payer's decision on the pre-authorisation (typed from TMS, or from an NHCX callback). */
export async function preauthDecision(id, { outcome, amount, text, preauthNo }, by) {
  const s = await settingsDoc();
  const c = await findCase(id);
  if (c.status !== 'PREAUTH_SENT') throw invalid(c, 'There is no pre-authorisation waiting');
  const now = new Date();
  by ??= await userName();
  return withTransaction(async () => {
    if (preauthNo) c.tms.preauthNo = preauthNo;
    if (outcome === 'APPROVED') {
      c.status = 'PREAUTH_APPROVED';
      c.amounts.preauthApproved = amount ?? c.amounts.preauthRequested;
      c.dueAt = undefined;
      c.dueKind = undefined;
    } else if (outcome === 'QUERY') {
      if (!text?.trim())
        throw errors.validation([{ path: 'text', message: 'Write the query raised' }]);
      c.status = 'PREAUTH_QUERY';
      c.dueKind = 'PREAUTH_QUERY_REPLY';
      c.dueAt = clock(s.hospitalType, 'PREAUTH_QUERY_REPLY', now);
    } else {
      // Rejected: the stay goes back to cash and the itemised bill.
      c.status = 'PREAUTH_REJECTED';
      c.dueAt = undefined;
      c.dueKind = undefined;
      await toCash(c);
    }
    c.events.push({ at: now, kind: `PREAUTH_${outcome}`, amount, text, by });
    await c.save();
    await publish('pmjay.preauth.decided', { caseId: String(c._id), ipNo: c.ipNo, outcome });
    if (outcome === 'REJECTED') await syncStayBill(c.admissionId);
    else await noteDischarge(c, s);
    return caseOut(c, s);
  });
}

async function toCash(c) {
  const a = await Admission.findById(c.admissionId);
  if (!a) return;
  a.payer = { kind: 'CASH' };
  await a.save();
  if (a.billId)
    await Bill.updateOne(
      { _id: a.billId, status: 'DRAFT' },
      { $set: { 'payer.kind': 'CASH' }, $unset: { 'payer.payerId': 1, 'payer.name': 1 } },
    );
}

export async function answerPreauthQuery(id, { text }) {
  const s = await settingsDoc();
  const c = await findCase(id);
  if (c.status !== 'PREAUTH_QUERY') throw invalid(c, 'There is no open query');
  if (c.channel === 'NHCX') await nhcxSend(c, s, 'preauth');
  c.status = 'PREAUTH_SENT';
  c.dueKind = 'PREAUTH_DECISION';
  c.dueAt = clock(s.hospitalType, 'PREAUTH_DECISION');
  c.events.push({ at: new Date(), kind: 'QUERY_ANSWERED', text, by: await userName() });
  await c.save();
  return caseOut(c, s);
}

/** Claim after discharge: the final bill (package rates) and the discharge documents. */
export async function submitClaim(id, { tmsClaimNo } = {}) {
  const s = await settingsDoc();
  const c = await findCase(id);
  await noteDischarge(c, s);
  if (c.status !== 'DISCHARGED')
    throw invalid(c, 'The claim is filed after an approved stay is discharged');
  const a = await Admission.findById(c.admissionId).lean();
  const bill = await getBill(a.billId);
  if (bill.status === 'DRAFT')
    throw new AppError(409, 'FINAL_BILL_NEEDED', 'Make the final bill first.');
  const missing = missingDocuments(c, 'CLAIM');
  if (missing.length)
    throw new AppError(
      422,
      'DOCUMENTS_MISSING',
      `Upload: ${missing.join(', ')}`,
      missing.map((m) => ({ path: 'documents', message: m })),
    );
  if (c.channel === 'TMS' && !tmsClaimNo)
    throw errors.validation([{ path: 'tmsClaimNo', message: 'Enter the claim number TMS gave' }]);
  if (c.channel === 'NHCX') await nhcxSend(c, s, 'claim');
  if (tmsClaimNo) c.tms.claimNo = tmsClaimNo;
  const now = new Date();
  c.amounts.claimed = bill.totals.total;
  c.status = 'CLAIM_SUBMITTED';
  c.dueKind = 'CLAIM_PAYMENT';
  c.dueAt = clock(s.hospitalType, 'CLAIM_PAYMENT', now);
  c.events.push({
    at: now,
    kind: 'CLAIM_SUBMITTED',
    amount: c.amounts.claimed,
    text: tmsClaimNo ?? c.channel,
    by: await userName(),
  });
  await c.save();
  await publish('pmjay.claim.submitted', {
    caseId: String(c._id),
    ipNo: c.ipNo,
    amount: c.amounts.claimed,
  });
  return caseOut(c, s);
}

export async function claimDecision(id, { outcome, amount, text, deductions = [] }, by) {
  const s = await settingsDoc();
  const c = await findCase(id);
  if (c.status !== 'CLAIM_SUBMITTED') throw invalid(c, 'There is no claim waiting');
  const now = new Date();
  by ??= await userName();
  if (outcome === 'APPROVED') {
    c.status = 'CLAIM_APPROVED';
    c.amounts.claimApproved = amount ?? c.amounts.claimed;
    c.deductions = deductions.length
      ? deductions
      : c.amounts.claimApproved < c.amounts.claimed
        ? [
            {
              reason: text || 'Deducted by the payer',
              amount: c.amounts.claimed - c.amounts.claimApproved,
            },
          ]
        : [];
    // Payment clock keeps running from submission.
  } else if (outcome === 'QUERY') {
    if (!text?.trim())
      throw errors.validation([{ path: 'text', message: 'Write the query raised' }]);
    c.status = 'CLAIM_QUERY';
    c.dueKind = 'CLAIM_QUERY_REPLY';
    c.dueAt = clock(s.hospitalType, 'CLAIM_QUERY_REPLY', now);
  } else {
    c.status = 'CLAIM_REJECTED';
    c.dueAt = undefined;
    c.dueKind = undefined;
  }
  c.events.push({ at: now, kind: `CLAIM_${outcome}`, amount, text, by });
  await c.save();
  await publish('pmjay.claim.decided', { caseId: String(c._id), ipNo: c.ipNo, outcome, amount });
  return caseOut(c, s);
}

export async function answerClaimQuery(id, { text }) {
  const s = await settingsDoc();
  const c = await findCase(id);
  if (c.status !== 'CLAIM_QUERY') throw invalid(c, 'There is no open claim query');
  if (c.channel === 'NHCX') await nhcxSend(c, s, 'claim');
  c.status = 'CLAIM_SUBMITTED';
  c.dueKind = 'CLAIM_PAYMENT';
  c.dueAt = clock(s.hospitalType, 'CLAIM_PAYMENT');
  c.events.push({ at: new Date(), kind: 'QUERY_ANSWERED', text, by: await userName() });
  await c.save();
  return caseOut(c, s);
}

/**
 * Money received from the State Health Agency: it settles the IP bill; the approved shortfall
 * (deductions) is written off on the bill, never charged to the beneficiary.
 */
export async function recordPayment(id, { amount, utr }) {
  const s = await settingsDoc();
  const c = await findCase(id);
  if (c.status !== 'CLAIM_APPROVED') throw invalid(c, 'Record the payment on an approved claim');
  if (amount > c.amounts.claimApproved)
    throw errors.validation([{ path: 'amount', message: 'More than the approved claim' }]);
  return withTransaction(async () => {
    const a = await Admission.findById(c.admissionId).lean();
    const bill = await Bill.findById(a.billId);
    const writeOff = Math.max(0, bill.totals.balance - amount);
    bill.totals.paid += amount;
    bill.totals.balance = 0;
    bill.schemePaid = (bill.schemePaid ?? 0) + amount;
    bill.schemeWriteOff = (bill.schemeWriteOff ?? 0) + writeOff;
    bill.status = 'PAID';
    await bill.save();
    const short = c.amounts.claimApproved - amount;
    if (short > 0)
      c.deductions.push({ reason: 'Paid less than approved (TDS / recovery)', amount: short });
    c.amounts.paid = amount;
    c.payment = { utr, at: new Date() };
    c.status = 'PAID';
    c.dueAt = undefined;
    c.dueKind = undefined;
    c.events.push({ at: new Date(), kind: 'PAID', amount, text: utr, by: await userName() });
    await c.save();
    await publish('pmjay.claim.paid', {
      caseId: String(c._id),
      ipNo: c.ipNo,
      billId: String(bill._id),
      amount,
      writeOff,
      utr,
    });
    return caseOut(c, s);
  });
}

/** A case registered by mistake: only before the pre-authorisation goes out. */
export async function cancelCase(id, { reason }) {
  const s = await settingsDoc();
  const c = await findCase(id);
  if (c.status !== 'REGISTERED') throw invalid(c, 'Only a registered case can be cancelled');
  return withTransaction(async () => {
    c.status = 'CANCELLED';
    c.dueAt = undefined;
    c.dueKind = undefined;
    c.events.push({ at: new Date(), kind: 'CANCELLED', text: reason, by: await userName() });
    await c.save();
    await toCash(c);
    await syncStayBill(c.admissionId);
    return caseOut(c, s);
  });
}

export async function listCases({ status, overdue, q, open = true }) {
  const s = await settingsDoc();
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const filter = {
    ...(status ? { status: { $in: status.split(',') } } : open ? { status: { $in: ACTIVE } } : {}),
    ...(overdue ? { dueAt: { $lt: new Date() } } : {}),
    ...(rx ? { $or: [{ ipNo: rx }, { 'patient.name': rx }, { 'beneficiary.pmjayId': rx }] } : {}),
  };
  const items = await PmjayCase.find(filter).sort({ dueAt: 1, updatedAt: -1 }).limit(200);
  for (const c of items) await noteDischarge(c, s);
  const rows = items.map((c) => caseOut(c));
  rows.sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || Number(b.overdue) - Number(a.overdue));
  return { items: rows, total: rows.length, page: 1, limit: 200 };
}

export async function getCase(id) {
  const s = await settingsDoc();
  const c = await findCase(id);
  await noteDischarge(c, s);
  return caseOut(c, s);
}

/** In-patients without a live PM-JAY case: the stays the Ayushman Mitra can register. */
export async function eligibleStays({ q }) {
  const taken = await PmjayCase.distinct('admissionId', { status: { $in: ACTIVE } });
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const stays = await Admission.find({
    status: { $in: ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'] },
    _id: { $nin: taken },
    ...(rx ? { $or: [{ ipNo: rx }, { 'patient.name': rx }, { 'patient.uhid': rx }] } : {}),
  })
    .sort({ admittedAt: -1 })
    .limit(50)
    .select('ipNo patient bed payer admittedAt reason')
    .lean();
  return {
    items: stays.map((a) => ({
      admissionId: String(a._id),
      ipNo: a.ipNo,
      patient: {
        id: String(a.patient.id),
        name: a.patient.name,
        uhid: a.patient.uhid,
        mobile: a.patient.mobile,
      },
      bed: a.bed ? `${a.bed.ward} ${a.bed.code}` : null,
      payer: a.payer?.kind ?? 'CASH',
      reason: a.reason,
      admittedAt: a.admittedAt,
    })),
  };
}

export async function caseForAdmission(admissionId) {
  const c = await PmjayCase.findOne({ admissionId }).sort({ createdAt: -1 });
  return c ? caseOut(c, await settingsDoc()) : null;
}

/** Desk dashboard: work by status, clocks at risk, and money claimed against money received. */
export async function summary() {
  const rows = await PmjayCase.aggregate([
    {
      $group: {
        _id: '$status',
        n: { $sum: 1 },
        claimed: { $sum: '$amounts.claimed' },
        approved: { $sum: '$amounts.claimApproved' },
        paid: { $sum: '$amounts.paid' },
      },
    },
  ]);
  const overdue = await PmjayCase.countDocuments({
    status: { $in: ACTIVE },
    dueAt: { $lt: new Date() },
  });
  const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
  const deductions = await PmjayCase.aggregate([
    { $unwind: '$deductions' },
    { $group: { _id: null, amount: { $sum: '$deductions.amount' } } },
  ]);
  return {
    byStatus,
    open: ACTIVE.reduce((s, k) => s + (byStatus[k] ?? 0), 0),
    overdue,
    claimed: tot('claimed'),
    approved: tot('approved'),
    paid: tot('paid'),
    outstanding: rows
      .filter((r) => ['CLAIM_SUBMITTED', 'CLAIM_QUERY', 'CLAIM_APPROVED'].includes(r._id))
      .reduce((s, r) => s + (r._id === 'CLAIM_APPROVED' ? r.approved : r.claimed), 0),
    deductions: deductions[0]?.amount ?? 0,
  };
}

/** The FHIR bundle the case would send to NHCX now (for checking before go-live). */
export async function fhirPreview(id, { use }) {
  const s = await settingsDoc();
  const c = await findCase(id);
  const a = await Admission.findById(c.admissionId).lean();
  const bill = use === 'claim' && a?.billId ? await getBill(a.billId) : null;
  return claimBundle({ use, c, settings: s, bill: bill?.totals });
}

// ---------------------------------------------------------------- NHCX callbacks

/** An `on_submit` from NHCX (already decrypted): applies the payer's decision to the case. */
export async function applyCallback({ correlationId, bundle }) {
  const c = await PmjayCase.findOne({ 'nhcx.correlationId': correlationId });
  if (!c) throw errors.notFound('PM-JAY case');
  const d = readDecision(bundle);
  if (!d) throw errors.validation([{ path: 'payload', message: 'No ClaimResponse in the bundle' }]);
  const by = 'NHCX';
  return d.use === 'claim'
    ? claimDecision(c._id, { outcome: d.outcome, amount: d.amount, text: d.text }, by)
    : preauthDecision(
        c._id,
        { outcome: d.outcome, amount: d.amount, text: d.text, preauthNo: d.ref },
        by,
      );
}

/** MOCK mode only: plays the payer, through the same callback path as the real exchange. */
export async function mockResponse(id, { use, outcome, amount, text }) {
  const s = await settingsDoc();
  if (s.nhcx?.mode !== 'MOCK')
    throw new AppError(409, 'NOT_MOCK', 'The payer is simulated only in NHCX mock mode.');
  const c = await findCase(id);
  if (c.channel !== 'NHCX') throw new AppError(409, 'NOT_NHCX', 'This case is filed through TMS.');
  const fhirOutcome = { APPROVED: 'complete', QUERY: 'queued', REJECTED: 'error' }[outcome];
  const bundle = claimResponse({
    use: use === 'claim' ? 'claim' : 'preauthorization',
    outcome: fhirOutcome,
    amount,
    text,
    preauthRef: use === 'claim' ? undefined : `MOCK-PA-${c.ipNo}`,
  });
  return applyCallback({ correlationId: c.nhcx.correlationId, bundle });
}

// ---------------------------------------------------------------- clocks

/** Clocks that ran out since the last run: tell the desk once (worker, every 15 minutes). */
export async function overdueClocks(now = new Date()) {
  const since = new Date(now.getTime() - 15 * 60_000);
  const due = await PmjayCase.find({
    status: { $in: ACTIVE },
    dueAt: { $lt: now, $gte: since },
  }).lean();
  for (const c of due)
    await publish('pmjay.clock.overdue', {
      caseId: String(c._id),
      ipNo: c.ipNo,
      dueKind: c.dueKind,
    });
  return due.length;
}

export async function sweepClocks(now = new Date()) {
  const tenants = await Tenant.find({ status: { $ne: 'CLOSED' }, 'modules.code': 'PMJ' })
    .select('_id')
    .lean();
  let n = 0;
  for (const t of tenants)
    n += await runAsSystem(t._id, () => overdueClocks(now), { userName: 'system: PM-JAY clocks' });
  return { overdue: n };
}
