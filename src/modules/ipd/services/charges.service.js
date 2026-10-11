import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { runAsSystem } from '../../../core/tenancy/context.js';
import { Bill, Deposit, getBill, replaceLines } from '../../billing/index.js';
import { Service, Ward } from '../../setup/index.js';
import { Admission } from '../models/ipd.models.js';
import { addDays, atIST, settingsDoc, ymdIST } from './common.js';

const ACTIVE = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];

/** Which bed the patient held at an instant (from the bed history and the current bed). */
function bedAt(a, instant) {
  const past = (a.bedHistory ?? []).find((h) => h.from <= instant && (!h.to || h.to > instant));
  return past ?? a.bed;
}

/**
 * Rule R6, midnight census: a day is charged at the tariff of the bed held at the end of it
 * (00:00 of the next day). The day of admission counts; the day of discharge is charged only
 * when the patient leaves after the census for it (`through` is the last day to post).
 */
export async function postRoomDays(a, through = addDays(ymdIST(), -1)) {
  const first = ymdIST(a.admittedAt);
  const posted = new Set((a.roomDays ?? []).map((d) => d.date));
  const wards = new Map(
    (await Ward.find({}).select('bedServiceId category').lean()).map((w) => [String(w._id), w]),
  );
  let added = 0;
  for (let d = first; d <= through; d = addDays(d, 1)) {
    if (posted.has(d)) continue;
    const instant = new Date(atIST(addDays(d, 1)).getTime() - 1000);
    if (a.leftAt && a.leftAt < atIST(d)) break;
    const bed = bedAt(a, a.leftAt && a.leftAt < instant ? a.leftAt : instant);
    const ward = wards.get(String(bed.wardId));
    a.roomDays.push({
      date: d,
      bedCode: bed.code,
      category: bed.category,
      serviceId: ward?.bedServiceId,
    });
    added++;
  }
  return added;
}

/** Bill lines from the room days and IPD charges, grouped by service. */
function billLines(a) {
  const qty = new Map();
  for (const d of a.roomDays ?? [])
    if (d.serviceId) qty.set(String(d.serviceId), (qty.get(String(d.serviceId)) ?? 0) + 1);
  for (const c of a.charges ?? [])
    if (c.serviceId)
      qty.set(String(c.serviceId), (qty.get(String(c.serviceId)) ?? 0) + (c.qty ?? 1));
  return [...qty.entries()].map(([serviceId, n]) => ({ serviceId, qty: Math.min(999, n) }));
}

/** Deposits the patient has open (amount less used and refunded). */
export async function depositBalance(patientId) {
  const ds = await Deposit.find({ patientId, status: 'OPEN' }).lean();
  return ds.reduce((s, d) => s + d.amount - (d.used ?? 0) - (d.refunded ?? 0), 0);
}

// Other modules add their own lines to the running bill (pharmacy issues to the ward).
const lineSources = [];
export function registerBillLineSource(fn) {
  lineSources.push(fn);
}

/** Rewrites the running IP bill from the stay, then checks the deposit alert (rule R7). */
export async function syncBill(a) {
  if (!a.billId) return null;
  const bill = await Bill.findById(a.billId).lean();
  if (!bill || bill.status !== 'DRAFT') return bill;
  const extra = (await Promise.all(lineSources.map((fn) => fn(a)))).flat();
  const lines = [...billLines(a), ...extra];
  const out = lines.length
    ? await replaceLines(a.billId, { version: bill.version, lines })
    : await getBill(a.billId);
  await depositAlert(a, out.totals.total);
  return out;
}

async function depositAlert(a, total) {
  const s = await settingsDoc();
  const deposit = await depositBalance(a.patient.id);
  if (!deposit || a.payer?.kind === 'INSURANCE' || a.payer?.kind === 'SCHEME') return;
  const pct = (total * 100) / deposit;
  if (pct >= s.depositAlertPct && !a.alerts?.deposit80At) {
    a.alerts = { ...(a.alerts ?? {}), deposit80At: new Date() };
    await publish('ipd.deposit.alert', {
      admissionId: String(a._id),
      ipNo: a.ipNo,
      mobile: a.patient.mobile,
      total,
      deposit,
      level: s.depositAlertPct,
    });
  }
  if (pct >= s.topUpPct && !a.alerts?.deposit100At) {
    a.alerts = { ...(a.alerts ?? {}), deposit100At: new Date() };
    await publish('ipd.deposit.topUp', {
      admissionId: String(a._id),
      ipNo: a.ipNo,
      mobile: a.patient.mobile,
      total,
      deposit,
    });
  }
}

/** Posts room days through `through` and syncs the bill, for one stay. */
export async function postStay(id, through) {
  return withTransaction(async () => {
    const a = await Admission.findById(id);
    if (!a) throw errors.notFound('Admission');
    const added = await postRoomDays(a, through);
    await a.save();
    await syncBill(a);
    await a.save();
    return added;
  });
}

/** The midnight census for every hospital (scheduled at 00:05 IST). */
export async function midnightCensus() {
  const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } })
    .select('_id')
    .lean();
  let days = 0;
  for (const t of tenants)
    days += await runAsSystem(
      t._id,
      async () => {
        let n = 0;
        for (const a of await Admission.find({ status: { $in: ACTIVE } })
          .select('_id branchId')
          .lean())
          n += await runAsSystem(t._id, () => postStay(a._id), {
            branchId: a.branchId ? String(a.branchId) : null,
          });
        return n;
      },
      { userName: 'system: midnight census' },
    );
  return { roomDays: days };
}

/** A service charged to the stay (procedure, nursing, visit); it lands on the running bill. */
export async function addCharge(id, { serviceId, qty = 1, source = 'WARD' }, userName) {
  return withTransaction(async () => {
    const a = await Admission.findById(id);
    if (!a) throw errors.notFound('Admission');
    if (!ACTIVE.includes(a.status)) throw new AppError(409, 'INVALID_STATE', 'The stay is closed.');
    const s = await Service.findOne({ _id: serviceId, status: 'ACTIVE' }).lean();
    if (!s)
      throw errors.validation([
        { path: 'serviceId', message: 'Service not found or not approved' },
      ]);
    a.charges.push({ serviceId, name: s.name, qty, at: new Date(), by: userName, source });
    await syncBill(a);
    await a.save();
    return { id: String(a.charges.at(-1)._id), name: s.name, qty };
  });
}

/** Running bill for the stay: totals, deposits and how much of the deposit is used. */
export async function runningBill(a) {
  const bill = a.billId ? await getBill(a.billId).catch(() => null) : null;
  const deposit = await depositBalance(a.patient.id);
  const total = bill?.totals?.total ?? 0;
  return {
    billId: bill?.id ?? null,
    billNo: bill?.billNo ?? null,
    status: bill?.status ?? null,
    lines: bill?.lines ?? [],
    total,
    paid: bill?.totals?.paid ?? 0,
    deposit,
    balance: total - deposit,
    usedPct: deposit ? Math.round((total * 100) / deposit) : null,
    roomDays: (a.roomDays ?? []).length,
  };
}

/** Re-syncs a stay's running bill after another module changed its lines (pharmacy issues). */
export async function syncStayBill(admissionId) {
  const a = await Admission.findById(admissionId);
  if (!a) return null;
  const out = await syncBill(a);
  await a.save();
  return out;
}
