import { Bill } from '../../billing/index.js';
import { Appointment, OpdVisit } from '../models/opd.models.js';
import { addDays, doctorOut, hhmmIST, ymdIST } from './common.js';

/** OPD analytics (OPD spec section 8 and 9): waits by stage, arrivals by hour, doctor days. */

const TARGETS = { totalMin: 90, waitToDoctorMin: 30, noShowRate: 8 };

function rangeOf(period = 'today') {
  const to = ymdIST();
  const from = period === 'month' ? addDays(to, -29) : period === 'week' ? addDays(to, -6) : to;
  return { from, to };
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const mins = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 60000 : NaN);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

async function scoped({ period, department }) {
  const { from, to } = rangeOf(period);
  const filter = { date: { $gte: from, $lte: to } };
  if (department) filter['doctor.department'] = department;
  const [visits, appts] = await Promise.all([
    OpdVisit.find(filter).lean(),
    Appointment.find(filter).lean(),
  ]);
  return { visits, appts, from, to };
}

export async function waitTimes({ period = 'today', department }) {
  const { visits, appts } = await scoped({ period, department });
  const booked = appts.filter((a) => a.channel !== 'WALK_IN');
  const noShows = appts.filter((a) => a.status === 'NO_SHOW').length;
  const walkIns = visits.filter((v) => v.walkIn).length;
  const billIds = visits.map((v) => v.billId).filter(Boolean);
  const revenue = billIds.length
    ? (
        await Bill.find({ _id: { $in: billIds } })
          .select('totals')
          .lean()
      ).reduce((s, b) => s + (b.totals?.total ?? 0), 0)
    : 0;
  const admissions = visits.filter((v) => v.admissionRequest).length;
  const stages = [
    ['ARRIVAL_CHECKIN', visits.map(() => NaN)],
    [
      'CHECKIN_TRIAGE',
      visits.map((v) => mins(v.checkedInAt, v.triageStartedAt ?? v.vitals?.recordedAt)),
    ],
    [
      'TRIAGE_DOCTOR',
      visits.map((v) =>
        mins(v.vitals?.recordedAt ?? v.checkedInAt, v.consultStartedAt ?? v.calledAt),
      ),
    ],
    [
      'CONSULT',
      visits.map((v) => mins(v.consultStartedAt ?? v.calledAt, v.consultation?.signedAt)),
    ],
    ['BILLING', visits.map(() => NaN)],
    ['PHARMACY', visits.map(() => NaN)],
  ].map(([stage, xs]) => ({ stage, medianMin: median(xs) }));
  const byHour = new Map();
  for (const v of visits) {
    if (!v.checkedInAt) continue;
    const h = Number(hhmmIST(new Date(v.checkedInAt)).slice(0, 2));
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  const hours = [...byHour.keys()];
  const arrivalsByHour = hours.length
    ? Array.from({ length: Math.max(...hours) - Math.min(...hours) + 1 }, (_, i) => {
        const hour = Math.min(...hours) + i;
        return { hour, count: byHour.get(hour) ?? 0 };
      })
    : [];
  return {
    period,
    kpis: {
      visits: visits.length,
      bookedShare: Math.round(100 - pct(walkIns, visits.length)),
      walkInShare: Math.round(pct(walkIns, visits.length)),
      medianTotalMin: median(visits.map((v) => mins(v.checkedInAt, v.closedAt))),
      waitToDoctorMin: median(
        visits.map((v) => mins(v.checkedInAt, v.consultStartedAt ?? v.calledAt)),
      ),
      noShowRate: pct(noShows, booked.length),
      noShows,
      revenuePerVisit: visits.length ? Math.round(revenue / visits.length) : 0,
      ipdConversion: pct(admissions, visits.length),
      admissions,
    },
    targets: TARGETS,
    stages,
    arrivalsByHour,
  };
}

export async function doctorPerformance({ period = 'today', department }) {
  const { visits, appts } = await scoped({ period, department });
  const ids = [...new Set([...visits, ...appts].map((x) => String(x.doctor.id)))];
  const bills = new Map(
    (
      await Bill.find({ _id: { $in: visits.map((v) => v.billId).filter(Boolean) } })
        .select('totals')
        .lean()
    ).map((b) => [String(b._id), b.totals?.total ?? 0]),
  );
  const items = ids.map((id) => {
    const vs = visits.filter((v) => String(v.doctor.id) === id);
    const as = appts.filter((a) => String(a.doctor.id) === id);
    const doctor = (vs[0] ?? as[0]).doctor;
    const seen = vs.filter((v) => v.stage === 'DONE');
    const first = vs
      .filter((v) => v.consultStartedAt)
      .sort((a, b) => new Date(a.consultStartedAt) - new Date(b.consultStartedAt))[0];
    const firstSlot = as.map((a) => a.slotStart).sort((a, b) => new Date(a) - new Date(b))[0];
    return {
      doctor: doctorOut(doctor),
      booked: as.filter((a) => a.channel !== 'WALK_IN').length,
      seen: seen.length,
      noShow: as.filter((a) => a.status === 'NO_SHOW').length,
      lateStartMin:
        first && firstSlot && period === 'today'
          ? Math.max(0, Math.round(mins(firstSlot, first.consultStartedAt)))
          : 0,
      medianWaitMin: median(vs.map((v) => mins(v.checkedInAt, v.consultStartedAt ?? v.calledAt))),
      medianConsultMin: median(
        vs.map((v) => mins(v.consultStartedAt ?? v.calledAt, v.consultation?.signedAt)),
      ),
      utilisation: Math.round(
        pct(
          as.filter((a) => a.status !== 'NO_SHOW' && a.status !== 'CANCELLED').length,
          Math.max(1, as.length),
        ),
      ),
      testsPerVisit: seen.length
        ? Math.round(
            (seen.reduce((s, v) => s + (v.consultation?.orders?.length ?? 0), 0) / seen.length) *
              10,
          ) / 10
        : 0,
      revenue: vs.reduce((s, v) => s + (v.billId ? (bills.get(String(v.billId)) ?? 0) : 0), 0),
    };
  });
  items.sort((a, b) => a.doctor.name.localeCompare(b.doctor.name));
  return { items, total: items.length, page: 1, limit: 100 };
}
