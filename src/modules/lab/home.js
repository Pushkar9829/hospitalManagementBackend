import { registerHome, status } from '../../core/home/registry.js';
import { Doctor } from '../setup/index.js';
import { CriticalCall, HomeVisit, LabItem } from './models/lab.models.js';

/** Laboratory widgets: collection and validation worklists, critical results to call. */
const minutesSince = (d, now) => (d ? Math.max(0, Math.round((now - new Date(d)) / 60_000)) : null);
const myDoctor = (ctx) => Doctor.findOne({ userId: ctx.userId }).select('_id').lean();
const URGENT = ['URGENT', 'STAT'];

registerHome({
  id: 'lab.toCollect',
  panels: ['lab', 'phlebotomist'],
  permission: 'lab:item:read',
  module: 'LAB',
  kind: 'kpi',
  order: 10,
  build: async () => {
    const [n, urgent] = await Promise.all([
      LabItem.countDocuments({ status: 'ORDERED' }),
      LabItem.countDocuments({ status: 'ORDERED', priority: { $in: URGENT } }),
    ]);
    return {
      value: n,
      format: 'count',
      params: { urgent },
      tone: urgent ? 'warning' : 'neutral',
      link: '/lab/samples',
    };
  },
});

registerHome({
  id: 'lab.inProcess',
  panels: ['lab'],
  permission: 'lab:item:read',
  module: 'LAB',
  kind: 'kpi',
  order: 20,
  build: async () => ({
    value: await LabItem.countDocuments({ status: 'RECEIVED' }),
    format: 'count',
    link: '/lab',
  }),
});

registerHome({
  id: 'lab.toValidate',
  panels: ['lab'],
  permission: 'lab:item:read',
  module: 'LAB',
  kind: 'kpi',
  order: 30,
  build: async () => {
    const [n, critical] = await Promise.all([
      LabItem.countDocuments({ status: 'RESULTED' }),
      LabItem.countDocuments({ status: 'RESULTED', 'results.flag': { $in: ['LL', 'HH'] } }),
    ]);
    return {
      value: n,
      format: 'count',
      params: { critical },
      tone: critical ? 'critical' : 'neutral',
      link: '/lab',
    };
  },
});

registerHome({
  id: 'lab.releasedToday',
  panels: ['lab'],
  permission: 'lab:item:read',
  module: 'LAB',
  kind: 'kpi',
  order: 40,
  build: async (ctx) => {
    const released = await LabItem.find({ releasedAt: { $gte: ctx.day.start, $lte: ctx.day.end } })
      .select('dueAt releasedAt')
      .lean();
    const timed = released.filter((x) => x.dueAt);
    const met = timed.filter((x) => new Date(x.releasedAt) <= new Date(x.dueAt)).length;
    return {
      value: released.length,
      format: 'count',
      params: { tat: timed.length ? Math.round((met * 100) / timed.length) : 100 },
      link: '/lab/analytics',
    };
  },
});

registerHome({
  id: 'lab.validateList',
  panels: ['lab'],
  permission: 'lab:item:read',
  module: 'LAB',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await LabItem.find({ status: 'RESULTED' })
      .select('sampleNo orderNo patient name priority results enteredAt')
      .sort({ priority: -1, enteredAt: 1 })
      .limit(12)
      .lean();
    return {
      link: '/lab',
      columns: [
        { key: 'sample', kind: 'id' },
        { key: 'patient', kind: 'text' },
        { key: 'test', kind: 'text' },
        { key: 'flags', kind: 'status' },
        { key: 'waited', kind: 'minutes' },
      ],
      rows: rows.map((x) => {
        const flags = (x.results ?? []).map((r) => r.flag);
        const flag = flags.some((f) => f === 'LL' || f === 'HH')
          ? status('CRITICAL', 'critical')
          : flags.some((f) => f === 'H' || f === 'L')
            ? status('ABNORMAL', 'warning')
            : URGENT.includes(x.priority)
              ? status(x.priority, 'accent')
              : status('NORMAL', 'success');
        return {
          id: String(x._id),
          link: `/lab/report/${x.orderNo}`,
          sample: x.sampleNo ?? x.orderNo,
          patient: x.patient?.name,
          test: x.name,
          flags: flag,
          waited: minutesSince(x.enteredAt, ctx.now),
        };
      }),
    };
  },
});

registerHome({
  id: 'lab.collectList',
  panels: ['phlebotomist'],
  permission: 'lab:item:read',
  module: 'LAB',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await LabItem.find({ status: 'ORDERED' })
      .select('orderNo patient name priority location orderedAt')
      .sort({ orderedAt: 1 })
      .limit(15)
      .lean();
    return {
      link: '/lab/samples',
      columns: [
        { key: 'patient', kind: 'text' },
        { key: 'test', kind: 'text' },
        { key: 'location', kind: 'text' },
        { key: 'waited', kind: 'minutes' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((x) => ({
        id: String(x._id),
        patient: x.patient?.name,
        test: x.name,
        location: x.location,
        waited: minutesSince(x.orderedAt, ctx.now),
        status: URGENT.includes(x.priority)
          ? status(x.priority, 'critical')
          : status('ROUTINE', 'neutral'),
      })),
    };
  },
});

registerHome({
  id: 'lab.resultsToReview',
  panels: ['doctor', 'clinic'],
  permission: 'lab:result:acknowledge',
  module: 'LAB',
  kind: 'kpi',
  order: 30,
  build: async (ctx) => {
    const d = await myDoctor(ctx);
    if (!d) return null;
    const q = { 'doctor.id': d._id, status: 'RELEASED', acknowledgedAt: null };
    const [n, critical] = await Promise.all([
      LabItem.countDocuments(q),
      LabItem.countDocuments({ ...q, 'results.flag': { $in: ['LL', 'HH'] } }),
    ]);
    return {
      value: n,
      format: 'count',
      params: { critical },
      tone: critical ? 'critical' : 'neutral',
    };
  },
});

/** Critical results still being called; a doctor sees their own patients'. */
registerHome({
  id: 'lab.critical',
  panels: ['doctor', 'clinic', 'nurse', 'wardincharge', 'lab', 'medsupt'],
  permission: 'lab:critical:read',
  module: 'LAB',
  kind: 'alerts',
  order: 200,
  build: async (ctx) => {
    const calls = await CriticalCall.find({ status: 'OPEN' })
      .select('itemId orderNo patient location test analyte value flag dueAt escalatedAt createdAt')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    let mine = calls;
    const d = await myDoctor(ctx);
    if (d && calls.length) {
      const items = await LabItem.find({
        _id: { $in: calls.map((c) => c.itemId) },
        'doctor.id': d._id,
      })
        .select('_id')
        .lean();
      const own = new Set(items.map((i) => String(i._id)));
      mine = calls.filter((c) => own.has(String(c.itemId)));
    }
    return {
      items: mine.slice(0, 8).map((c) => ({
        type: c.escalatedAt ? 'criticalEscalated' : 'critical',
        tone: 'critical',
        at: c.createdAt,
        link: `/lab/report/${c.orderNo}`,
        params: {
          patient: c.patient?.name,
          test: c.analyte ?? c.test,
          value: c.value,
          location: c.location ?? '',
        },
      })),
    };
  },
});

const VISIT_TONE = {
  BOOKED: 'neutral',
  ASSIGNED: 'info',
  ON_THE_WAY: 'accent',
  COLLECTED: 'success',
};

registerHome({
  id: 'lab.homeVisits',
  panels: ['phlebotomist', 'lab'],
  permission: 'lab:homevisit:read',
  module: 'LAB',
  kind: 'kpi',
  order: 5,
  build: async (ctx) => {
    const q = { date: ctx.today, status: { $ne: 'CANCELLED' } };
    if (ctx.panel === 'phlebotomist') q['phlebotomist.userId'] = ctx.userId;
    const visits = await HomeVisit.find(q).select('status').lean();
    const done = visits.filter((v) => ['COLLECTED', 'HANDED_OVER'].includes(v.status)).length;
    return { value: visits.length, format: 'count', params: { done }, link: '/lab/home-visits' };
  },
});

registerHome({
  id: 'lab.myVisits',
  panels: ['phlebotomist'],
  permission: 'lab:homevisit:read',
  module: 'LAB',
  kind: 'list',
  order: 90,
  build: async (ctx) => {
    const rows = await HomeVisit.find({
      date: ctx.today,
      'phlebotomist.userId': ctx.userId,
      status: { $in: ['ASSIGNED', 'ON_THE_WAY', 'COLLECTED'] },
    })
      .select('slot patient address tests status')
      .sort({ slot: 1 })
      .lean();
    return {
      link: '/lab/home-visits',
      columns: [
        { key: 'time', kind: 'text' },
        { key: 'patient', kind: 'text' },
        { key: 'location', kind: 'text' },
        { key: 'items', kind: 'count' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((v) => ({
        id: String(v._id),
        time: v.slot,
        patient: v.patient?.name,
        location: v.address,
        items: v.tests?.length ?? 0,
        status: status(v.status, VISIT_TONE[v.status] ?? 'neutral'),
      })),
    };
  },
});
