import { registerHome, status } from '../../core/home/registry.js';
import { Patient } from '../patients/index.js';
import { FoToken, VisitorPass } from './models/frontoffice.models.js';

/** Front office and security widgets: registrations, the token queue, visitors inside. */

registerHome({
  id: 'fo.registered',
  panels: ['frontoffice', 'admin'],
  permission: 'patients:patient:create',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => ({
    value: await Patient.countDocuments({ createdAt: { $gte: ctx.day.start, $lte: ctx.day.end } }),
    format: 'count',
    link: '/patients',
  }),
});

registerHome({
  id: 'fo.tokens',
  panels: ['frontoffice'],
  permission: 'frontoffice:token:read',
  kind: 'kpi',
  order: 40,
  build: async (ctx) => {
    const waiting = await FoToken.find({ date: ctx.today, status: 'WAITING' })
      .select('createdAt')
      .lean();
    const longest = waiting.reduce(
      (m, x) => Math.max(m, Math.round((ctx.now - new Date(x.createdAt)) / 60_000)),
      0,
    );
    return { value: waiting.length, format: 'count', params: { longest }, link: '/front-office' };
  },
});

registerHome({
  id: 'fo.visitors',
  panels: ['security', 'frontoffice'],
  permission: 'frontoffice:pass:read',
  kind: 'kpi',
  order: 10,
  build: async (ctx) => {
    const [inside, overtime] = await Promise.all([
      VisitorPass.countDocuments({ type: 'VISITOR', status: 'INSIDE' }),
      VisitorPass.countDocuments({
        type: 'VISITOR',
        status: 'INSIDE',
        validUntil: { $lt: ctx.now },
      }),
    ]);
    return {
      value: inside,
      format: 'count',
      params: { overtime },
      tone: overtime ? 'warning' : 'neutral',
      link: '/front-office?tab=log',
    };
  },
});

registerHome({
  id: 'fo.attendants',
  panels: ['security'],
  permission: 'frontoffice:pass:read',
  kind: 'kpi',
  order: 20,
  build: async () => ({
    value: await VisitorPass.countDocuments({
      type: 'ATTENDANT',
      status: { $in: ['INSIDE', 'OUT'] },
      validUntil: { $gte: new Date() },
    }),
    format: 'count',
    link: '/front-office?tab=log',
  }),
});

registerHome({
  id: 'fo.visitorList',
  panels: ['security'],
  permission: 'frontoffice:pass:read',
  kind: 'list',
  order: 100,
  build: async (ctx) => {
    const rows = await VisitorPass.find({ status: 'INSIDE' })
      .select('passNo visitor patient bed type inAt validUntil')
      .sort({ validUntil: 1 })
      .limit(15)
      .lean();
    return {
      link: '/front-office?tab=log',
      columns: [
        { key: 'pass', kind: 'id' },
        { key: 'visitor', kind: 'text' },
        { key: 'patient', kind: 'text' },
        { key: 'in', kind: 'time' },
        { key: 'status', kind: 'status' },
      ],
      rows: rows.map((p) => {
        const over = p.validUntil && new Date(p.validUntil) < ctx.now;
        return {
          id: String(p._id),
          pass: p.passNo,
          visitor: p.visitor?.name,
          patient: [p.patient?.name, p.bed].filter(Boolean).join(' · '),
          in: p.inAt,
          status: status(over ? 'OVERTIME' : p.type, over ? 'warning' : 'info'),
        };
      }),
    };
  },
});
