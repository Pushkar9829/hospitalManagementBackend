import {
  DUPLICATE_THRESHOLD,
  ageLabel,
  duplicateScore,
  estimatedDob,
  fullName,
  isMinor,
  isSeniorCitizen,
  maskAadhaar,
  nameKey,
} from '@hms/shared';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { withTransaction } from '../../../core/db/model.js';
import { redis } from '../../../core/cache/redis.js';
import { publish } from '../../../core/events/events.js';
import { recordAudit } from '../../../core/audit/audit.service.js';
import { sha256 } from '../../../core/security/crypto.js';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { numbering } from '../../setup/index.js';
import { Patient } from '../models/patient.model.js';

const ACCESS_LOG_WINDOW_SEC = 600;

// ---------------------------------------------------------------- extension points

const timelineSources = [];
const mergeHandlers = [];

/** Modules add their records to the patient timeline: async (patientId) => [{ at, type, title, ref }]. */
export function registerPatientTimelineSource(source) {
  timelineSources.push(source);
}

/** Modules move their records when two UHIDs merge: async (fromId, toId) inside the transaction. */
export function registerPatientMergeHandler(handler) {
  mergeHandlers.push(handler);
}

// ---------------------------------------------------------------- mapping

const digits = (s) => String(s ?? '').replace(/\D/g, '');

/** Salted per hospital so the same Aadhaar cannot be matched across hospitals. */
function idHash(type, number) {
  const n =
    type === 'AADHAAR' ? digits(number) : String(number).toUpperCase().replace(/[\s-]/g, '');
  return sha256(`${current().tenantId}:${type}:${n}`);
}

function storeIds(ids = []) {
  return {
    ids: ids.map((d) =>
      d.type === 'AADHAAR'
        ? { type: d.type, last4: digits(d.number).slice(-4), fileId: d.fileId }
        : { type: d.type, number: d.number, last4: String(d.number).slice(-4), fileId: d.fileId },
    ),
    idHashes: ids.map((d) => idHash(d.type, d.number)),
  };
}

const tokens = (name) => [
  ...new Set(
    nameKey(fullName({ first: name.first, middle: name.middle, last: name.last }))
      .split(' ')
      .filter(Boolean),
  ),
];

function toDocument(input) {
  const {
    birth,
    ids,
    abhaNumber,
    abhaAddress,
    allergies,
    registrationType: _r,
    confirmNotDuplicate: _c,
    version: _v,
    ...rest
  } = input;
  const dob = birth.dob ? new Date(birth.dob) : estimatedDob(birth.age);
  const c = current();
  return {
    ...rest,
    dob,
    dobEstimated: !birth.dob,
    ...storeIds(ids),
    abha:
      abhaNumber || abhaAddress
        ? { number: abhaNumber?.replace(/-/g, ''), address: abhaAddress }
        : undefined,
    allergies: (allergies ?? []).map((a) => ({
      ...a,
      recordedAt: new Date(),
      recordedBy: c.userId,
    })),
    nameTokens: tokens(input.name),
  };
}

/** Business rules beyond field validation (spec 5.4 and the UI/UX review). */
function checkRules(doc, registrationType) {
  const details = [];
  if (doc.category === 'SENIOR' && !isSeniorCitizen(doc.dob))
    details.push({ path: 'category', message: 'Senior citizen category needs age 60 or more' });
  if (registrationType === 'FULL' && isMinor(doc.dob) && !doc.guardian)
    details.push({ path: 'guardian', message: 'Add a parent or guardian for a patient under 18' });
  if (details.length) throw errors.validation(details);
}

/** Fields a quick registration still lacks (shown as "to complete"). */
function missingFields(p) {
  const missing = [];
  if (!p.address?.line1 && !p.address?.city) missing.push('address');
  if (!p.emergencyContact?.mobile) missing.push('emergencyContact');
  if (!p.ids?.length) missing.push('ids');
  if (!p.allergies?.length && !p.noKnownAllergies) missing.push('allergiesRecorded');
  return missing;
}

export function patientDto(p) {
  return {
    id: String(p._id),
    uhid: p.uhid,
    name: { ...p.name, full: fullName(p.name) },
    gender: p.gender,
    dob: p.dob,
    dobEstimated: p.dobEstimated,
    age: ageLabel(p.dob),
    bloodGroup: p.bloodGroup,
    maritalStatus: p.maritalStatus,
    mobile: p.mobile,
    altMobile: p.altMobile,
    email: p.email,
    address: p.address,
    relation: p.relation?.type ? p.relation : undefined,
    guardian: p.guardian?.name ? p.guardian : undefined,
    emergencyContact: p.emergencyContact?.name ? p.emergencyContact : undefined,
    ids: (p.ids ?? []).map((d) => ({
      type: d.type,
      number: d.type === 'AADHAAR' ? maskAadhaar(`00000000${d.last4}`) : d.number,
      fileId: d.fileId && String(d.fileId),
    })),
    abha: p.abha?.number || p.abha?.address ? p.abha : undefined,
    allergies: (p.allergies ?? []).map(({ substance, reaction, severity, recordedAt }) => ({
      substance,
      reaction,
      severity,
      recordedAt,
    })),
    noKnownAllergies: p.noKnownAllergies,
    chronicConditions: p.chronicConditions ?? [],
    flags: p.flags,
    category: p.category,
    referral:
      p.referral?.sourceId || p.referral?.doctorName
        ? {
            sourceId: p.referral.sourceId && String(p.referral.sourceId),
            doctorName: p.referral.doctorName,
          }
        : undefined,
    photoFileId: p.photoFileId && String(p.photoFileId),
    preferredLanguage: p.preferredLanguage,
    registrationType: p.registrationType,
    toComplete: missingFields(p),
    status: p.status,
    mergedInto: p.mergedInto && String(p.mergedInto),
    registeredAt: p.createdAt,
    version: p.version,
  };
}

/** Light shape for search results and lists. */
export const patientCard = (p) => ({
  id: String(p._id),
  uhid: p.uhid,
  name: fullName(p.name),
  gender: p.gender,
  age: ageLabel(p.dob),
  mobile: p.mobile,
  allergies: (p.allergies ?? []).map((a) => a.substance),
  flags: p.flags,
  status: p.status,
});

// ---------------------------------------------------------------- duplicates

async function findDuplicates(doc, { excludeId } = {}) {
  const first = nameKey(doc.name.first).split(' ')[0];
  const year = 366 * 86_400_000;
  const candidates = await Patient.find({
    status: 'ACTIVE',
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    $or: [
      { mobile: doc.mobile },
      ...(doc.idHashes.length ? [{ idHashes: { $in: doc.idHashes } }] : []),
      ...(first
        ? [
            {
              nameTokens: first,
              dob: { $gte: new Date(doc.dob - year), $lte: new Date(+doc.dob + year) },
            },
          ]
        : []),
    ],
  })
    .limit(50)
    .lean();
  const me = {
    first: doc.name.first,
    last: doc.name.last,
    mobile: doc.mobile,
    dob: doc.dob,
    idHashes: doc.idHashes,
  };
  return candidates
    .map((p) => ({
      p,
      score: duplicateScore(me, {
        first: p.name.first,
        last: p.name.last,
        mobile: p.mobile,
        dob: p.dob,
        idHashes: p.idHashes,
      }),
    }))
    .filter((x) => x.score >= DUPLICATE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ p, score }) => ({ ...patientCard(p), score: Math.round(score * 100) / 100 }));
}

// ---------------------------------------------------------------- register, search, view, update

/**
 * Registers a patient and gives a permanent UHID. Likely duplicates answer 409
 * POSSIBLE_DUPLICATE with the matches; the desk resends with confirmNotDuplicate after checking.
 */
export async function registerPatient(input) {
  const masked = input.ids.findIndex((d) => d.type === 'AADHAAR' && /X/i.test(d.number));
  if (masked >= 0)
    throw errors.validation([
      { path: `ids.${masked}.number`, message: 'Enter the full 12-digit Aadhaar number' },
    ]);
  const doc = toDocument(input);
  checkRules(doc, input.registrationType);
  if (!input.confirmNotDuplicate) {
    const dupes = await findDuplicates(doc);
    if (dupes.length) {
      const err = new AppError(
        409,
        'POSSIBLE_DUPLICATE',
        'Similar patients are already registered. Check them before creating a new UHID.',
      );
      err.details = dupes.map((d) => ({
        path: 'patient',
        message: `${d.uhid} ${d.name} (${d.age}, ${d.mobile}) score ${d.score}`,
        ...d,
      }));
      throw err;
    }
  }
  return withTransaction(async () => {
    const uhid = await numbering.next('UHID');
    const [patient] = await Patient.create([
      {
        ...doc,
        uhid,
        registrationType: input.registrationType,
        registeredBranchId: current().branchId || undefined,
      },
    ]);
    await publish('patient.registered', {
      patientId: String(patient._id),
      uhid,
      mobile: patient.mobile,
      name: fullName(patient.name),
      language: patient.preferredLanguage,
      confirmedNotDuplicate: input.confirmNotDuplicate,
    });
    return patientDto(patient);
  });
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Search by UHID, mobile or name (front desk searches before registering, spec 5.4 step 1). */
export async function searchPatients({ q, page, limit }) {
  const term = q.trim();
  const d = digits(term);
  let filter;
  if (/^[a-z]{1,4}\d{3,}$/i.test(term)) filter = { uhid: term.toUpperCase() };
  else if (/^\+?[\d\s-]{4,}$/.test(term))
    filter = { mobile: new RegExp(`^${escapeRegex(d.replace(/^91(?=\d{10}$)/, ''))}`) };
  else {
    const words = nameKey(term).split(' ').filter(Boolean);
    if (!words.length) return { items: [], page, limit, total: 0 };
    filter = { $and: words.map((w) => ({ nameTokens: new RegExp(`^${escapeRegex(w)}`) })) };
  }
  filter.status = 'ACTIVE';
  const [items, total] = await Promise.all([
    Patient.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Patient.countDocuments(filter),
  ]);
  return { items: items.map(patientCard), page, limit, total };
}

/** Opening a patient record is logged (spec 4.7 access log), at most once per 10 minutes per user. */
export async function getPatient(id) {
  const p = await Patient.findById(id).lean();
  if (!p) throw errors.notFound('Patient');
  const c = current();
  const key = `pview:${c.tenantId}:${c.userId}:${id}`;
  if (await redis().set(key, '1', 'EX', ACCESS_LOG_WINDOW_SEC, 'NX')) {
    await recordAudit({
      action: 'VIEW',
      entity: 'Patient',
      entityId: id,
      summary: `Opened ${p.uhid}`,
    });
  }
  const dto = patientDto(p);
  if (p.mergedInto)
    dto.mergedIntoUhid = (await Patient.findById(p.mergedInto).select('uhid').lean())?.uhid;
  return dto;
}

export async function updatePatient(id, input) {
  const p = await Patient.findById(id);
  if (!p) throw errors.notFound('Patient');
  if (p.status === 'MERGED')
    throw new AppError(409, 'PATIENT_MERGED', 'This record was merged into another UHID');
  if (p.version !== input.version) throw errors.versionConflict();
  const doc = toDocument(input);
  checkRules(doc, p.registrationType);
  // Keep who recorded each allergy and when; new ones get the current user.
  doc.allergies = doc.allergies.map(
    (a) =>
      p.allergies.find(
        (x) => x.substance.toLowerCase() === a.substance.toLowerCase() && x.severity === a.severity,
      ) ?? a,
  );
  // Aadhaar numbers come back masked: keep the stored hash when the client sends the masked value.
  doc.ids = input.ids.map((d, i) => {
    const old = p.ids.find(
      (x) => x.type === d.type && d.number.endsWith(x.last4) && /X/i.test(d.number),
    );
    return old ?? doc.ids[i];
  });
  doc.idHashes = input.ids.map((d, i) => {
    const oldIdx = p.ids.findIndex(
      (x) => x.type === d.type && d.number.endsWith(x.last4) && /X/i.test(d.number),
    );
    return oldIdx >= 0 ? p.idHashes[oldIdx] : doc.idHashes[i];
  });
  p.set(doc);
  if (p.registrationType === 'QUICK' && !missingFields(p).length) p.registrationType = 'FULL';
  await p.save();
  return patientDto(p);
}

/** Everything about a patient in date order: other modules contribute visits, bills, reports. */
export async function timeline(id) {
  const p = await Patient.findById(id).select('uhid createdAt mergedInto').lean();
  if (!p) throw errors.notFound('Patient');
  const own = [{ at: p.createdAt, type: 'REGISTERED', title: `Registered as ${p.uhid}` }];
  const merged = await Patient.find({ mergedInto: p._id }).select('uhid updatedAt').lean();
  own.push(
    ...merged.map((m) => ({
      at: m.updatedAt,
      type: 'MERGED',
      title: `${m.uhid} merged into this record`,
    })),
  );
  const extra = (await Promise.all(timelineSources.map((s) => s(String(p._id))))).flat();
  return [...own, ...extra].sort((a, b) => new Date(b.at) - new Date(a.at));
}

// ---------------------------------------------------------------- merge

/** Merging two UHIDs is a maker-checker action (spec 5.4); nothing moves until approved. */
export async function requestMerge({ survivorId, mergedId, reason }) {
  const [survivor, merged] = await Promise.all([
    Patient.findById(survivorId).lean(),
    Patient.findById(mergedId).lean(),
  ]);
  if (!survivor || !merged) throw errors.notFound('Patient');
  if (survivor.status !== 'ACTIVE' || merged.status !== 'ACTIVE')
    throw new AppError(409, 'PATIENT_MERGED', 'Both records must be active');
  const approval = await requestApproval({
    action: 'patients.merge',
    module: 'CORE',
    entity: 'Patient',
    entityId: mergedId,
    title: `Merge ${merged.uhid} into ${survivor.uhid}`,
    before: { [merged.uhid]: patientCard(merged), [survivor.uhid]: patientCard(survivor) },
    after: { survivor: survivor.uhid, redirect: `${merged.uhid} → ${survivor.uhid}` },
    payload: { survivorId: String(survivorId), mergedId: String(mergedId) },
    reason,
  });
  if (!approval) await withTransaction(() => applyMerge(String(survivorId), String(mergedId)));
  return { approvalId: approval ? String(approval._id) : null };
}

async function applyMerge(survivorId, mergedId) {
  const [survivor, merged] = await Promise.all([
    Patient.findById(survivorId),
    Patient.findById(mergedId),
  ]);
  if (!survivor || !merged || merged.status !== 'ACTIVE') return;
  // Clinical safety: the surviving record keeps every allergy and condition from both.
  for (const a of merged.allergies)
    if (!survivor.allergies.some((x) => x.substance.toLowerCase() === a.substance.toLowerCase()))
      survivor.allergies.push(a);
  if (survivor.allergies.length) survivor.noKnownAllergies = false;
  survivor.chronicConditions = [
    ...new Set([...survivor.chronicConditions, ...merged.chronicConditions]),
  ];
  survivor.idHashes = [...new Set([...survivor.idHashes, ...merged.idHashes])];
  for (const d of merged.ids)
    if (!survivor.ids.some((x) => x.type === d.type && x.last4 === d.last4)) survivor.ids.push(d);
  await survivor.save();
  merged.set({ status: 'MERGED', mergedInto: survivor._id });
  await merged.save();
  for (const h of mergeHandlers) await h(mergedId, survivorId);
  await publish('patient.merged', {
    fromId: mergedId,
    toId: survivorId,
    fromUhid: merged.uhid,
    toUhid: survivor.uhid,
  });
}

onApprovalDecided('patients.merge', async (req, outcome) => {
  if (outcome === 'APPROVED') await applyMerge(req.payload.survivorId, req.payload.mergedId);
});
