import { GROUPS, period, registerReport, registerTile, tone } from '../../core/reports/registry.js';
import { Bill, Deposit } from '../billing/index.js';
import { Bed } from '../setup/index.js';
import { Admission, CleaningTask } from './models/ipd.models.js';
import { MarDose } from './models/clinical.models.js';

/** IPD, nursing and bed reports. */
const DAY = 86_400_000;
const mins = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 60000) : null);
const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const ACTIVE = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];

registerReport({
  code: 'ipd-admission-register',
  name: 'Admission and discharge register',
  group: GROUPS.IPD,
  module: 'IPD',
  permission: 'reports:ipd:read',
  description: 'Admissions and discharges in the period with ward, consultant and outcome.',
  columns: [
    ['ipNo', 'IP no.', 'id'],
    ['patient', 'Patient', 'text'],
    ['uhid', 'UHID', 'id'],
    ['ward', 'Ward', 'text'],
    ['consultant', 'Consultant', 'text'],
    ['admittedAt', 'Admitted', 'datetime'],
    ['leftAt', 'Discharged', 'datetime'],
    ['days', 'Days', 'days'],
    ['outcome', 'Outcome', 'status'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await Admission.find({
      $or: [{ admittedAt: { $gte: p.from, $lte: p.to } }, { leftAt: { $gte: p.from, $lte: p.to } }],
    })
      .sort({ admittedAt: 1 })
      .lean();
    const outcome = (a) =>
      !a.outcome
        ? tone.info('In hospital')
        : a.outcome === 'NORMAL'
          ? tone.ok('Discharged')
          : a.outcome === 'DEATH'
            ? tone.bad('Death')
            : tone.warn(a.outcome);
    return {
      kpis: [
        ['admissions', 'Admissions', rows.filter((a) => a.admittedAt >= p.from).length, 'count'],
        [
          'discharges',
          'Discharges',
          rows.filter((a) => a.leftAt && a.leftAt >= p.from && a.leftAt <= p.to).length,
          'count',
        ],
      ],
      items: rows.map((a) => ({
        ipNo: a.ipNo,
        patient: a.patient?.name,
        uhid: a.patient?.uhid,
        ward: a.bed?.ward ?? '',
        consultant: a.consultant?.name ?? '',
        admittedAt: a.admittedAt,
        leftAt: a.leftAt ?? null,
        days: Math.max(1, Math.ceil(((a.leftAt ?? new Date()) - a.admittedAt) / DAY)),
        outcome: outcome(a),
      })),
    };
  },
});

registerReport({
  code: 'ipd-occupancy-alos',
  name: 'Bed occupancy and ALOS',
  group: GROUPS.IPD,
  module: 'IPD',
  permission: 'reports:ipd:read',
  description: 'Patient days, occupancy and average length of stay by ward.',
  columns: [
    ['ward', 'Ward', 'text'],
    ['beds', 'Beds', 'count'],
    ['patientDays', 'Patient days', 'number'],
    ['occupancy', 'Occupancy', 'percent'],
    ['discharges', 'Discharges', 'count'],
    ['alos', 'ALOS (days)', 'number'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const end = Math.min(p.to.getTime(), Date.now());
    const days = Math.max(1, (end - p.from.getTime()) / DAY);
    const stays = await Admission.find({
      admittedAt: { $lte: p.to },
      $or: [{ leftAt: null }, { leftAt: { $gte: p.from } }],
    }).lean();
    const beds = await Bed.find({ isActive: { $ne: false } })
      .populate('wardId', 'name')
      .lean();
    const wards = new Map();
    for (const b of beds) {
      const w = b.wardId?.name ?? '—';
      wards.set(w, {
        ward: w,
        beds: (wards.get(w)?.beds ?? 0) + 1,
        patientDays: 0,
        discharges: 0,
        los: [],
      });
    }
    for (const a of stays) {
      const w = a.bed?.ward ?? '—';
      const r = wards.get(w) ?? { ward: w, beds: 0, patientDays: 0, discharges: 0, los: [] };
      const s = Math.max(a.admittedAt.getTime(), p.from.getTime());
      const e = Math.min(a.leftAt ? a.leftAt.getTime() : end, end);
      r.patientDays += Math.max(0, e - s) / DAY;
      if (a.leftAt && a.leftAt >= p.from && a.leftAt <= p.to) {
        r.discharges += 1;
        r.los.push((a.leftAt - a.admittedAt) / DAY);
      }
      wards.set(w, r);
    }
    const items = [...wards.values()].map((r) => ({
      ward: r.ward,
      beds: r.beds,
      patientDays: Math.round(r.patientDays * 10) / 10,
      occupancy: r.beds ? Math.round((r.patientDays * 1000) / (r.beds * days)) / 10 : 0,
      discharges: r.discharges,
      alos: r.los.length
        ? Math.round((r.los.reduce((t, x) => t + x, 0) / r.los.length) * 10) / 10
        : null,
    }));
    const pd = items.reduce((t, r) => t + r.patientDays, 0);
    return {
      kpis: [
        [
          'occupancy',
          'Occupancy',
          beds.length ? Math.round((pd * 1000) / (beds.length * days)) / 10 : 0,
          'percent',
        ],
        ['patientDays', 'Patient days', Math.round(pd * 10) / 10, 'number'],
      ],
      items,
    };
  },
});

registerReport({
  code: 'ipd-midnight-census',
  name: 'Midnight census',
  group: GROUPS.IPD,
  module: 'IPD',
  permission: 'reports:ipd:read',
  description: 'In-patients counted at midnight each day (room days posted), by ward.',
  columns: [
    ['date', 'Date', 'date'],
    ['ward', 'Ward', 'text'],
    ['patients', 'Patients at midnight', 'count'],
  ],
  run: async ({ from, to }) => {
    const rows = await Admission.find({ 'roomDays.date': { $gte: from, $lte: to } })
      .select('roomDays bed')
      .lean();
    const by = new Map();
    for (const a of rows)
      // A transfer day has one entry per bed: the patient still counts once that night.
      for (const date of new Set(
        a.roomDays.filter((x) => x.date >= from && x.date <= to).map((x) => x.date),
      )) {
        const k = `${date}|${a.bed?.ward ?? '—'}`;
        by.set(k, (by.get(k) ?? 0) + 1);
      }
    const items = [...by.entries()]
      .map(([k, n]) => {
        const [date, ward] = k.split('|');
        return { date, ward, patients: n };
      })
      .sort((a, b) =>
        a.date === b.date ? a.ward.localeCompare(b.ward) : a.date.localeCompare(b.date),
      );
    return {
      kpis: [['days', 'Census days', new Set(items.map((i) => i.date)).size, 'count']],
      items,
    };
  },
});

registerReport({
  code: 'ipd-deposit-vs-bill',
  name: 'Deposit vs bill',
  group: GROUPS.IPD,
  module: 'IPD',
  permission: 'reports:billing:read',
  description: 'Current in-patients: running bill against deposits, lowest cover first.',
  columns: [
    ['ipNo', 'IP no.', 'id'],
    ['patient', 'Patient', 'text'],
    ['ward', 'Ward', 'text'],
    ['bill', 'Bill so far', 'money'],
    ['deposit', 'Deposits', 'money'],
    ['balance', 'Balance', 'money'],
    ['cover', 'Deposit cover', 'status'],
  ],
  run: async () => {
    const stays = await Admission.find({ status: { $in: ACTIVE } }).lean();
    const items = [];
    for (const a of stays) {
      const bill = a.billId ? await Bill.findById(a.billId).select('totals').lean() : null;
      const deps = await Deposit.find({
        patientId: a.patient.id,
        status: { $ne: 'CANCELLED' },
      }).lean();
      const deposit = deps.reduce((t, d) => t + d.amount - (d.used ?? 0) - (d.refunded ?? 0), 0);
      const total = bill?.totals?.total ?? 0;
      const ratio = total ? deposit / total : 1;
      items.push({
        ipNo: a.ipNo,
        patient: a.patient?.name,
        ward: a.bed?.ward ?? '',
        bill: total,
        deposit,
        balance: total - deposit,
        cover:
          ratio >= 1
            ? tone.ok('Covered')
            : ratio >= 0.8
              ? tone.warn('Top-up soon')
              : tone.bad('Top-up needed'),
      });
    }
    items.sort((x, y) => x.deposit - x.bill - (y.deposit - y.bill));
    return {
      kpis: [
        ['inPatients', 'In-patients', items.length, 'count'],
        [
          'short',
          'Below 80% cover',
          items.filter((i) => i.cover.tone === 'critical').length,
          'count',
        ],
      ],
      items,
    };
  },
});

registerReport({
  code: 'ipd-discharge-tat',
  name: 'Discharge turnaround',
  group: GROUPS.IPD,
  module: 'IPD',
  permission: 'reports:ipd:read',
  description: 'From discharge advice to leaving the bed, with the bill-ready step.',
  columns: [
    ['ipNo', 'IP no.', 'id'],
    ['patient', 'Patient', 'text'],
    ['adviceAt', 'Advised', 'datetime'],
    ['billMin', 'To bill ready', 'minutes'],
    ['totalMin', 'To leaving', 'minutes'],
    ['status', 'Against 3 h target', 'status'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await Admission.find({
      leftAt: { $gte: p.from, $lte: p.to },
      dischargeAdviceAt: { $ne: null },
    }).lean();
    const items = rows.map((a) => {
      const total = mins(a.dischargeAdviceAt, a.leftAt);
      return {
        ipNo: a.ipNo,
        patient: a.patient?.name,
        adviceAt: a.dischargeAdviceAt,
        billMin: mins(a.dischargeAdviceAt, a.billReadyAt),
        totalMin: total,
        status: total <= 180 ? tone.ok('Within') : tone.bad('Over'),
      };
    });
    return {
      kpis: [['median', 'Median turnaround', median(items.map((i) => i.totalMin)), 'minutes']],
      items,
    };
  },
});

registerReport({
  code: 'mar-delays',
  name: 'Medication administration delays',
  group: GROUPS.CLINICAL,
  module: 'IPD',
  permission: 'reports:nursing:read',
  description: 'Doses given more than 30 minutes after they were due, held, refused or missed.',
  columns: [
    ['dueAt', 'Due', 'datetime'],
    ['patient', 'Patient', 'text'],
    ['medicine', 'Medicine', 'text'],
    ['delayMin', 'Delay', 'minutes'],
    ['status', 'Status', 'status'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const doses = await MarDose.find({ dueAt: { $gte: p.from, $lte: p.to } })
      .populate('orderId', 'drug')
      .lean();
    const stays = new Map(
      (
        await Admission.find({
          _id: { $in: [...new Set(doses.map((d) => String(d.admissionId)))] },
        })
          .select('patient')
          .lean()
      ).map((a) => [String(a._id), a]),
    );
    const late = doses.filter((d) => d.status !== 'GIVEN' || mins(d.dueAt, d.givenAt) > 30);
    const given = doses.filter((d) => d.status === 'GIVEN');
    const onTime = given.filter((d) => mins(d.dueAt, d.givenAt) <= 30).length;
    return {
      kpis: [
        ['doses', 'Doses due', doses.length, 'count'],
        [
          'onTime',
          'Given on time',
          given.length ? Math.round((onTime * 1000) / doses.length) / 10 : 0,
          'percent',
        ],
      ],
      items: late.map((d) => ({
        dueAt: d.dueAt,
        patient: stays.get(String(d.admissionId))?.patient?.name ?? '',
        medicine: d.orderId?.drug?.brand ?? '',
        delayMin: d.status === 'GIVEN' ? mins(d.dueAt, d.givenAt) : null,
        status:
          d.status === 'GIVEN'
            ? tone.warn('Late')
            : d.status === 'DUE'
              ? tone.bad('Not given')
              : tone.plain(d.status),
      })),
    };
  },
});

registerReport({
  code: 'housekeeping-tat',
  name: 'Housekeeping TAT',
  group: GROUPS.SUPPORT,
  module: 'IPD',
  permission: 'reports:facility:read',
  description: 'Bed cleaning after discharge or transfer against the target.',
  columns: [
    ['openedAt', 'Bed vacated', 'datetime'],
    ['bed', 'Bed', 'text'],
    ['ward', 'Ward', 'text'],
    ['type', 'Type', 'text'],
    ['minutes', 'Cleaning time', 'minutes'],
    ['status', 'Status', 'status'],
  ],
  run: async ({ from, to }) => {
    const p = period({ from, to });
    const rows = await CleaningTask.find({ openedAt: { $gte: p.from, $lte: p.to } })
      .sort({ openedAt: 1 })
      .lean();
    const items = rows.map((t) => {
      const m = mins(t.openedAt, t.doneAt ?? new Date());
      const target = t.type === 'TERMINAL' ? 90 : 45;
      return {
        openedAt: t.openedAt,
        bed: t.bedCode,
        ward: t.ward,
        type: t.type,
        minutes: m,
        status:
          t.status === 'OPEN'
            ? tone.warn('Open')
            : m <= target
              ? tone.ok('Within target')
              : tone.bad('Over target'),
      };
    });
    return {
      kpis: [
        ['tasks', 'Beds cleaned', rows.filter((t) => t.status === 'DONE').length, 'count'],
        [
          'median',
          'Median time',
          median(items.filter((i) => i.status.label !== 'Open').map((i) => i.minutes)),
          'minutes',
        ],
      ],
      items,
    };
  },
});

const todayStart = () =>
  new Date(`${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}T00:00:00+05:30`);

registerTile({
  key: 'ipd-census',
  label: 'In-patients',
  group: GROUPS.IPD,
  module: 'IPD',
  permission: 'reports:ipd:read',
  report: 'ipd-occupancy-alos',
  run: async () => {
    const [inpatients, beds] = await Promise.all([
      Admission.countDocuments({ status: { $in: ACTIVE } }),
      Bed.countDocuments({ isActive: { $ne: false } }),
    ]);
    const occ = beds ? Math.round((inpatients * 100) / beds) : 0;
    return {
      value: inpatients,
      note: `${occ}% of ${beds} beds`,
      tone: occ >= 90 ? 'warning' : null,
    };
  },
});

registerTile({
  key: 'ipd-movement',
  label: 'Admitted · discharged today',
  group: GROUPS.IPD,
  module: 'IPD',
  permission: 'reports:ipd:read',
  kind: 'text',
  report: 'ipd-admission-register',
  run: async () => {
    const from = todayStart();
    const [inn, out] = await Promise.all([
      Admission.countDocuments({ admittedAt: { $gte: from } }),
      Admission.countDocuments({ leftAt: { $gte: from } }),
    ]);
    return { value: `${inn} · ${out}` };
  },
});
