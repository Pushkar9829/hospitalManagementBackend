import { hasPermission } from '@hms/shared';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { Role } from '../../../core/auth/models/role.model.js';
import { User } from '../../../core/auth/models/user.model.js';
import { Bill } from '../../billing/index.js';
import { HomeVisit, LabItem } from '../models/lab.models.js';
import { me, patientOut } from './common.js';
import { collect, createOrder } from './order.service.js';

/**
 * Home collection (design board "Phlebotomist phone screens"). Booking makes the lab order like
 * a walk-in (an OP bill the patient pays before collection, rule R10 of billing); the visit is
 * assigned to a phlebotomist, who starts it, collects after scanning the patient's UHID card,
 * and hands the samples to the lab, where they are received as usual.
 */
const OPEN = ['BOOKED', 'ASSIGNED', 'ON_THE_WAY'];

async function payment(v) {
  const items = await LabItem.find({ _id: { $in: v.itemIds } })
    .select('billId status')
    .lean();
  const billIds = [
    ...new Set(
      items
        .map((i) => i.billId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  if (!billIds.length) return 'OK';
  const bills = await Bill.find({ _id: { $in: billIds } })
    .select('status totals.balance')
    .lean();
  return bills.some((b) => b.status === 'DRAFT' || (b.totals?.balance ?? 0) > 0) ? 'UNPAID' : 'OK';
}

const out = async (v) => ({
  id: String(v._id),
  visitNo: v.visitNo,
  patient: patientOut(v.patient),
  address: v.address,
  landmark: v.landmark,
  phone: v.phone ?? v.patient?.mobile,
  date: v.date,
  slot: v.slot,
  orderNo: v.orderNo,
  tests: v.tests,
  notes: v.notes,
  phlebotomist: v.phlebotomist?.userId
    ? { userId: String(v.phlebotomist.userId), name: v.phlebotomist.name }
    : null,
  status: v.status,
  startedAt: v.startedAt,
  collectedAt: v.collectedAt,
  handedOverAt: v.handedOverAt,
  sampleNos: v.sampleNos ?? [],
  payment: OPEN.includes(v.status) ? await payment(v) : 'OK',
  cancelReason: v.cancelReason,
  version: v.version ?? 0,
});

async function load(id) {
  const v = await HomeVisit.findById(id);
  if (!v) throw errors.notFound('Home visit');
  return v;
}

const mine = (v) => String(v.phlebotomist?.userId ?? '') === String(current().userId);

/** Only the assigned phlebotomist works a visit; lab staff who assign visits can step in. */
function checkMine(v) {
  if (!mine(v) && !hasPermission([...current().permissions], 'lab:homevisit:assign'))
    throw errors.forbidden('This visit is assigned to someone else');
}

export async function phlebotomists() {
  const roles = await Role.find({ panel: 'phlebotomist' }).select('_id').lean();
  const users = await User.find({ roles: { $in: roles.map((r) => r._id) }, status: 'ACTIVE' })
    .select('name')
    .sort({ name: 1 })
    .lean();
  return { items: users.map((u) => ({ userId: String(u._id), name: u.name })) };
}

export async function book({
  patientId,
  tests,
  date,
  slot,
  address,
  landmark,
  phone,
  notes,
  phlebotomistUserId,
}) {
  const order = await createOrder({
    patientId,
    tests,
    clinicalNotes: notes ? `Home visit: ${notes}` : 'Home visit',
  });
  const itemIds = order.items.map((i) => i.id);
  await LabItem.updateMany(
    { _id: { $in: itemIds } },
    { $set: { location: `Home visit · ${address}`.slice(0, 120) } },
  );
  let phlebotomist;
  if (phlebotomistUserId) {
    const u = await User.findById(phlebotomistUserId).select('name').lean();
    if (!u)
      throw errors.validation([{ path: 'phlebotomistUserId', message: 'Pick a phlebotomist' }]);
    phlebotomist = { userId: u._id, name: u.name };
  }
  const [v] = await HomeVisit.create([
    {
      visitNo: await documentNumber('HV'),
      patient: (await LabItem.findById(itemIds[0]).select('patient').lean()).patient,
      address,
      landmark,
      phone,
      date,
      slot,
      orderNo: order.orderNo,
      itemIds,
      tests: order.items.map((i) => i.name),
      notes,
      phlebotomist,
      status: phlebotomist ? 'ASSIGNED' : 'BOOKED',
    },
  ]);
  return { ...(await out(v.toObject())), billId: order.billId };
}

export async function list({ date, mine: onlyMine, status }) {
  const filter = {};
  if (date) filter.date = date;
  if (status === 'OPEN') filter.status = { $in: OPEN };
  else if (status) filter.status = status;
  if (onlyMine) filter['phlebotomist.userId'] = current().userId;
  const rows = await HomeVisit.find(filter).sort({ date: 1, slot: 1 }).limit(300).lean();
  return { items: await Promise.all(rows.map(out)) };
}

export async function assign(id, { version, userId }) {
  const v = await load(id);
  if (v.version !== version) throw errors.versionConflict();
  if (!['BOOKED', 'ASSIGNED'].includes(v.status))
    throw new AppError(409, 'INVALID_STATE', 'Only a visit not yet started can be reassigned');
  const u = await User.findById(userId).select('name').lean();
  if (!u) throw errors.validation([{ path: 'userId', message: 'Pick a phlebotomist' }]);
  v.set({ phlebotomist: { userId: u._id, name: u.name }, status: 'ASSIGNED' });
  await v.save();
  return out(v.toObject());
}

export async function start(id, { version }) {
  const v = await load(id);
  if (v.version !== version) throw errors.versionConflict();
  checkMine(v);
  if (v.status !== 'ASSIGNED') throw new AppError(409, 'INVALID_STATE', 'Start an assigned visit');
  v.set({ status: 'ON_THE_WAY', startedAt: new Date() });
  await v.save();
  return out(v.toObject());
}

/** Collects at home: the order's open tests, after the UHID card scan; returns the labels. */
export async function collectAtHome(id, { version, scan }) {
  const v = await load(id);
  if (v.version !== version) throw errors.versionConflict();
  checkMine(v);
  if (!['ASSIGNED', 'ON_THE_WAY'].includes(v.status))
    throw new AppError(409, 'INVALID_STATE', 'This visit is not open for collection');
  const open = await LabItem.find({ _id: { $in: v.itemIds }, status: 'ORDERED' })
    .select('_id')
    .lean();
  if (!open.length)
    throw new AppError(409, 'INVALID_STATE', 'Nothing left to collect on this visit');
  const { labels } = await collect({ itemIds: open.map((i) => String(i._id)), scan });
  v.set({ status: 'COLLECTED', collectedAt: new Date(), sampleNos: labels.map((l) => l.sampleNo) });
  await v.save();
  return { visit: await out(v.toObject()), labels };
}

export async function handOver(id, { version }) {
  const v = await load(id);
  if (v.version !== version) throw errors.versionConflict();
  checkMine(v);
  if (v.status !== 'COLLECTED')
    throw new AppError(409, 'INVALID_STATE', 'Collect the samples first');
  v.set({ status: 'HANDED_OVER', handedOverAt: new Date() });
  await v.save();
  return out(v.toObject());
}

export async function cancel(id, { version, reason }) {
  const v = await load(id);
  if (v.version !== version) throw errors.versionConflict();
  if (!OPEN.includes(v.status))
    throw new AppError(409, 'INVALID_STATE', 'Only an open visit can be cancelled');
  v.set({ status: 'CANCELLED', cancelReason: reason });
  await v.save();
  await LabItem.updateMany(
    { _id: { $in: v.itemIds }, status: 'ORDERED' },
    { $set: { status: 'CANCELLED', cancelReason: `Home visit cancelled: ${reason}` } },
  );
  return { ...(await out(v.toObject())), by: (await me()).name };
}
