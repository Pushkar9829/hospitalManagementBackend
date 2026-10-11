import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as ins from './services/insurance.service.js';
import * as reports from './services/reports.service.js';

const id = z.object({ id: objectId });
const text = (max = 300) => z.string().trim().max(max);
const paise = z.number().int().min(0).max(10_00_00_000_00);
const READ = ['ipd:preauth:read', 'billing:ip:read'];

/** Insurance and TPA desk (board IpdTpa): pre-authorisation, enhancement, final approval, claim. */
export const insuranceRoutes = defineRoutes({
  module: 'IPD',
  basePath: '/ipd',
  routes: [
    {
      method: 'get',
      path: '/preauths',
      permission: READ,
      audit: null,
      summary: 'TPA worklist: overdue replies and enhancements due first',
      schema: {
        query: z.object({ open: z.coerce.boolean().default(true), status: text(120).optional() }),
      },
      handler: (req) => ins.listCases(req.valid.query),
    },
    {
      method: 'get',
      path: '/preauths/:id',
      permission: READ,
      audit: 'VIEW',
      summary: 'One cashless case with the running bill against the approval',
      schema: { params: id },
      handler: (req) => ins.getCase(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/admissions/:id/preauth',
      permission: 'ipd:preauth:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Send the cashless request (rule R8; insurer reply due in 1 h)',
      schema: {
        params: id,
        body: z.object({
          requested: paise,
          diagnosis: text(300).optional(),
          plannedTreatment: text(500).optional(),
          memberId: text(40).optional(),
        }),
      },
      handler: (req) => ins.sendPreAuth(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/preauths/:id/reply',
      permission: 'ipd:preauth:update',
      audit: 'UPDATE',
      summary:
        'Record the insurer’s reply: approved, query or denied (denied: the stay becomes cash)',
      schema: {
        params: id,
        body: z.object({
          outcome: z.enum(['APPROVED', 'QUERY', 'DENIED']),
          amount: paise.optional(),
          text: text(1000).optional(),
        }),
      },
      handler: (req) => ins.recordReply(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/preauths/:id/answer-query',
      permission: 'ipd:preauth:update',
      audit: 'UPDATE',
      summary: 'Answer the insurer’s query (new 1-hour clock)',
      schema: { params: id, body: z.object({ text: text(1000).min(3) }) },
      handler: (req) => ins.answerQuery(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/preauths/:id/enhancements',
      permission: 'ipd:preauth:update',
      audit: 'UPDATE',
      summary: 'Ask for an enhancement (rule R9)',
      schema: {
        params: id,
        body: z.object({
          amount: paise.refine((v) => v > 0, 'Enter the amount'),
          reason: text(500).min(3),
        }),
      },
      handler: (req) => ins.requestEnhancement(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/preauths/:id/final',
      permission: 'ipd:preauth:update',
      audit: 'UPDATE',
      summary: 'Send the final bill for discharge approval (3-hour clock)',
      schema: { params: id },
      noBody: true,
      handler: (req) => ins.sendFinal(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/preauths/:id/claim',
      permission: 'ipd:preauth:update',
      audit: 'CREATE',
      summary: 'File the claim',
      schema: { params: id, body: z.object({ claimNo: text(60).min(2) }) },
      handler: (req) => ins.fileClaim(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/preauths/:id/settle',
      permission: 'ipd:preauth:update',
      audit: 'UPDATE',
      summary: 'Record the settlement; a short payment needs its deductions',
      schema: {
        params: id,
        body: z.object({
          amount: paise,
          utr: text(40).min(4),
          deductions: z
            .array(z.object({ reason: text(200).min(2), amount: paise }))
            .max(20)
            .default([]),
        }),
      },
      handler: (req) => ins.settle(req.valid.params.id, req.valid.body),
    },
  ],
});

/** IPD analytics (board IpdAnalytics). */
export const ipdReportRoutes = defineRoutes({
  module: 'IPD',
  basePath: '/reports',
  routes: [
    {
      method: 'get',
      path: '/ipd-census',
      permission: ['reports:ipd:read', 'nursing:census:read'],
      audit: null,
      summary: 'Census now: wards, beds, occupancy and patients',
      handler: () => reports.census(),
    },
    {
      method: 'get',
      path: '/ipd-indicators',
      permission: 'reports:ipd:read',
      audit: null,
      summary:
        'Occupancy, ALOS, turnover, death and LAMA rates, turnaround, doses on time, pre-auth reply',
      schema: { query: z.object({ period: z.enum(['today', 'week', 'month']).default('month') }) },
      handler: (req) => reports.indicators(req.valid.query),
    },
  ],
});
