import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../http/route.js';
import { runAsSystem } from '../tenancy/context.js';
import { Tenant } from '../tenancy/tenant.model.js';
import * as rep from './reports.service.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const code = z.object({ code: z.string().regex(/^[a-z0-9-]{3,60}$/) });

/**
 * Reports centre (board Reports). Mounted after the modules, so a module's own analytics route
 * under /reports (e.g. /reports/opd-wait-times) answers first.
 */
export const reportRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/reports',
  routes: [
    {
      method: 'get',
      path: '',
      permission: 'authenticated',
      audit: null,
      summary: 'Reports the user may run, by group',
      handler: () => rep.catalogue(),
    },
    {
      method: 'get',
      path: '/dashboard',
      permission: 'authenticated',
      audit: null,
      summary: 'Today’s numbers across the hospital (tiles the user may see)',
      handler: () => rep.dashboard(),
    },
    {
      method: 'get',
      path: '/exports',
      permission: 'authenticated',
      audit: null,
      summary: 'My exports (all exports for the Super Admin)',
      schema: {
        query: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
      },
      handler: (req) => rep.listExports(req.valid.query),
    },
    {
      method: 'get',
      path: '/exports/:id/download',
      permission: 'authenticated',
      audit: 'EXPORT',
      summary: 'A 5-minute download link for an export',
      schema: { params: z.object({ id: objectId }) },
      handler: (req) => rep.downloadExport(req.valid.params.id),
    },
    {
      method: 'get',
      path: '/schedules',
      permission: 'authenticated',
      audit: null,
      summary: 'Scheduled reports',
      handler: () => rep.listSchedules(),
    },
    {
      method: 'post',
      path: '/schedules',
      permission: 'authenticated',
      audit: 'CREATE',
      status: 201,
      summary: 'Schedule a report (runs with the creator’s permissions)',
      schema: { body: rep.scheduleInput },
      handler: (req) => rep.createSchedule(req.valid.body),
    },
    {
      method: 'put',
      path: '/schedules/:id',
      permission: 'authenticated',
      audit: 'UPDATE',
      summary: 'Pause or resume a schedule',
      schema: { params: z.object({ id: objectId }), body: z.object({ active: z.boolean() }) },
      handler: (req) => rep.setScheduleActive(req.valid.params.id, req.valid.body),
    },
    {
      method: 'delete',
      path: '/schedules/:id',
      permission: 'authenticated',
      audit: 'DELETE',
      summary: 'Delete a schedule',
      schema: { params: z.object({ id: objectId }) },
      handler: (req) => rep.deleteSchedule(req.valid.params.id),
    },
    {
      method: 'get',
      path: '/:code',
      permission: 'authenticated',
      audit: 'VIEW',
      summary: 'Run a report for a period (the report checks its own permission)',
      schema: {
        params: code,
        query: z
          .object({
            from: ymd.optional(),
            to: ymd.optional(),
            branchId: objectId.optional(),
            q: z.string().trim().max(80).optional(),
            page: z.coerce.number().int().min(1).default(1),
            limit: z.coerce.number().int().min(1).max(500).default(50),
          })
          .catchall(z.string().max(80)),
      },
      handler: (req) => rep.run(req.valid.params.code, req.valid.query),
    },
    {
      method: 'post',
      path: '/:code/export',
      permission: 'authenticated',
      audit: 'EXPORT',
      status: 201,
      summary: 'Export a report to XLSX or PDF',
      schema: { params: code, body: rep.exportInput },
      handler: (req) => rep.exportReport(req.valid.params.code, req.valid.body),
    },
  ],
});

const router = Router();
router.use(reportRoutes);
export const reportsModule = { name: 'reports', router };

/** Worker: due report schedules in every hospital. */
export async function sweepReportSchedules(now = new Date()) {
  const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } }).select('_id modules');
  let n = 0;
  for (const t of tenants)
    n += await runAsSystem(t._id, () => rep.runDueSchedules(now), {
      userName: 'system: reports',
      modules: new Set(t.activeModules(now)),
    });
  return { ran: n };
}
