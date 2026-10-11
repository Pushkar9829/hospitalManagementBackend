import { registerHome, status } from '../../core/home/registry.js';
import { Bed, Doctor, Ward } from '../setup/index.js';
import { MarDose, MedOrder, IpdVitals } from './models/clinical.models.js';
import { PreAuth } from './models/insurance.models.js';
import { Admission, BedState, CleaningTask } from './models/ipd.models.js';

/** In-patient widgets: beds, the doctor's patients, nursing doses, discharges, the TPA desk. */
const IN_HOSPITAL = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];
const DISCHARGING = ['DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];
const WAITING_INSURER = ['SENT', 'QUERY', 'ENHANCEMENT_SENT', 'FINAL_SENT'];
const myDoctor = (ctx) => Doctor.findOne({ userId: ctx.userId }).select('_id').lean();

async function occupancy() {
  const [beds, occupied] = await Promise.all([
    Bed.countDocuments({ isActive: true }),
    BedState.countDocuments({ status: 'OCCUPIED' }),
  ]);
  return { beds, occupied, percent: beds ? Math.round((occupied * 100) / beds) : 0 };
}

registerHome({
  id: 'ipd.occupancy',
  panels: ['superadmin', 'admin', 'medsupt', 'wardincharge', 'frontoffice'],
  permission: 'ipd:bed:read',
  module: 'IPD',
  kind: 'kpi',
  order: 5,
  build: async () => {
    const o = await occupancy();
    if (!o.beds) return null;
    return {
      value: o.percent,
      format: 'percent',
      params: { occupied: o.occupied, beds: o.beds },
      tone: o.percent >= 95 ? 'critical' : o.percent >= 85 ? 'warning' : 'neutral',
      link: '/ipd/beds',
    };
  },
});

registerHome({
  id: 'ipd.admissionsToday',
  panels: ['admin', 'frontoffice', 'medsupt'],
  permission: 'ipd:admission:read',
  module: 'IPD',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => ({
    value: await Admission.countDocuments({
      admittedAt: { $gte: ctx.day.start, $lte: ctx.day.end },
    }),
    format: 'count',
    link: '/ipd/beds',
  }),
});

registerHome({
  id: 'ipd.dischargesDue',
  panels: ['medsupt', 'wardincharge', 'tpa', 'billingmgr'],
  permission: 'ipd:admission:read',
  module: 'IPD',
  kind: 'kpi',
  order: 25,
  build: async (ctx) => {
    const [planned, expected] = await Promise.all([
      Admission.countDocuments({ status: { $in: DISCHARGING } }),
      Admission.countDocuments({
        status: { $in: IN_HOSPITAL },
        expectedDischargeAt: { $lte: ctx.day.end },
      }),
    ]);
    return { value: planned, format: 'count', params: { expected }, link: '/ipd/discharge' };
  },
});

registerHome({
  id: 'ipd.myPatients',
  panels: ['doctor'],
  permission: 'ipd:note:write',
  module: 'IPD',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => {
    const d = await myDoctor(ctx);
    if (!d) return null;
    const rows = await Admission.find({ 'consultant.id': d._id, status: { $in: IN_HOSPITAL } })
      .select('bed.category')
      .lean();
    return {
      value: rows.length,
      format: 'count',
      params: {
        icu: rows.filter((a) => ['ICU', 'NICU', 'PICU', 'HDU'].includes(a.bed?.category)).length,
      },
      link: '/ipd/rounds',
    };
  },
});

registerHome({
  id: 'ipd.summariesToSign',
  panels: ['doctor'],
  permission: 'ipd:discharge:read',
  module: 'IPD',
  kind: 'kpi',
  order: 35,
  build: async (ctx) => {
    const d = await myDoctor(ctx);
    if (!d) return null;
    const n = await Admission.countDocuments({
      'consultant.id': d._id,
      status: { $in: DISCHARGING },
      'summary.status': { $ne: 'SIGNED' },
    });
    return { value: n, format: 'count', tone: n ? 'warning' : 'neutral', link: '/ipd/discharge' };
  },
});

registerHome({
  id: 'ipd.wardCensus',
  panels: ['medsupt', 'wardincharge', 'admin'],
  permission: 'ipd:bed:read',
  module: 'IPD',
  kind: 'list',
  order: 100,
  build: async () => {
    const [wards, beds, states] = await Promise.all([
      Ward.find({ isActive: true }).select('code name category').sort({ code: 1 }).lean(),
      Bed.find({ isActive: true }).select('wardId').lean(),
      BedState.find().select('bedId status').lean(),
    ]);
    if (!wards.length) return null;
    const wardOf = new Map(beds.map((b) => [String(b._id), String(b.wardId)]));
    const by = new Map(
      wards.map((w) => [
        String(w._id),
        { beds: 0, OCCUPIED: 0, AVAILABLE: 0, CLEANING: 0, RESERVED: 0, BLOCKED: 0 },
      ]),
    );
    for (const b of beds) {
      const r = by.get(String(b.wardId));
      if (r) r.beds += 1;
    }
    for (const s of states) {
      const r = by.get(wardOf.get(String(s.bedId)));
      if (r && s.status in r) r[s.status] += 1;
    }
    return {
      link: '/ipd/beds',
      columns: [
        { key: 'ward', kind: 'text' },
        { key: 'occupied', kind: 'text' },
        { key: 'available', kind: 'count' },
        { key: 'cleaning', kind: 'count' },
      ],
      rows: wards.map((w) => {
        const r = by.get(String(w._id));
        return {
          id: String(w._id),
          link: `/nursing/${w._id}`,
          ward: `${w.code} · ${w.name}`,
          occupied: `${r.OCCUPIED} / ${r.beds}`,
          // A bed without a state record yet has never been used: it is available.
          available:
            r.AVAILABLE +
            Math.max(0, r.beds - r.OCCUPIED - r.AVAILABLE - r.CLEANING - r.RESERVED - r.BLOCKED),
          cleaning: r.CLEANING,
        };
      }),
    };
  },
});

registerHome({
  id: 'ipd.bedsToClean',
  panels: ['facility', 'wardincharge'],
  permission: 'ipd:bed:read',
  module: 'IPD',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const open = await CleaningTask.find({ status: 'OPEN' }).select('openedAt type').lean();
    const late = open.filter((x) => ctx.now - new Date(x.openedAt) > 45 * 60_000).length;
    return {
      value: open.length,
      format: 'count',
      params: { late },
      tone: late ? 'warning' : 'neutral',
      link: '/facility',
    };
  },
});

// ---- nursing

registerHome({
  id: 'ipd.medsDue',
  panels: ['nurse', 'wardincharge'],
  permission: 'nursing:mar:read',
  module: 'IPD',
  kind: 'kpi',
  order: 15,
  build: async (ctx) => {
    const soon = new Date(ctx.now.getTime() + 60 * 60_000);
    const [due, late] = await Promise.all([
      MarDose.countDocuments({ status: 'DUE', dueAt: { $lte: soon } }),
      MarDose.countDocuments({
        status: 'DUE',
        dueAt: { $lt: new Date(ctx.now.getTime() - 30 * 60_000) },
      }),
    ]);
    return {
      value: due,
      format: 'count',
      params: { late },
      tone: late ? 'critical' : 'neutral',
      link: '/nursing/all',
    };
  },
});

registerHome({
  id: 'ipd.inpatients',
  panels: ['nurse', 'wardincharge'],
  permission: 'nursing:census:read',
  module: 'IPD',
  kind: 'kpi',
  order: 10,
  build: async () => ({
    value: await Admission.countDocuments({ status: { $in: IN_HOSPITAL } }),
    format: 'count',
    link: '/nursing/all',
  }),
});

registerHome({
  id: 'ipd.highRisk',
  panels: ['nurse', 'wardincharge', 'medsupt'],
  permission: 'nursing:census:read',
  module: 'IPD',
  kind: 'kpi',
  order: 20,
  build: async (ctx) => {
    const since = new Date(ctx.now.getTime() - 12 * 3_600_000);
    const ids = await IpdVitals.distinct('admissionId', { risk: 'HIGH', at: { $gte: since } });
    return {
      value: ids.length,
      format: 'count',
      tone: ids.length ? 'critical' : 'neutral',
      link: '/nursing/all',
    };
  },
});

registerHome({
  id: 'ipd.doses',
  panels: ['nurse'],
  permission: 'nursing:mar:read',
  module: 'IPD',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const doses = await MarDose.find({
      status: 'DUE',
      dueAt: { $lte: new Date(ctx.now.getTime() + 2 * 3_600_000) },
    })
      .select('orderId admissionId dueAt')
      .sort({ dueAt: 1 })
      .limit(15)
      .lean();
    if (!doses.length) return { link: '/nursing/all', columns: [], rows: [] };
    const [orders, stays] = await Promise.all([
      MedOrder.find({ _id: { $in: doses.map((d) => d.orderId) } })
        .select('drug dose route highAlert')
        .lean(),
      Admission.find({ _id: { $in: doses.map((d) => d.admissionId) } })
        .select('patient.name bed.code')
        .lean(),
    ]);
    const order = new Map(orders.map((o) => [String(o._id), o]));
    const stay = new Map(stays.map((a) => [String(a._id), a]));
    return {
      link: '/nursing/all',
      columns: [
        { key: 'time', kind: 'time' },
        { key: 'bed', kind: 'id' },
        { key: 'patient', kind: 'text' },
        { key: 'task', kind: 'text' },
        { key: 'status', kind: 'status' },
      ],
      rows: doses.map((d) => {
        const o = order.get(String(d.orderId));
        const a = stay.get(String(d.admissionId));
        const late = new Date(d.dueAt) < new Date(ctx.now.getTime() - 30 * 60_000);
        return {
          id: String(d._id),
          time: d.dueAt,
          bed: a?.bed?.code,
          patient: a?.patient?.name,
          task: [o?.drug?.brand, o?.dose, o?.route].filter(Boolean).join(' '),
          status: late
            ? status('LATE', 'critical')
            : o?.highAlert
              ? status('HIGH_ALERT', 'warning')
              : status('DUE', 'info'),
        };
      }),
    };
  },
});

// ---- insurance desk

registerHome({
  id: 'ipd.tpaWaiting',
  panels: ['tpa', 'billingmgr'],
  permission: 'ipd:preauth:read',
  module: 'IPD',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const [waiting, overdue] = await Promise.all([
      PreAuth.countDocuments({ status: { $in: WAITING_INSURER } }),
      PreAuth.countDocuments({ status: { $in: WAITING_INSURER }, replyDueAt: { $lt: ctx.now } }),
    ]);
    return {
      value: waiting,
      format: 'count',
      params: { overdue },
      tone: overdue ? 'warning' : 'neutral',
      link: '/ipd/insurance',
    };
  },
});

registerHome({
  id: 'ipd.tpaToClaim',
  panels: ['tpa'],
  permission: 'ipd:preauth:read',
  module: 'IPD',
  kind: 'kpi',
  order: 20,
  build: async () => ({
    value: await PreAuth.countDocuments({ status: 'FINAL_APPROVED' }),
    format: 'count',
    link: '/ipd/insurance',
  }),
});

registerHome({
  id: 'ipd.tpaToSettle',
  panels: ['tpa'],
  permission: 'ipd:preauth:read',
  module: 'IPD',
  kind: 'kpi',
  order: 30,
  build: async () => {
    const rows = await PreAuth.find({ status: 'CLAIMED' }).select('finalApproved approved').lean();
    return {
      value: rows.length,
      format: 'count',
      params: { amount: rows.reduce((t, p) => t + (p.finalApproved ?? p.approved ?? 0), 0) },
      link: '/ipd/insurance',
    };
  },
});

registerHome({
  id: 'ipd.tpaList',
  panels: ['tpa'],
  permission: 'ipd:preauth:read',
  module: 'IPD',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await PreAuth.find({
      status: { $in: [...WAITING_INSURER, 'FINAL_APPROVED', 'CLAIMED'] },
    })
      .select('ipNo patient payer status replyDueAt')
      .sort({ replyDueAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/ipd/insurance',
      columns: [
        { key: 'ipNo', kind: 'id' },
        { key: 'patient', kind: 'text' },
        { key: 'payer', kind: 'text' },
        { key: 'due', kind: 'datetime' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((p) => ({
        id: String(p._id),
        ipNo: p.ipNo,
        patient: p.patient?.name,
        payer: p.payer?.name,
        due: p.replyDueAt,
        status: status(
          p.status,
          p.status === 'QUERY' || (p.replyDueAt && new Date(p.replyDueAt) < ctx.now)
            ? 'warning'
            : 'info',
        ),
      })),
    };
  },
});
