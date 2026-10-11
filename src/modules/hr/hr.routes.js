import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { hasPermission } from '@hms/shared';
import { defineRoutes } from '../../core/http/route.js';
import { AppError } from '../../core/errors/index.js';
import { current } from '../../core/tenancy/context.js';
import * as hr from './services/hr.service.js';
import * as profile from './services/profile.service.js';
import { LeaveRequest } from './models/hr.models.js';

const id = z.object({ id: objectId });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const can = (key) => hasPermission([...current().permissions], key);

/** HR (board Hr), rosters (board Roster) and employee self-service (board MySpace). */
export const hrRoutes = defineRoutes({
  module: 'HRM',
  basePath: '/hr',
  routes: [
    {
      method: 'get',
      path: '/employees',
      permission: ['hr:employee:read', 'hr:roster:write'],
      audit: null,
      summary: 'Employees by status, department or search',
      schema: {
        query: z.object({
          q: z.string().trim().max(80).optional(),
          status: z.string().max(60).optional(),
          departmentId: objectId.optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
      },
      handler: (req) => hr.listEmployees(req.valid.query),
    },
    {
      method: 'post',
      path: '/employees',
      permission: 'hr:employee:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Add an employee (employee number from the EMPLOYEE series)',
      schema: { body: hr.employeeInput },
      handler: (req) => hr.createEmployee(req.valid.body),
    },
    {
      method: 'get',
      path: '/employees/:id',
      permission: 'hr:employee:read',
      audit: 'VIEW',
      summary: 'An employee with history (bank and Aadhaar masked)',
      schema: { params: id },
      handler: (req) => hr.getEmployee(req.valid.params.id),
    },
    {
      method: 'put',
      path: '/employees/:id',
      permission: 'hr:employee:update',
      audit: 'UPDATE',
      summary: 'Edit an employee; transfers and promotions go into the history',
      schema: { params: id, body: hr.employeeInput.partial() },
      handler: (req) => hr.updateEmployee(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/employees/:id/exit',
      permission: 'hr:employee:update',
      audit: 'UPDATE',
      summary: 'Resignation or exit with the last working day',
      schema: {
        params: id,
        body: z.object({ exitOn: ymd, reason: z.string().trim().min(3).max(200) }),
      },
      handler: (req) => hr.exitEmployee(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/credential-alerts',
      permission: 'hr:employee:read',
      audit: null,
      summary: 'Clinical registrations expiring soon or expired',
      handler: () => hr.credentialAlerts(),
    },
    {
      method: 'get',
      path: '/employees/:id/leave-balances',
      permission: 'hr:employee:read',
      audit: null,
      summary: 'Leave balances for a year',
      schema: {
        params: id,
        query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
      },
      handler: (req) => hr.balances(req.valid.params.id, req.valid.query.year),
    },
    {
      method: 'post',
      path: '/employees/:id/leave-requests',
      permission: 'hr:leave:approve',
      audit: 'CREATE',
      status: 201,
      summary: 'HR applies leave on an employee’s behalf',
      schema: { params: id, body: hr.leaveInput },
      handler: (req) => hr.applyLeave(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/leave-requests',
      permission: ['hr:leave:approve', 'hr:leave:read', 'myspace:team:approve'],
      audit: null,
      summary: 'Leave requests (HR and HR readers see all; a manager sees the team)',
      schema: { query: z.object({ status: z.string().max(60).optional() }) },
      handler: async (req) => {
        if (can('hr:leave:approve') || can('hr:leave:read')) return hr.listLeave(req.valid.query);
        // A manager's team; a login without an employee record has no team.
        const me = await hr.myEmployee().catch(() => null);
        if (!me) return { items: [], total: 0, page: 1, limit: 300 };
        return hr.listLeave({ ...req.valid.query, managerId: me._id });
      },
    },
    {
      method: 'post',
      path: '/leave-requests/:id/decision',
      permission: ['hr:leave:approve', 'myspace:team:approve'],
      audit: 'APPROVE',
      summary: 'Approve or reject leave (HR, or the reporting manager)',
      schema: {
        params: id,
        body: z.object({
          decision: z.enum(['APPROVE', 'REJECT']),
          note: z.string().trim().max(200).optional(),
        }),
      },
      handler: async (req) => {
        if (!can('hr:leave:approve')) {
          const me = await hr.myEmployee();
          const l = await LeaveRequest.findById(req.valid.params.id).select('managerId').lean();
          if (!l || String(l.managerId) !== String(me._id))
            throw new AppError(
              403,
              'FORBIDDEN',
              'Only the reporting manager or HR decides this leave.',
            );
        }
        return hr.decideLeave(req.valid.params.id, req.valid.body);
      },
    },
    {
      method: 'get',
      path: '/attendance',
      permission: ['hr:attendance:read', 'hr:employee:read'],
      audit: null,
      summary: 'The month’s attendance grid with summaries',
      schema: {
        query: z.object({
          month,
          departmentId: objectId.optional(),
          employeeId: objectId.optional(),
        }),
      },
      handler: (req) => hr.monthGrid(req.valid.query),
    },
    {
      method: 'post',
      path: '/attendance/import',
      permission: 'hr:attendance:update',
      audit: 'CREATE',
      summary: 'Biometric punches (employee number, date, in, out)',
      schema: {
        body: z.object({
          rows: z
            .array(
              z.object({
                empNo: z.string().trim().max(20),
                date: ymd,
                in: z.string().regex(/^\d{2}:\d{2}$/),
                out: z.string().regex(/^\d{2}:\d{2}$/),
              }),
            )
            .min(1)
            .max(5000),
        }),
      },
      handler: (req) => hr.importPunches(req.valid.body),
    },
    {
      method: 'put',
      path: '/attendance',
      permission: 'hr:attendance:update',
      audit: 'UPDATE',
      summary: 'Mark or correct one day (regularisation)',
      schema: {
        body: z.object({
          employeeId: objectId,
          date: ymd,
          status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'LOP', 'HOLIDAY', 'WEEK_OFF']),
          note: z.string().trim().max(200).optional(),
        }),
      },
      handler: (req) => hr.markAttendance(req.valid.body),
    },
    {
      method: 'post',
      path: '/attendance/lock',
      permission: 'hr:attendance:lock',
      audit: 'APPROVE',
      summary: 'Lock a month for payroll (missing days become absent)',
      schema: { body: z.object({ month }) },
      handler: (req) => hr.lockMonth(req.valid.body.month),
    },
    {
      method: 'get',
      path: '/rosters',
      permission: ['hr:roster:read', 'hr:roster:write'],
      audit: null,
      summary: 'A unit’s roster for the week from a date, with cover per shift',
      schema: { query: z.object({ unit: z.string().trim().min(2).max(60), from: ymd }) },
      handler: (req) => hr.rosterWeek(req.valid.query),
    },
    {
      method: 'put',
      path: '/rosters',
      permission: 'hr:roster:write',
      audit: 'UPDATE',
      summary: 'Set roster cells (shift code or OFF; empty clears)',
      schema: { body: hr.rosterInput },
      handler: (req) => hr.saveRoster(req.valid.body),
    },
    {
      method: 'get',
      path: '/swaps',
      permission: ['hr:roster:write', 'hr:roster:read'],
      audit: null,
      summary: 'Shift swap requests',
      schema: {
        query: z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') }),
      },
      handler: (req) => hr.listSwaps(req.valid.query),
    },
    {
      method: 'post',
      path: '/swaps',
      permission: ['hr:roster:write', 'myspace:roster:swap'],
      audit: 'CREATE',
      status: 201,
      summary: 'Ask to swap a shift with a colleague',
      schema: {
        body: z.object({
          unit: z.string().trim().min(2).max(60),
          date: ymd,
          fromId: objectId,
          toId: objectId,
          reason: z.string().trim().max(200).optional(),
        }),
      },
      handler: (req) => hr.requestSwap(req.valid.body),
    },
    {
      method: 'post',
      path: '/swaps/:id/decision',
      permission: 'hr:roster:write',
      audit: 'APPROVE',
      summary: 'Approve or reject a swap (the roster changes on approval)',
      schema: { params: id, body: z.object({ approve: z.boolean() }) },
      handler: (req) => hr.decideSwap(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/settings',
      permission: 'authenticated',
      audit: null,
      summary: 'Leave types, shifts and attendance rules',
      handler: () => hr.getSettings(),
    },
  ],
});

/** Self-service for every employee (board MySpace). */
export const meRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/me',
  routes: [
    {
      method: 'get',
      path: '/employee',
      permission: 'myspace:profile:read',
      audit: null,
      summary: 'My employee record',
      handler: async () => hr.employeeOut(await hr.myEmployee()),
    },
    {
      method: 'get',
      path: '/profile-changes',
      permission: 'myspace:profile:read',
      audit: null,
      summary: 'My profile change requests and their state',
      handler: () => profile.myProfileChanges(),
    },
    {
      method: 'post',
      path: '/profile-changes',
      permission: 'myspace:profile:update',
      audit: 'CREATE',
      status: 201,
      summary: 'Ask HR to change my contact details, emergency contact or bank account',
      schema: { body: profile.profileChangeInput },
      handler: async (req, res) => {
        const r = await profile.requestProfileChange(req.valid.body);
        if (r.status === 'PENDING') res.locals.status = 202;
        return r;
      },
    },
    {
      method: 'get',
      path: '/leave',
      permission: 'myspace:leave:read',
      audit: null,
      summary: 'My leave balances and requests',
      handler: async () => {
        const me = await hr.myEmployee();
        return {
          balances: await hr.balances(me._id),
          requests: (
            await hr.listLeave({
              employeeId: me._id,
              status: 'PENDING,APPROVED,REJECTED,CANCELLED',
            })
          ).items,
        };
      },
    },
    {
      method: 'post',
      path: '/leave',
      permission: 'myspace:leave:apply',
      audit: 'CREATE',
      status: 201,
      summary: 'Apply for leave (balance, overlap and roster cover checked)',
      schema: { body: hr.leaveInput },
      handler: async (req) => hr.applyLeave((await hr.myEmployee())._id, req.valid.body),
    },
    {
      method: 'post',
      path: '/leave/:id/cancel',
      permission: 'myspace:leave:apply',
      audit: 'UPDATE',
      summary: 'Withdraw a pending request',
      schema: { params: id },
      noBody: true,
      handler: async (req) => hr.cancelLeave(req.valid.params.id, (await hr.myEmployee())._id),
    },
    {
      method: 'get',
      path: '/attendance',
      permission: 'myspace:attendance:read',
      audit: null,
      summary: 'My attendance for a month',
      schema: { query: z.object({ month }) },
      handler: async (req) =>
        hr.monthGrid({ month: req.valid.query.month, employeeId: (await hr.myEmployee())._id }),
    },
  ],
});
