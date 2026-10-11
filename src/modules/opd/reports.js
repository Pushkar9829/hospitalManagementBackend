import {
  GROUPS,
  istDate,
  period,
  registerReport,
  registerTile,
  tone,
} from '../../core/reports/registry.js';
import { Patient } from '../patients/index.js';
import { ReferralSource } from '../setup/index.js';
import { Appointment, OpdVisit } from './models/opd.models.js';

/** OPD reports (catalogue group "Front office and OPD"). */
const mins = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null);
const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (n, d) => (d ? Math.round((n * 1000) / d) / 10 : 0);
const departments = async () =>
  (await OpdVisit.distinct('doctor.department')).filter(Boolean).sort();
const deptFilter = { key: 'department', label: 'Department', options: departments };

async function visits({ from, to, filters }) {
  const p = period({ from, to });
  const q = { checkedInAt: { $gte: p.from, $lte: p.to } };
  if (filters.department) q['doctor.department'] = filters.department;
  return OpdVisit.find(q).sort({ checkedInAt: 1 }).lean();
}

registerReport({
  code: 'opd-register',
  name: 'Daily OPD register',
  group: GROUPS.OPD,
  module: 'OPD',
  permission: 'reports:opd:read',
  description: 'Every visit with token, patient, doctor, type and status.',
  filters: [deptFilter],
  columns: [
    ['visitNo', 'Visit', 'id'],
    ['at', 'Checked in', 'datetime'],
    ['token', 'Token', 'text'],
    ['patient', 'Patient', 'text'],
    ['uhid', 'UHID', 'id'],
    ['doctor', 'Doctor', 'text'],
    ['department', 'Department', 'text'],
    ['type', 'Visit type', 'text'],
    ['status', 'Status', 'status'],
  ],
  run: async (args) => {
    const rows = await visits(args);
    return {
      kpis: [
        ['visits', 'Visits', rows.length, 'count'],
        ['walkIns', 'Walk-ins', rows.filter((v) => v.walkIn).length, 'count'],
      ],
      items: rows.map((v) => ({
        visitNo: v.visitNo,
        at: v.checkedInAt,
        token: v.token ?? '',
        patient: v.patient?.name,
        uhid: v.patient?.uhid,
        doctor: v.doctor?.name,
        department: v.doctor?.department ?? '',
        type: v.visitType ?? '',
        status: v.closedAt ? tone.ok('Closed') : tone.info(v.stage ?? 'Open'),
      })),
    };
  },
});

registerReport({
  code: 'opd-doctor-footfall',
  name: 'Doctor-wise footfall',
  group: GROUPS.OPD,
  module: 'OPD',
  permission: 'reports:opd:read',
  description: 'Patients seen by each doctor, new and follow-up, and median consultation time.',
  filters: [deptFilter],
  columns: [
    ['doctor', 'Doctor', 'text'],
    ['department', 'Department', 'text'],
    ['visits', 'Visits', 'count'],
    ['newVisits', 'New', 'count'],
    ['followUps', 'Follow-up', 'count'],
    ['consultMin', 'Median consultation', 'minutes'],
  ],
  run: async (args) => {
    const rows = await visits(args);
    const by = new Map();
    for (const v of rows) {
      const k = v.doctor?.name ?? '—';
      const r = by.get(k) ?? { doctor: k, department: v.doctor?.department ?? '', list: [] };
      r.list.push(v);
      by.set(k, r);
    }
    const items = [...by.values()]
      .map((r) => ({
        doctor: r.doctor,
        department: r.department,
        visits: r.list.length,
        newVisits: r.list.filter((v) => v.visitType === 'NEW').length,
        followUps: r.list.filter((v) => v.visitType === 'FOLLOW_UP').length,
        consultMin: median(r.list.map((v) => mins(v.consultStartedAt, v.closedAt))),
      }))
      .sort((a, b) => b.visits - a.visits);
    return {
      kpis: [
        ['visits', 'Visits', rows.length, 'count'],
        ['doctors', 'Doctors', items.length, 'count'],
      ],
      items,
    };
  },
});

registerReport({
  code: 'opd-new-vs-followup',
  name: 'New vs follow-up',
  group: GROUPS.OPD,
  module: 'OPD',
  permission: 'reports:opd:read',
  description: 'Visits by type for each day.',
  filters: [deptFilter],
  columns: [
    ['date', 'Date', 'date'],
    ['NEW', 'New', 'count'],
    ['FOLLOW_UP', 'Follow-up', 'count'],
    ['other', 'Other', 'count'],
    ['followUpPct', 'Follow-up share', 'percent'],
  ],
  run: async (args) => {
    const rows = await visits(args);
    const by = new Map();
    for (const v of rows) {
      const d = istDate(v.checkedInAt);
      const r = by.get(d) ?? { date: d, NEW: 0, FOLLOW_UP: 0, other: 0 };
      if (v.visitType === 'NEW' || v.visitType === 'FOLLOW_UP') r[v.visitType] += 1;
      else r.other += 1;
      by.set(d, r);
    }
    const items = [...by.values()].map((r) => ({
      ...r,
      followUpPct: pct(r.FOLLOW_UP, r.NEW + r.FOLLOW_UP + r.other),
    }));
    const fu = items.reduce((t, r) => t + r.FOLLOW_UP, 0);
    return { kpis: [['followUpPct', 'Follow-up share', pct(fu, rows.length), 'percent']], items };
  },
});

registerReport({
  code: 'opd-waiting',
  name: 'Waiting and consultation time',
  group: GROUPS.OPD,
  module: 'OPD',
  permission: 'reports:opd:read',
  description: 'Median wait from check-in to the doctor and consultation length, by doctor.',
  filters: [deptFilter],
  columns: [
    ['doctor', 'Doctor', 'text'],
    ['visits', 'Visits', 'count'],
    ['waitMin', 'Median wait', 'minutes'],
    ['consultMin', 'Median consultation', 'minutes'],
    ['over30', 'Waited over 30 min', 'count'],
  ],
  run: async (args) => {
    const rows = await visits(args);
    const by = new Map();
    for (const v of rows) {
      const k = v.doctor?.name ?? '—';
      by.set(k, [...(by.get(k) ?? []), v]);
    }
    const wait = (v) => mins(v.checkedInAt, v.consultStartedAt ?? v.calledAt);
    const items = [...by.entries()].map(([doctor, vs]) => ({
      doctor,
      visits: vs.length,
      waitMin: median(vs.map(wait)),
      consultMin: median(vs.map((v) => mins(v.consultStartedAt, v.closedAt))),
      over30: vs.filter((v) => (wait(v) ?? 0) > 30).length,
    }));
    return { kpis: [['waitMin', 'Median wait', median(rows.map(wait)), 'minutes']], items };
  },
});

registerReport({
  code: 'opd-no-show',
  name: 'No-show rate',
  group: GROUPS.OPD,
  module: 'OPD',
  permission: 'reports:opd:read',
  description: 'Booked appointments that did not turn up, by doctor.',
  columns: [
    ['doctor', 'Doctor', 'text'],
    ['booked', 'Booked', 'count'],
    ['noShow', 'No-show', 'count'],
    ['cancelled', 'Cancelled', 'count'],
    ['noShowPct', 'No-show rate', 'percent'],
  ],
  run: async ({ from, to }) => {
    const rows = await Appointment.find({
      date: { $gte: from, $lte: to },
      channel: { $ne: 'WALK_IN' },
    }).lean();
    const by = new Map();
    for (const a of rows)
      by.set(a.doctor?.name ?? '—', [...(by.get(a.doctor?.name ?? '—') ?? []), a]);
    const items = [...by.entries()].map(([doctor, as]) => {
      const noShow = as.filter((a) => a.status === 'NO_SHOW').length;
      return {
        doctor,
        booked: as.length,
        noShow,
        cancelled: as.filter((a) => a.status === 'CANCELLED').length,
        noShowPct: pct(noShow, as.length),
      };
    });
    const n = rows.filter((a) => a.status === 'NO_SHOW').length;
    return { kpis: [['noShowPct', 'No-show rate', pct(n, rows.length), 'percent']], items };
  },
});

registerReport({
  code: 'opd-referral-source',
  name: 'Referral source',
  group: GROUPS.OPD,
  module: 'CORE',
  permission: 'reports:crm:read',
  description: 'New patients registered by referral source.',
  columns: [
    ['source', 'Source', 'text'],
    ['kind', 'Kind', 'text'],
    ['patients', 'New patients', 'count'],
    ['share', 'Share', 'percent'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await Patient.find({ createdAt: { $gte: p.from, $lte: p.to } })
      .select('referral')
      .lean();
    const sources = new Map((await ReferralSource.find({}).lean()).map((s) => [String(s._id), s]));
    const by = new Map();
    for (const r of rows) {
      const k = r.referral?.sourceId ? String(r.referral.sourceId) : 'none';
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    const items = [...by.entries()]
      .map(([k, n]) => ({
        source: k === 'none' ? 'Not recorded' : (sources.get(k)?.name ?? 'Unknown'),
        kind: k === 'none' ? '' : (sources.get(k)?.kind ?? ''),
        patients: n,
        share: pct(n, rows.length),
      }))
      .sort((a, b) => b.patients - a.patients);
    return { kpis: [['patients', 'New patients', rows.length, 'count']], items };
  },
});

const todayStart = () =>
  new Date(`${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00+05:30`);

registerTile({
  key: 'opd-today',
  label: 'OPD visits today',
  group: GROUPS.OPD,
  module: 'OPD',
  permission: 'reports:opd:read',
  report: 'opd-register',
  run: async () => {
    const from = todayStart();
    const [visits, waiting] = await Promise.all([
      OpdVisit.countDocuments({ checkedInAt: { $gte: from } }),
      OpdVisit.countDocuments({
        checkedInAt: { $gte: from },
        consultStartedAt: null,
        closedAt: null,
      }),
    ]);
    return { value: visits, note: `${waiting} waiting now` };
  },
});
