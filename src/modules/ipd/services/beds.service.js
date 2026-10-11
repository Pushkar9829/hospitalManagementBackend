import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current, runAsSystem } from '../../../core/tenancy/context.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { Bed, Ward } from '../../setup/index.js';
import { Admission, AdmissionRequest, BedState, CleaningTask } from '../models/ipd.models.js';
import { daysBetween, settingsDoc } from './common.js';

/** The state of one bed, created AVAILABLE if the bed has never been seen. */
export async function ensureBedState(bedId) {
  const found = await BedState.findOne({ bedId });
  if (found) return found;
  try {
    return (await BedState.create([{ bedId }]))[0];
  } catch (e) {
    if (e?.code === 11000) return BedState.findOne({ bedId });
    throw e;
  }
}

/** Bed states for every active bed, created AVAILABLE the first time a bed is seen. */
async function states(beds) {
  const have = new Map(
    (await BedState.find({ bedId: { $in: beds.map((b) => b._id) } }).lean()).map((s) => [
      String(s.bedId),
      s,
    ]),
  );
  const missing = beds.filter((b) => !have.has(String(b._id)));
  if (missing.length) {
    try {
      await BedState.insertMany(
        missing.map((b) => ({ bedId: b._id, status: 'AVAILABLE' })),
        { ordered: false },
      );
    } catch (e) {
      if (e?.code !== 11000 && !e?.writeErrors) throw e;
    }
    for (const s of await BedState.find({ bedId: { $in: missing.map((b) => b._id) } }).lean())
      have.set(String(s.bedId), s);
  }
  return have;
}

/**
 * Bed board (board Beds): wards with each bed's state, the patient in it (name, IP number,
 * consultant, day of stay) and counts per state. `ward`/`category` filter.
 */
export async function board({ wardId, category } = {}) {
  const wf = { isActive: true };
  if (current().branchId) wf.branchId = current().branchId;
  if (wardId) wf._id = wardId;
  if (category) wf.category = category;
  const wards = await Ward.find(wf).sort({ floor: 1, name: 1 }).lean();
  const beds = await Bed.find({ wardId: { $in: wards.map((w) => w._id) }, isActive: true })
    .sort({ code: 1 })
    .lean();
  const st = await states(beds);
  const admissions = new Map(
    (
      await Admission.find({
        _id: { $in: [...st.values()].map((s) => s.admissionId).filter(Boolean) },
      })
        .select('ipNo patient consultant admittedAt emergency expectedDischargeAt status payer')
        .lean()
    ).map((a) => [String(a._id), a]),
  );
  const totals = { AVAILABLE: 0, RESERVED: 0, OCCUPIED: 0, CLEANING: 0, BLOCKED: 0 };
  const out = wards.map((w) => {
    const counts = { AVAILABLE: 0, RESERVED: 0, OCCUPIED: 0, CLEANING: 0, BLOCKED: 0 };
    const list = beds
      .filter((b) => String(b.wardId) === String(w._id))
      .map((b) => {
        const s = st.get(String(b._id));
        counts[s.status]++;
        totals[s.status]++;
        const a = s.admissionId ? admissions.get(String(s.admissionId)) : null;
        return {
          id: String(b._id),
          code: b.code,
          name: b.name,
          room: b.room ?? null,
          kind: b.kind,
          status: s.status,
          since: s.since,
          reservedUntil: s.reservedUntil ?? null,
          cleaning: s.cleaning ?? null,
          blockedReason: s.blockedReason ?? null,
          stay: a
            ? {
                admissionId: String(a._id),
                ipNo: a.ipNo,
                patient: {
                  id: String(a.patient.id),
                  name: a.patient.name,
                  uhid: a.patient.uhid,
                  gender: a.patient.gender,
                  age: a.patient.age,
                },
                consultant: a.consultant?.name ?? null,
                day: daysBetween(a.admittedAt) + 1,
                emergency: a.emergency,
                payer: a.payer?.kind,
                dischargeExpected: a.expectedDischargeAt ?? null,
                status: a.status,
              }
            : null,
        };
      });
    return {
      id: String(w._id),
      code: w.code,
      name: w.name,
      floor: w.floor ?? null,
      category: w.category,
      gender: w.gender,
      counts,
      beds: list,
    };
  });
  const total = beds.length;
  return {
    wards: out,
    totals,
    occupancy: total ? Math.round((totals.OCCUPIED * 1000) / total) / 10 : 0,
    beds: total,
  };
}

/**
 * Rule R4: beds that suit a request: same category, bay gender (ANY or the patient's) and an
 * isolation ward when isolation is needed.
 */
export async function suggest(requestId) {
  const r = await AdmissionRequest.findById(requestId).lean();
  if (!r) throw errors.notFound('Admission request');
  const g = r.patient.gender === 'F' ? 'FEMALE' : r.patient.gender === 'M' ? 'MALE' : null;
  const category = r.isolation ? 'ISOLATION' : r.wardCategory;
  const wf = { isActive: true, category, gender: { $in: g ? ['ANY', g] : ['ANY'] } };
  if (current().branchId) wf.branchId = current().branchId;
  const wards = await Ward.find(wf).lean();
  const beds = await Bed.find({ wardId: { $in: wards.map((w) => w._id) }, isActive: true })
    .sort({ code: 1 })
    .lean();
  const st = await states(beds);
  const free = beds.filter((b) => st.get(String(b._id)).status === 'AVAILABLE');
  return {
    category,
    items: free.slice(0, 20).map((b) => {
      const w = wards.find((x) => String(x._id) === String(b.wardId));
      return {
        id: String(b._id),
        code: b.code,
        room: b.room ?? null,
        ward: w.name,
        wardId: String(w._id),
        category: w.category,
        gender: w.gender,
      };
    }),
  };
}

/** Reserve a bed for a request; the hold expires after the reservation time (rule R3). */
export async function reserve(requestId, { bedId }) {
  const s = await settingsDoc();
  return withTransaction(async () => {
    const r = await AdmissionRequest.findById(requestId);
    if (!r) throw errors.notFound('Admission request');
    if (!['REQUESTED', 'ESTIMATED', 'WAITING', 'EXPIRED'].includes(r.status))
      throw new AppError(409, 'INVALID_STATE', `This request is ${r.status.toLowerCase()}.`);
    const bed = await Bed.findById(bedId).lean();
    if (!bed) throw errors.notFound('Bed');
    await ensureBedState(bedId);
    const until = new Date(Date.now() + s.reservationHoldMin * 60_000);
    const st = await BedState.findOneAndUpdate(
      { bedId, status: 'AVAILABLE' },
      { $set: { status: 'RESERVED', requestId: r._id, reservedUntil: until, since: new Date() } },
      { new: true },
    );
    if (!st) throw new AppError(409, 'BED_NOT_AVAILABLE', 'This bed was just taken. Pick another.');
    if (r.reservedBedId && String(r.reservedBedId) !== String(bedId))
      await BedState.updateOne(
        { bedId: r.reservedBedId, requestId: r._id, status: 'RESERVED' },
        {
          $set: { status: 'AVAILABLE', since: new Date() },
          $unset: { requestId: 1, reservedUntil: 1 },
        },
      );
    r.status = 'RESERVED';
    r.reservedBedId = bedId;
    r.reservedUntil = until;
    await r.save();
    await publish('ipd.bed.reserved', { bedId: String(bedId), requestId: String(r._id) });
    return { requestId: String(r._id), bedId: String(bedId), reservedUntil: until };
  });
}

/** Releases expired reservations (job every 5 minutes). */
export async function expireReservations(now = new Date()) {
  const due = await BedState.find({ status: 'RESERVED', reservedUntil: { $lt: now } }).lean();
  for (const s of due) {
    await BedState.updateOne(
      { _id: s._id, status: 'RESERVED' },
      { $set: { status: 'AVAILABLE', since: now }, $unset: { requestId: 1, reservedUntil: 1 } },
    );
    if (s.requestId)
      await AdmissionRequest.updateOne(
        { _id: s.requestId, status: 'RESERVED' },
        { $set: { status: 'EXPIRED' }, $unset: { reservedBedId: 1, reservedUntil: 1 } },
      );
  }
  return due.length;
}

/** Expires reservations in every hospital (worker job, every 5 minutes). */
export async function sweepReservations(now = new Date()) {
  const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } })
    .select('_id')
    .lean();
  let n = 0;
  for (const t of tenants)
    n += await runAsSystem(t._id, () => expireReservations(now), {
      userName: 'system: bed reservations',
    });
  return { expired: n };
}

export async function block(bedId, { reason }) {
  const bed = await Bed.findById(bedId).lean();
  if (!bed) throw errors.notFound('Bed');
  await ensureBedState(bedId);
  const st = await BedState.findOneAndUpdate(
    { bedId, status: 'AVAILABLE' },
    { $set: { status: 'BLOCKED', blockedReason: reason, since: new Date() } },
    { new: true },
  );
  if (!st) throw new AppError(409, 'INVALID_STATE', 'Only an available bed can be blocked.');
  return { bedId: String(bedId), status: st.status };
}

export async function unblock(bedId) {
  const st = await BedState.findOneAndUpdate(
    { bedId, status: 'BLOCKED' },
    { $set: { status: 'AVAILABLE', since: new Date() }, $unset: { blockedReason: 1 } },
    { new: true },
  );
  if (!st) throw new AppError(409, 'INVALID_STATE', 'This bed is not blocked.');
  return { bedId: String(bedId), status: st.status };
}

/** A bed the patient leaves goes to cleaning; isolation beds need a terminal clean. */
export async function vacate(bedSnap, admissionId) {
  const isolation = bedSnap.category === 'ISOLATION';
  await BedState.updateOne(
    { bedId: bedSnap.bedId },
    {
      $set: { status: 'CLEANING', cleaning: isolation ? 'TERMINAL' : 'ROUTINE', since: new Date() },
      $unset: { admissionId: 1 },
    },
  );
  await CleaningTask.create([
    {
      bedId: bedSnap.bedId,
      bedCode: bedSnap.code,
      ward: bedSnap.ward,
      admissionId,
      type: isolation ? 'TERMINAL' : 'ROUTINE',
    },
  ]);
  await publish('ipd.bed.vacated', {
    bedId: String(bedSnap.bedId),
    bedCode: bedSnap.code,
    cleaning: isolation ? 'TERMINAL' : 'ROUTINE',
  });
}

export async function cleaningTasks({ status = 'OPEN' } = {}) {
  const s = await settingsDoc();
  const items = await CleaningTask.find(status === 'ALL' ? {} : { status })
    .sort({ openedAt: 1 })
    .limit(200)
    .lean();
  const now = Date.now();
  return {
    items: items.map((t) => {
      const target = t.type === 'TERMINAL' ? s.targets.isolationCleaningMin : s.targets.cleaningMin;
      const minutes = Math.round(((t.doneAt?.getTime() ?? now) - t.openedAt.getTime()) / 60000);
      return {
        id: String(t._id),
        bedId: String(t.bedId),
        bed: t.bedCode,
        ward: t.ward,
        type: t.type,
        status: t.status,
        openedAt: t.openedAt,
        doneAt: t.doneAt ?? null,
        minutes,
        overdue: t.status === 'OPEN' && minutes > target,
        target,
      };
    }),
    total: items.length,
    page: 1,
    limit: 200,
  };
}

/** Housekeeping closes the task; the bed is available again (rule R19). */
export async function cleaningDone(taskId, userName) {
  return withTransaction(async () => {
    const t = await CleaningTask.findById(taskId);
    if (!t) throw errors.notFound('Cleaning task');
    if (t.status === 'DONE') throw new AppError(409, 'INVALID_STATE', 'This bed is already clean.');
    t.status = 'DONE';
    t.doneAt = new Date();
    t.doneBy = userName;
    await t.save();
    await BedState.updateOne(
      { bedId: t.bedId, status: 'CLEANING' },
      { $set: { status: 'AVAILABLE', since: new Date() }, $unset: { cleaning: 1 } },
    );
    await publish('ipd.bed.available', { bedId: String(t.bedId) });
    return { id: String(t._id), status: 'DONE' };
  });
}
