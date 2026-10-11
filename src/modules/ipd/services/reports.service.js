import { Bed, Ward } from '../../setup/index.js';
import { Bill } from '../../billing/index.js';
import { Admission, CleaningTask } from '../models/ipd.models.js';
import { MarDose } from '../models/clinical.models.js';
import { PreAuth } from '../models/insurance.models.js';
import { addDays, atIST, daysBetween, ymdIST } from './common.js';

/** IPD analytics (IPD spec sections 8 and 9). */

const ACTIVE = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const pct = (n, d) => (d ? Math.round((n * 1000) / d) / 10 : 0);
const minutes = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : NaN);

function range(period = 'month') {
  const to = ymdIST();
  const days = period === 'week' ? 7 : period === 'today' ? 1 : 30;
  return { from: addDays(to, -(days - 1)), to, days };
}

/** Census now: each ward's beds, patients and occupancy, with the patient list. */
export async function census() {
  const wards = await Ward.find({ isActive: true }).sort({ name: 1 }).lean();
  const beds = await Bed.find({ isActive: true }).select('wardId').lean();
  const stays = await Admission.find({ status: { $in: ACTIVE } })
    .sort({ 'bed.code': 1 })
    .lean();
  const items = wards.map((w) => {
    const total = beds.filter((b) => String(b.wardId) === String(w._id)).length;
    const here = stays.filter((a) => String(a.bed.wardId) === String(w._id));
    return {
      ward: { id: String(w._id), name: w.name, category: w.category },
      beds: total,
      occupied: here.length,
      occupancy: pct(here.length, total),
      patients: here.map((a) => ({
        admissionId: String(a._id),
        ipNo: a.ipNo,
        bed: a.bed.code,
        name: a.patient.name,
        days: daysBetween(a.admittedAt) + 1,
        category: a.bed.category,
        consultant: a.consultant?.name ?? null,
      })),
    };
  });
  const totalBeds = beds.length;
  return {
    at: new Date().toISOString(),
    beds: totalBeds,
    occupied: stays.length,
    occupancy: pct(stays.length, totalBeds),
    items,
  };
}

/**
 * Indicators for a period: bed occupancy (occupied bed days ÷ bed days), average length of stay,
 * bed turnover, gross death and LAMA rates, discharge and bed turnaround, revenue per occupied
 * bed day, doses on time and pre-auth reply time.
 */
export async function indicators({ period = 'month' } = {}) {
  const { from, to, days } = range(period);
  const start = atIST(from);
  const end = new Date(atIST(to).getTime() + 86_400_000);
  const beds = await Bed.countDocuments({ isActive: true });
  const overlapping = await Admission.find({
    admittedAt: { $lt: end },
    $or: [{ leftAt: null }, { leftAt: { $gte: start } }],
  }).lean();
  let occupiedDays = 0;
  for (const a of overlapping) {
    const s = Math.max(start.getTime(), a.admittedAt.getTime());
    const e = Math.min(end.getTime(), (a.leftAt ?? new Date()).getTime());
    occupiedDays += Math.max(0, e - s) / 86_400_000;
  }
  const left = overlapping.filter((a) => a.leftAt && a.leftAt >= start && a.leftAt < end);
  const deaths = left.filter((a) => a.outcome === 'DEATH').length;
  const lama = left.filter((a) => a.outcome === 'LAMA').length;
  const stayDays = left.map((a) => (a.leftAt - a.admittedAt) / 86_400_000);
  const revenue = left.length
    ? (
        await Bill.find({ _id: { $in: left.map((a) => a.billId).filter(Boolean) } })
          .select('totals')
          .lean()
      ).reduce((s, b) => s + (b.totals?.total ?? 0), 0)
    : 0;
  const cleaning = await CleaningTask.find({
    status: 'DONE',
    doneAt: { $gte: start, $lt: end },
  }).lean();
  const doses = await MarDose.find({
    dueAt: { $gte: start, $lt: new Date(Math.min(end.getTime(), Date.now())) },
  }).lean();
  const onTime = doses.filter(
    (d) => d.status === 'GIVEN' && Math.abs(minutes(d.dueAt, d.givenAt)) <= 30,
  ).length;
  const cases = await PreAuth.find({ createdAt: { $gte: start, $lt: end } }).lean();
  const replyMins = cases.map((c) => {
    const sent = c.events.find((e) => e.kind === 'SENT');
    const reply = c.events.find((e) => ['APPROVED', 'QUERY', 'DENIED'].includes(e.kind));
    return minutes(sent?.at, reply?.at);
  });
  return {
    period,
    from,
    to,
    beds,
    admissions: overlapping.filter((a) => a.admittedAt >= start).length,
    discharges: left.length,
    occupancy: pct(occupiedDays, beds * days),
    alos: stayDays.length
      ? Math.round((stayDays.reduce((s, x) => s + x, 0) / stayDays.length) * 10) / 10
      : null,
    bedTurnover: beds ? Math.round((left.length / beds) * 10) / 10 : 0,
    deathRate: pct(deaths, left.length),
    lamaRate: pct(lama, left.length),
    deaths,
    lama,
    dischargeTurnaroundMin: median(left.map((a) => minutes(a.dischargeAdviceAt, a.leftAt))),
    bedTurnaroundMin: median(cleaning.map((t) => minutes(t.openedAt, t.doneAt))),
    revenuePerBedDay: occupiedDays ? Math.round(revenue / occupiedDays) : 0,
    dosesOnTime: pct(onTime, doses.length),
    dosesDue: doses.length,
    preauthReplyMin: median(replyMins),
    targets: { preauthReplyMin: 60, dosesOnTime: 95 },
  };
}
