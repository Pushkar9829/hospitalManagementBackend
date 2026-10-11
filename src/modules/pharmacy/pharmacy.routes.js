import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import * as ph from './services/pharmacy.service.js';

const id = z.object({ id: objectId });
const READ = ['pharmacy:sale:read', 'pharmacy:sale:create'];

/** Pharmacy (board Pharmacy): the queue, dispensing, ward returns, registers. */
export const pharmacyRoutes = defineRoutes({
  module: 'PHR',
  basePath: '/pharmacy',
  routes: withLiveUpdates(
    [
      {
        method: 'get',
        path: '/rx-queue',
        permission: READ,
        audit: null,
        summary: 'Prescriptions waiting: OPD and ward (STAT first)',
        schema: {
          query: z.object({
            status: z.string().max(60).optional(),
            source: z.enum(['OPD', 'IPD']).optional(),
            q: z.string().trim().max(80).optional(),
          }),
        },
        handler: (req) => ph.queue(req.valid.query),
      },
      {
        method: 'get',
        path: '/rx/:id',
        permission: READ,
        audit: 'VIEW',
        summary: 'A prescription matched to stock, with generic alternatives',
        schema: { params: id },
        handler: (req) => ph.getRx(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/rx/:id/cancel',
        permission: 'pharmacy:sale:create',
        audit: 'DELETE',
        summary: 'Cancel a prescription nobody will collect',
        schema: { params: id, body: z.object({ reason: z.string().trim().min(3).max(200) }) },
        handler: (req) => ph.cancelRx(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/sales',
        permission: 'pharmacy:sale:create',
        audit: 'CREATE',
        status: 201,
        summary:
          'Dispense: FEFO batches, substitution consent, H1/X prescriber, child weight check',
        schema: { body: ph.dispenseInput },
        handler: (req) => ph.dispense(req.valid.body),
      },
      {
        method: 'get',
        path: '/sales',
        permission: READ,
        audit: null,
        summary: 'Dispenses: today, or for a stay or a patient',
        schema: {
          query: z.object({
            admissionId: objectId.optional(),
            patientId: objectId.optional(),
            kind: z.enum(['SALE', 'ISSUE']).optional(),
            days: z.coerce.number().int().min(1).max(31).default(1),
          }),
        },
        handler: (req) => ph.listDispenses(req.valid.query),
      },
      {
        method: 'post',
        path: '/returns',
        permission: ['pharmacy:return:request', 'pharmacy:sale:create'],
        audit: 'CREATE',
        status: 201,
        summary: 'Ward returns unused medicines (settled before the final bill)',
        schema: { body: ph.returnInput },
        handler: (req) => ph.requestReturn(req.valid.body),
      },
      {
        method: 'get',
        path: '/returns',
        permission: ['pharmacy:return:read', 'pharmacy:return:request', 'pharmacy:sale:create'],
        audit: null,
        summary: 'Ward returns by status',
        schema: {
          query: z.object({
            status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).default('PENDING'),
          }),
        },
        handler: (req) => ph.listReturns(req.valid.query),
      },
      {
        method: 'post',
        path: '/returns/:id/decide',
        permission: 'pharmacy:sale:create',
        audit: 'APPROVE',
        summary: 'Accept (stock back, bill credited) or reject a ward return',
        schema: { params: id, body: z.object({ accept: z.boolean() }) },
        handler: (req) => ph.decideReturn(req.valid.params.id, req.valid.body),
      },
      {
        method: 'get',
        path: '/registers',
        permission: ['pharmacy:register:read', 'pharmacy:sale:create'],
        audit: 'VIEW',
        summary: 'Schedule H1, X and narcotic registers for a month',
        schema: {
          query: z.object({
            schedule: z.enum(['H1', 'X', 'NARCOTIC']).default('H1'),
            month: z
              .string()
              .regex(/^\d{4}-\d{2}$/)
              .optional(),
          }),
        },
        handler: (req) => ph.register(req.valid.query),
      },
      {
        method: 'get',
        path: '/sales-summary',
        permission: ['pharmacy:sale:read', 'reports:pharmacy:read', 'pharmacy:sale:create'],
        audit: null,
        summary: 'Day’s sales and ward issues with GST by rate',
        schema: {
          query: z.object({
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          }),
        },
        handler: (req) => ph.salesSummary(req.valid.query),
      },
    ],
    'pharmacy:update',
  ),
});
