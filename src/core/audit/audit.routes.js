import { z } from 'zod';
import { pageQuery } from '@hms/shared/schemas';
import { defineRoutes } from '../http/route.js';
import { paginate } from '../http/paginate.js';
import { AuditLog, AUDIT_ACTIONS } from './audit.model.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** IST hour of an instant: 0 to 23. */
const istHour = (d) => new Date(new Date(d).getTime() + 330 * 60_000).getUTCHours();
const OUT_OF_HOURS = (h) => h >= 22 || h < 6;

/**
 * The day's exceptions for the morning review (board Audit log, "Daily exceptions"): failed
 * sign-ins, refused access, activity between 22:00 and 06:00, bulk exports, duplicate prints,
 * deletions and reused sessions. Each with a count and the latest example.
 */
async function exceptions(date) {
  const start = new Date(`${date}T00:00:00+05:30`);
  const end = new Date(`${date}T23:59:59.999+05:30`);
  const rows = await AuditLog.find({ at: { $gte: start, $lte: end } })
    .select('action entity summary userName at ip')
    .sort({ at: -1 })
    .limit(20_000)
    .lean();
  const people = rows.filter((r) => r.userName && !String(r.userName).startsWith('system'));
  const groups = [
    ['FAILED_LOGINS', rows.filter((r) => ['LOGIN_FAILED', 'ACCOUNT_LOCKED'].includes(r.action))],
    ['ACCESS_DENIED', rows.filter((r) => r.action === 'ACCESS_DENIED')],
    [
      'OUT_OF_HOURS',
      people.filter((r) => r.action !== 'LOGIN_FAILED' && OUT_OF_HOURS(istHour(r.at))),
    ],
    ['EXPORTS', rows.filter((r) => r.action === 'EXPORT')],
    [
      'DUPLICATE_PRINTS',
      rows.filter((r) => r.action === 'PRINT' && /DUPLICATE/.test(r.summary ?? '')),
    ],
    ['DELETIONS', rows.filter((r) => r.action === 'DELETE')],
    ['SESSION_REUSE', rows.filter((r) => r.action === 'SESSION_REUSE_DETECTED')],
  ];
  return {
    date,
    items: groups.map(([kind, list]) => ({
      kind,
      count: list.length,
      users: new Set(list.map((r) => r.userName).filter(Boolean)).size,
      example: list[0]
        ? {
            at: list[0].at,
            userName: list[0].userName,
            summary: list[0].summary ?? list[0].entity,
            ip: list[0].ip,
          }
        : null,
    })),
  };
}

const query = pageQuery.extend({
  entity: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  userId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  /** Several actions at once: "LOGIN,LOGIN_FAILED,ACCOUNT_LOCKED". */
  actions: z
    .string()
    .max(200)
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.enum(AUDIT_ACTIONS)).max(20))
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const auditRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/audit',
  routes: [
    {
      method: 'get',
      path: '/',
      permission: 'audit:log:read',
      audit: null,
      summary: 'Audit log, newest first, filterable by record, user, action and date',
      schema: { query },
      handler: (req) => {
        const { entity, entityId, userId, action, actions, from, to, ...page } = req.valid.query;
        const filter = {
          ...(entity ? { entity } : {}),
          ...(entityId ? { entityId } : {}),
          ...(userId ? { userId } : {}),
          ...(action ? { action } : actions?.length ? { action: { $in: actions } } : {}),
          ...(from || to
            ? { at: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } }
            : {}),
        };
        return paginate(
          AuditLog,
          filter,
          { ...page, sort: '-at' },
          {
            allowedSort: ['at'],
            defaultSort: '-at',
            map: ({ _id, tenantId: _t, ...r }) => ({
              id: String(_id),
              ...r,
              userId: r.userId ? String(r.userId) : undefined,
            }),
          },
        );
      },
    },
    {
      method: 'get',
      path: '/exceptions',
      permission: 'audit:log:read',
      audit: null,
      summary: "The day's exceptions to review: failed sign-ins, out-of-hours work, exports",
      schema: { query: z.object({ date: day }) },
      handler: (req) => exceptions(req.valid.query.date),
    },
  ],
});
