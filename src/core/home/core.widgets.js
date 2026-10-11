import { boxFilter } from '../approvals/approval.routes.js';
import { ApprovalRequest } from '../approvals/approval.model.js';
import { AuditLog } from '../audit/audit.model.js';
import { User } from '../auth/models/user.model.js';
import { registerHome, status } from './registry.js';

/** Widgets every module shares: approvals waiting, my own requests, the audit trail. */
const CHECKERS = [
  'superadmin',
  'admin',
  'medsupt',
  'hod',
  'wardincharge',
  'billingmgr',
  'store',
  'hr',
  'accounts',
  'mrd',
  'facility',
  'quality',
  'lab',
  'radiology',
  'pharmacy',
];

registerHome({
  id: 'core.approvals',
  panels: CHECKERS,
  permission: 'authenticated',
  kind: 'kpi',
  order: 60,
  build: async () => {
    const filter = boxFilter('inbox');
    if (filter._id === null) return null;
    const n = await ApprovalRequest.countDocuments(filter);
    return { value: n, format: 'count', tone: n ? 'warning' : 'neutral', link: '/approvals' };
  },
});

registerHome({
  id: 'core.myRequests',
  panels: ['admin', 'cashier', 'store', 'hr', 'payroll', 'facility', 'mrd'],
  permission: 'authenticated',
  kind: 'kpi',
  order: 70,
  build: async (ctx) => {
    const n = await ApprovalRequest.countDocuments({
      makerId: ctx.userId,
      status: 'PENDING',
      expiresAt: { $gt: ctx.now },
    });
    return { value: n, format: 'count', link: '/approvals?box=mine' };
  },
});

registerHome({
  id: 'core.usersPending',
  panels: ['admin', 'superadmin'],
  permission: 'settings:user:read',
  kind: 'kpi',
  order: 80,
  build: async () => {
    const [invited, approval] = await Promise.all([
      User.countDocuments({ status: 'INVITED' }),
      User.countDocuments({ status: 'PENDING_APPROVAL' }),
    ]);
    return {
      value: invited + approval,
      format: 'count',
      params: { invited, approval },
      link: '/settings/users',
    };
  },
});

const SENSITIVE = [
  'EXPORT',
  'DELETE',
  'ACCESS_DENIED',
  'ACCOUNT_LOCKED',
  'SESSION_REUSE_DETECTED',
  'LOGIN_FAILED',
];

registerHome({
  id: 'core.auditToday',
  panels: ['auditor', 'superadmin'],
  permission: 'audit:log:read',
  kind: 'kpi',
  order: 40,
  build: async (ctx) => {
    const [n, sensitive] = await Promise.all([
      AuditLog.countDocuments({ at: { $gte: ctx.day.start, $lte: ctx.day.end } }),
      AuditLog.countDocuments({
        at: { $gte: ctx.day.start, $lte: ctx.day.end },
        action: { $in: SENSITIVE },
      }),
    ]);
    return {
      value: n,
      format: 'count',
      params: { sensitive },
      tone: sensitive ? 'warning' : 'neutral',
      link: '/audit',
    };
  },
});

registerHome({
  id: 'core.auditSensitive',
  panels: ['auditor'],
  permission: 'audit:log:read',
  kind: 'list',
  order: 100,
  build: async () => {
    const rows = await AuditLog.find({ action: { $in: SENSITIVE } })
      .select('action entity summary userName at')
      .sort({ at: -1 })
      .limit(12)
      .lean();
    return {
      link: '/audit',
      columns: [
        { key: 'at', kind: 'datetime' },
        { key: 'user', kind: 'text' },
        { key: 'what', kind: 'text' },
        { key: 'action', kind: 'status' },
      ],
      rows: rows.map((r) => ({
        id: String(r._id),
        at: r.at,
        user: r.userName,
        what: r.summary ?? r.entity,
        action: status(
          r.action,
          ['ACCESS_DENIED', 'SESSION_REUSE_DETECTED', 'ACCOUNT_LOCKED'].includes(r.action)
            ? 'critical'
            : 'warning',
        ),
      })),
    };
  },
});
