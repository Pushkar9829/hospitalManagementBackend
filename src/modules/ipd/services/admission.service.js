import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { User } from '../../../core/auth/models/user.model.js';
import { createBill, finalizeBill, getBill } from '../../billing/index.js';
import {
  Bed,
  Doctor,
  Package,
  Payer,
  PriceList,
  Service,
  Ward,
  numbering,
} from '../../setup/index.js';
import { Admission, AdmissionRequest, BedState } from '../models/ipd.models.js';
import { ensureBedState, vacate } from './beds.service.js';
import { depositBalance, postRoomDays, runningBill, syncBill } from './charges.service.js';
import {
  daysBetween,
  doctorOut,
  doctorSnap,
  escape,
  loadPatient,
  patientOut,
  patientSnap,
  settingsDoc,
  ymdIST,
} from './common.js';

const ACTIVE = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];
const userName = async () =>
  (await User.findById(current().userId).select('name').lean())?.name ?? 'System';

// ---------------------------------------------------------------- requests and estimates

const requestOut = (r) => ({
  id: String(r._id),
  patient: patientOut(r.patient),
  doctor: doctorOut(r.doctor),
  reason: r.reason,
  expectedDays: r.expectedDays,
  wardCategory: r.wardCategory,
  urgency: r.urgency,
  isolation: r.isolation,
  status: r.status,
  estimate: r.estimate?.amount != null ? r.estimate : null,
  reservedBedId: r.reservedBedId ? String(r.reservedBedId) : null,
  reservedUntil: r.reservedUntil ?? null,
  admissionId: r.admissionId ? String(r.admissionId) : null,
  visitId: r.visitId ? String(r.visitId) : null,
  createdAt: r.createdAt,
});

export async function createRequest(input) {
  const p = await loadPatient(input.patientId);
  const doctor = await doctorSnap(input.doctorId);
  const [r] = await AdmissionRequest.create([
    {
      patient: patientSnap(p),
      doctor,
      reason: input.reason,
      expectedDays: input.expectedDays ?? 3,
      wardCategory: input.wardCategory ?? 'GENERAL',
      urgency: input.urgency ?? 'TODAY',
      isolation: Boolean(input.isolation),
      packageId: input.packageId,
      visitId: input.visitId,
    },
  ]);
  await publish('ipd.request.created', { requestId: String(r._id), urgency: r.urgency });
  return requestOut(r);
}

/** OPD "Request admission" arrives as an event and becomes a request on the admission desk. */
const WARD_FROM_OPD = {
  GENERAL: 'GENERAL',
  SEMI_PRIVATE: 'SEMI_PRIVATE',
  PRIVATE: 'PRIVATE',
  ICU: 'ICU',
};
export async function requestFromOpd({ visitId, patientId, wardType, urgency, reason }) {
  if (await AdmissionRequest.exists({ visitId })) return;
  const { OpdVisit } = await import('../../opd/index.js');
  const v = await OpdVisit.findById(visitId).select('doctor').lean();
  if (!v?.doctor?.id) return;
  await createRequest({
    patientId,
    doctorId: v.doctor.id,
    reason,
    wardCategory: WARD_FROM_OPD[wardType] ?? 'GENERAL',
    urgency: urgency === 'EMERGENCY' ? 'EMERGENCY' : urgency === 'ROUTINE' ? 'ROUTINE' : 'TODAY',
    visitId,
  });
}

export async function listRequests({ status, page = 1, limit = 50 }) {
  const filter = status
    ? { status: { $in: status.split(',') } }
    : { status: { $in: ['REQUESTED', 'ESTIMATED', 'WAITING', 'RESERVED', 'EXPIRED'] } };
  const [items, total] = await Promise.all([
    AdmissionRequest.find(filter)
      .sort({ urgency: 1, createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AdmissionRequest.countDocuments(filter),
  ]);
  const order = { EMERGENCY: 0, TODAY: 1, ROUTINE: 2 };
  items.sort((a, b) => order[a.urgency] - order[b.urgency] || a.createdAt - b.createdAt);
  return { items: items.map(requestOut), total, page, limit };
}

async function findRequest(id) {
  const r = await AdmissionRequest.findById(id);
  if (!r) throw errors.notFound('Admission request');
  return r;
}

/** Room tariff per day for a ward category, from the category's bed-day service. */
async function tariffFor(category) {
  const ward = await Ward.findOne({
    category,
    isActive: true,
    bedServiceId: { $exists: true },
  }).lean();
  if (!ward) return 0;
  const [svc, list] = await Promise.all([
    Service.findById(ward.bedServiceId).lean(),
    PriceList.findOne({ isDefault: true }).lean(),
  ]);
  return (
    svc?.rates.find((r) => String(r.priceListId) === String(list?._id))?.amount ??
    svc?.rates[0]?.amount ??
    0
  );
}

/** Estimate and counselling: room for the expected stay (or the package) and the deposit. */
export async function estimate(id, { expectedDays, wardCategory, packageId }) {
  const s = await settingsDoc();
  const r = await findRequest(id);
  if (!['REQUESTED', 'ESTIMATED', 'WAITING', 'EXPIRED'].includes(r.status))
    throw new AppError(409, 'INVALID_STATE', `This request is ${r.status.toLowerCase()}.`);
  if (expectedDays) r.expectedDays = expectedDays;
  if (wardCategory) r.wardCategory = wardCategory;
  if (packageId) r.packageId = packageId;
  const pkg = r.packageId ? await Package.findById(r.packageId).lean() : null;
  const days = r.expectedDays ?? 3;
  const room = await tariffFor(r.wardCategory);
  const amount = pkg ? pkg.price + Math.max(0, days - (pkg.stayDays || days)) * room : room * days;
  r.estimate = {
    amount,
    deposit: s.deposits.get(r.wardCategory) ?? 0,
    days,
    signedAt: r.estimate?.signedAt,
    signedBy: r.estimate?.signedBy,
  };
  if (r.status === 'REQUESTED' || r.status === 'EXPIRED') r.status = 'ESTIMATED';
  await r.save();
  return {
    ...requestOut(r),
    roomPerDay: room,
    package: pkg ? { id: String(pkg._id), name: pkg.name, price: pkg.price } : null,
  };
}

export async function signEstimate(id, { signedBy }) {
  const r = await findRequest(id);
  if (!r.estimate?.amount && r.estimate?.amount !== 0)
    throw new AppError(409, 'INVALID_STATE', 'Give the estimate first.');
  r.estimate.signedAt = new Date();
  r.estimate.signedBy = signedBy;
  await r.save();
  return requestOut(r);
}

export async function cancelRequest(id, { reason }) {
  const r = await findRequest(id);
  if (r.status === 'ADMITTED') throw new AppError(409, 'INVALID_STATE', 'The patient is admitted.');
  if (r.reservedBedId)
    await BedState.updateOne(
      { bedId: r.reservedBedId, requestId: r._id, status: 'RESERVED' },
      {
        $set: { status: 'AVAILABLE', since: new Date() },
        $unset: { requestId: 1, reservedUntil: 1 },
      },
    );
  r.status = 'CANCELLED';
  r.cancelReason = reason;
  r.reservedBedId = undefined;
  await r.save();
  return requestOut(r);
}

// ---------------------------------------------------------------- admission

const bedSnapOf = async (bedId) => {
  const bed = await Bed.findById(bedId).lean();
  if (!bed) throw errors.validation([{ path: 'bedId', message: 'Pick a bed' }]);
  const ward = await Ward.findById(bed.wardId).lean();
  return {
    bedId: bed._id,
    code: bed.code,
    wardId: ward._id,
    ward: ward.name,
    category: ward.category,
  };
};

/** Rule R5: an insured patient in a room above the policy limit needs the upgrade consent. */
async function roomRentCheck(payer, category, consent) {
  if (!payer?.roomRentLimit || consent) return;
  const tariff = await tariffFor(category);
  if (tariff > payer.roomRentLimit)
    throw new AppError(
      409,
      'ROOM_RENT_CONSENT',
      'This room is above the policy room-rent limit. Insurers deduct proportionately; take the patient’s signed upgrade consent first.',
      [
        {
          path: 'consentHigherCategory',
          message: 'Upgrade consent needed',
          tariff,
          limit: payer.roomRentLimit,
        },
      ],
    );
}

/**
 * Admits a patient (rules R1 to R5). Emergency: bed first, deposit due within the window.
 * Planned cash or corporate: the category deposit must be paid before admission. Insured:
 * pre-authorisation follows (R8). Creates the IP number, the running bill and occupies the bed.
 */
export async function admit(input) {
  const s = await settingsDoc();
  const r = input.requestId ? await findRequest(input.requestId) : null;
  const patient = await loadPatient(input.patientId ?? r?.patient.id);
  const consultant = await doctorSnap(input.doctorId ?? r?.doctor.id);
  const reason = input.reason ?? r?.reason;
  if (!reason?.trim())
    throw errors.validation([
      { path: 'reason', message: 'The admission order needs a reason (rule R1)' },
    ]);
  const bed = await bedSnapOf(input.bedId ?? r?.reservedBedId);
  const emergency = Boolean(input.emergency ?? r?.urgency === 'EMERGENCY');
  let payer = { kind: input.payer?.kind ?? 'CASH' };
  if (input.payer?.payerId) {
    const p = await Payer.findById(input.payer.payerId).lean();
    if (!p)
      throw errors.validation([
        { path: 'payer.payerId', message: 'Pick the insurer, TPA or company' },
      ]);
    payer = {
      ...payer,
      payerId: p._id,
      name: p.name,
      policyNo: input.payer.policyNo,
      roomRentLimit: input.payer.roomRentLimit,
    };
  }
  await roomRentCheck(payer, bed.category, input.consentHigherCategory);
  // Planned cash patients pay first; corporate is on credit and insured go through pre-auth.
  if (!emergency && payer.kind === 'CASH') {
    const need = s.deposits.get(bed.category) ?? 0;
    const have = await depositBalance(patient._id);
    if (have < need)
      throw new AppError(
        409,
        'DEPOSIT_REQUIRED',
        `A deposit of ₹${(need / 100).toLocaleString('en-IN')} is needed before a planned admission (rule R2).`,
        [{ path: 'deposit', message: 'Collect the deposit at billing first', need, have }],
      );
  }
  const now = new Date();
  const result = await withTransaction(async () => {
    const st = await ensureBedState(bed.bedId);
    const free =
      !st ||
      st.status === 'AVAILABLE' ||
      (st.status === 'RESERVED' && r && String(st.requestId) === String(r._id));
    if (!free) throw new AppError(409, 'BED_NOT_AVAILABLE', 'This bed is not free. Pick another.');
    const ipNo = await numbering.next('IP');
    let a;
    try {
      [a] = await Admission.create([
        {
          ipNo,
          branchId: current().branchId,
          requestId: r?._id,
          patient: patientSnap(patient),
          consultant,
          reason,
          expectedDays: input.expectedDays ?? r?.expectedDays,
          emergency,
          mlc: input.mlc?.flag
            ? { flag: true, policeIntimation: input.mlc.policeIntimation, at: now }
            : { flag: false },
          payer,
          bed,
          bedHistory: [],
          admittedAt: now,
          depositDueBy: emergency
            ? new Date(now.getTime() + s.emergencyDepositHours * 3_600_000)
            : undefined,
          expectedDischargeAt: input.expectedDays
            ? new Date(now.getTime() + input.expectedDays * 86_400_000)
            : undefined,
        },
      ]);
    } catch (e) {
      if (e?.code === 11000 && String(e.message).includes('one_active_stay'))
        throw new AppError(409, 'ALREADY_ADMITTED', 'This patient is already admitted (rule R3).');
      throw e;
    }
    await BedState.updateOne(
      { bedId: bed.bedId },
      {
        $set: { status: 'OCCUPIED', admissionId: a._id, since: now },
        $unset: { requestId: 1, reservedUntil: 1 },
      },
    );
    const bill = await createBill({
      patientId: String(patient._id),
      type: 'IP',
      lines: [],
      notes: `In-patient ${ipNo}`,
    });
    a.billId = bill.id;
    await a.save();
    if (r) {
      r.status = 'ADMITTED';
      r.admissionId = a._id;
      await r.save();
    }
    if (patient.flags?.mlc || a.mlc.flag)
      await publish('ipd.mlc.admitted', {
        admissionId: String(a._id),
        ipNo,
        policeIntimation: a.mlc.policeIntimation,
      });
    await publish('ipd.admitted', {
      admissionId: String(a._id),
      ipNo,
      patientId: String(patient._id),
      mobile: patient.mobile,
      bed: bed.code,
      ward: bed.ward,
      consultant: consultant.name,
      emergency,
    });
    return a;
  });
  return admissionOut(result, { bill: await runningBill(result) });
}

export const admissionOut = (a, extra = {}) => ({
  id: String(a._id),
  ipNo: a.ipNo,
  patient: patientOut(a.patient),
  consultant: doctorOut(a.consultant),
  reason: a.reason,
  expectedDays: a.expectedDays ?? null,
  emergency: a.emergency,
  mlc: a.mlc?.flag ? a.mlc : null,
  payer: a.payer,
  bed: a.bed && { ...a.bed, bedId: String(a.bed.bedId), wardId: String(a.bed.wardId) },
  bedHistory: (a.bedHistory ?? []).map((h) => ({
    code: h.code,
    ward: h.ward,
    category: h.category,
    from: h.from,
    to: h.to,
  })),
  status: a.status,
  outcome: a.outcome ?? null,
  admittedAt: a.admittedAt,
  day: daysBetween(a.admittedAt, a.leftAt ?? new Date()) + 1,
  depositDueBy: a.depositDueBy ?? null,
  expectedDischargeAt: a.expectedDischargeAt ?? null,
  dischargeAdviceAt: a.dischargeAdviceAt ?? null,
  leftAt: a.leftAt ?? null,
  summary: a.summary?.signedAt || a.summary?.diagnoses?.length ? a.summary : null,
  ...extra,
});

export async function findAdmission(id) {
  const a = await Admission.findById(id);
  if (!a) throw errors.notFound('Admission');
  return a;
}

export async function listAdmissions({ status, doctorId, wardId, q, page = 1, limit = 50 }) {
  const filter = { status: status ? { $in: status.split(',') } : { $in: ACTIVE } };
  if (doctorId === 'me') {
    const d = await Doctor.findOne({ userId: current().userId }).select('_id').lean();
    filter['consultant.id'] = d?._id ?? '000000000000000000000000';
  } else if (doctorId) filter['consultant.id'] = doctorId;
  if (wardId) filter['bed.wardId'] = wardId;
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ 'patient.name': rx }, { 'patient.uhid': rx }, { ipNo: rx }];
  }
  const [items, total] = await Promise.all([
    Admission.find(filter)
      .sort({ admittedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Admission.countDocuments(filter),
  ]);
  return { items: items.map((a) => admissionOut(a)), total, page, limit };
}

export async function getAdmission(id) {
  const a = await findAdmission(id);
  // Loaded here, not at the top: the clinical service imports this one.
  const { assessmentsDue } = await import('./clinical.service.js');
  return admissionOut(a, {
    assessmentsDue: await assessmentsDue(a),
    bill: await runningBill(a),
    charges: (a.charges ?? []).map((c) => ({
      id: String(c._id),
      name: c.name,
      qty: c.qty,
      at: c.at,
      by: c.by,
    })),
  });
}

/** Rule E: transfer (or ICU step-up); the old bed goes to cleaning; tariff by the bed held at midnight. */
export async function transfer(id, { bedId, reason, consentHigherCategory }) {
  const a = await findAdmission(id);
  if (!ACTIVE.includes(a.status)) throw new AppError(409, 'INVALID_STATE', 'The stay is closed.');
  const bed = await bedSnapOf(bedId);
  if (String(bed.bedId) === String(a.bed.bedId))
    throw errors.validation([{ path: 'bedId', message: 'The patient is already in this bed' }]);
  await roomRentCheck(a.payer, bed.category, consentHigherCategory);
  await ensureBedState(bed.bedId);
  return withTransaction(async () => {
    const taken = await BedState.findOneAndUpdate(
      { bedId: bed.bedId, status: 'AVAILABLE' },
      { $set: { status: 'OCCUPIED', admissionId: a._id, since: new Date() } },
      { new: true },
    );
    if (!taken) throw new AppError(409, 'BED_NOT_AVAILABLE', 'This bed is not free. Pick another.');
    const now = new Date();
    const old = a.bed.toObject();
    a.bedHistory.push({ ...old, from: a.bedHistory.at(-1)?.to ?? a.admittedAt, to: now });
    a.bed = bed;
    await vacate(old, a._id);
    await a.save();
    await publish('ipd.transferred', {
      admissionId: String(a._id),
      from: old.code,
      to: bed.code,
      reason,
    });
    return admissionOut(a);
  });
}

/** A stay moves from ADMITTED to UNDER_TREATMENT with the first doctor note (called by rounds). */
export async function markUnderTreatment(id) {
  await Admission.updateOne(
    { _id: id, status: 'ADMITTED' },
    { $set: { status: 'UNDER_TREATMENT' } },
  );
}

export async function planDischarge(id, { expectedAt }) {
  const a = await findAdmission(id);
  if (!['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED'].includes(a.status))
    throw new AppError(409, 'INVALID_STATE', `Discharge cannot be planned now (${a.status}).`);
  a.status = 'DISCHARGE_PLANNED';
  a.expectedDischargeAt = new Date(expectedAt);
  await a.save();
  await publish('ipd.discharge.planned', {
    admissionId: String(a._id),
    ipNo: a.ipNo,
    expectedAt: a.expectedDischargeAt,
    mobile: a.patient.mobile,
  });
  return admissionOut(a);
}

/** Draft discharge summary (rule R13: once signed, only addenda). */
export async function saveSummary(id, body) {
  const a = await findAdmission(id);
  if (a.summary?.status === 'SIGNED')
    throw new AppError(409, 'INVALID_STATE', 'The summary is signed. Add an addendum instead.');
  a.summary = { ...(a.summary?.toObject?.() ?? {}), ...body, status: 'DRAFT' };
  await a.save();
  return admissionOut(a);
}

/** Rule R14: a consultant signs a summary with diagnoses, medicines and follow-up. */
export async function signSummary(id) {
  const a = await findAdmission(id);
  const s = a.summary ?? {};
  if (s.status === 'SIGNED')
    throw new AppError(409, 'INVALID_STATE', 'The summary is already signed.');
  const missing = [];
  if (!s.diagnoses?.length)
    missing.push({ path: 'diagnoses', message: 'Add the final diagnosis (ICD-10)' });
  if (a.outcome !== 'DEATH' && !s.followUp?.date && !s.followUp?.note)
    missing.push({ path: 'followUp', message: 'Give the follow-up' });
  if (a.outcome !== 'DEATH' && !s.medicines?.length && !s.advice)
    missing.push({ path: 'medicines', message: 'Add the discharge medicines or advice' });
  if (missing.length)
    throw new AppError(
      422,
      'SUMMARY_INCOMPLETE',
      'The discharge summary is incomplete (rule R14).',
      missing,
    );
  const me = await Doctor.findOne({ userId: current().userId }).select('name').lean();
  a.summary.status = 'SIGNED';
  a.summary.signedAt = new Date();
  a.summary.signedBy = me?.name ?? (await userName());
  await a.save();
  return admissionOut(a);
}

/** Discharge advice: the clock for the final bill and the insurer's final approval starts. */
export async function adviseDischarge(id) {
  const a = await findAdmission(id);
  if (!['UNDER_TREATMENT', 'ADMITTED', 'DISCHARGE_PLANNED'].includes(a.status))
    throw new AppError(409, 'INVALID_STATE', `Discharge cannot start now (${a.status}).`);
  a.status = 'DISCHARGE_STARTED';
  a.dischargeAdviceAt = new Date();
  await a.save();
  await publish('ipd.discharge.started', {
    admissionId: String(a._id),
    ipNo: a.ipNo,
    patientId: String(a.patient.id),
  });
  return admissionOut(a);
}

/** Checks other modules run before the final bill (pharmacy returns pending, rule R15). */
const finalBillChecks = [];
export const registerFinalBillCheck = (fn) => finalBillChecks.push(fn);

/** Posts the stay's charges through today and finalises the IP bill (rule R16 clock). */
export async function finalBill(id) {
  const a = await findAdmission(id);
  if (a.status !== 'DISCHARGE_STARTED')
    throw new AppError(409, 'INVALID_STATE', 'Start the discharge first.');
  for (const check of finalBillChecks) {
    const problem = await check(a);
    if (problem) throw new AppError(409, problem.code, problem.message);
  }
  await postRoomDays(a, ymdIST());
  await syncBill(a);
  await a.save();
  const draft = await getBill(a.billId);
  const final =
    draft.status === 'DRAFT' ? await finalizeBill(a.billId, { version: draft.version }) : draft;
  a.billReadyAt = new Date();
  await a.save();
  return { admission: admissionOut(a), bill: await runningBill(a), billNo: final.billNo };
}

/**
 * The patient leaves. NORMAL needs the signed summary; dues need Medical Superintendent
 * approval (R17); a deceased patient is never held for dues (R18). The bed goes to cleaning.
 */
export async function completeDischarge(id, input, res) {
  const a = await findAdmission(id);
  const outcome = input.outcome ?? 'NORMAL';
  if (a.status === 'DISCHARGED') throw new AppError(409, 'INVALID_STATE', 'Already discharged.');
  if (outcome === 'NORMAL' && a.status !== 'DISCHARGE_STARTED')
    throw new AppError(409, 'INVALID_STATE', 'Start the discharge first.');
  if (
    outcome === 'LAMA' &&
    !(input.lama?.risksExplained && input.lama?.witness && input.lama?.signedBy)
  )
    throw errors.validation([
      {
        path: 'lama',
        message: 'LAMA needs the risks explained, the signed form and a witness (rule R20)',
      },
    ]);
  if (outcome === 'DEATH' && !(input.death?.at && input.death?.cause))
    throw errors.validation([{ path: 'death', message: 'Record the time and cause of death' }]);
  if (['NORMAL', 'REFERRED'].includes(outcome) && a.summary?.status !== 'SIGNED')
    throw new AppError(
      409,
      'SUMMARY_NOT_SIGNED',
      'The consultant must sign the discharge summary first (rule R14).',
    );
  const bill = await runningBill(a);
  const dues = bill.status === 'FINAL' ? Math.max(0, bill.total - bill.paid) : bill.total;
  if (dues > 0 && !['DEATH', 'ABSCONDED'].includes(outcome) && !input.duesApproved) {
    const approval = await requestApproval({
      action: 'ipd.dischargeWithDues',
      module: 'IPD',
      entity: 'Admission',
      entityId: a._id,
      title: `Discharge with dues · ${a.patient.name} (${a.ipNo})`,
      before: { dues: 0 },
      after: { dues },
      payload: { admissionId: String(a._id), input },
      metrics: { amount: dues },
      reason: input.reason || 'Patient leaving with unpaid dues',
    });
    if (approval) {
      res.locals.status = 202;
      return { ...admissionOut(a), approvalId: String(approval._id), dues };
    }
  }
  return finish(a, outcome, input);
}

async function finish(a, outcome, input) {
  return withTransaction(async () => {
    a.outcome = outcome;
    if (outcome === 'LAMA') a.summary = { ...(a.summary?.toObject?.() ?? {}), lama: input.lama };
    if (outcome === 'DEATH') a.summary = { ...(a.summary?.toObject?.() ?? {}), death: input.death };
    a.status = 'DISCHARGED';
    a.leftAt = new Date();
    await vacate(a.bed.toObject?.() ?? a.bed, a._id);
    await a.save();
    await publish('ipd.discharged', {
      admissionId: String(a._id),
      ipNo: a.ipNo,
      patientId: String(a.patient.id),
      outcome,
      mobile: a.patient.mobile,
    });
    return admissionOut(a);
  });
}

onApprovalDecided('ipd.dischargeWithDues', async (req, outcome) => {
  if (outcome !== 'APPROVED') return;
  const a = await Admission.findById(req.payload.admissionId);
  if (a && a.status !== 'DISCHARGED')
    await finish(a, req.payload.input?.outcome ?? 'NORMAL', req.payload.input ?? {});
});

export async function addAddendum(id, { text }) {
  const a = await findAdmission(id);
  if (a.summary?.status !== 'SIGNED')
    throw new AppError(409, 'INVALID_STATE', 'Edit the draft; addenda are for signed summaries.');
  a.summary.addenda.push({ text, by: await userName(), at: new Date() });
  await a.save();
  return admissionOut(a);
}

export { userName };

/** Consultants and payers for the admission desk (without the setup masters permission). */
export async function lookups() {
  const [doctors, payers] = await Promise.all([
    Doctor.find({ isActive: true }).sort({ name: 1 }).select('name departmentId kind').lean(),
    Payer.find({ isActive: true }).sort({ name: 1 }).select('name kind code').lean(),
  ]);
  const { Department } = await import('../../setup/index.js');
  const depts = new Map(
    (await Department.find({}).select('name').lean()).map((d) => [String(d._id), d.name]),
  );
  return {
    doctors: doctors.map((d) => ({
      id: String(d._id),
      name: d.name,
      department: depts.get(String(d.departmentId)) ?? null,
    })),
    payers: payers.map((p) => ({ id: String(p._id), name: p.name, kind: p.kind, code: p.code })),
  };
}
