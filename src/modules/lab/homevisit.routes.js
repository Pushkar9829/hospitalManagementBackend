import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as hv from './services/homevisit.service.js';

const id = z.object({ id: objectId });
const version = z.number().int().min(0);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const READ = ['lab:homevisit:read', 'lab:homevisit:create'];

/** Home collection visits (board "Phlebotomist phone screens"). */
export const homeVisitRoutes = defineRoutes({
  module: 'LAB',
  basePath: '/lab/home-visits',
  routes: [
    {
      method: 'get',
      path: '',
      permission: READ,
      audit: null,
      summary: 'Home visits by day; mine=true for the phlebotomist’s own',
      schema: {
        query: z.object({
          date: day.optional(),
          mine: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
          status: z
            .enum([
              'OPEN',
              'BOOKED',
              'ASSIGNED',
              'ON_THE_WAY',
              'COLLECTED',
              'HANDED_OVER',
              'CANCELLED',
            ])
            .optional(),
        }),
      },
      handler: (req) => hv.list(req.valid.query),
    },
    {
      method: 'get',
      path: '/staff',
      permission: READ,
      audit: null,
      summary: 'Phlebotomists a visit can be assigned to',
      handler: () => hv.phlebotomists(),
    },
    {
      method: 'post',
      path: '',
      permission: 'lab:homevisit:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Book a home collection: orders the tests (an OP bill to pay before collection)',
      schema: {
        body: z.object({
          patientId: objectId,
          tests: z.array(objectId).min(1).max(30),
          date: day,
          slot: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'Use HH:MM-HH:MM'),
          address: z.string().trim().min(5).max(300),
          landmark: z.string().trim().max(120).optional(),
          phone: z.string().trim().max(15).optional(),
          notes: z.string().trim().max(300).optional(),
          phlebotomistUserId: objectId.optional(),
        }),
      },
      handler: (req) => hv.book(req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/assign',
      permission: 'lab:homevisit:assign',
      audit: 'UPDATE',
      summary: 'Assign or reassign a visit to a phlebotomist',
      schema: { params: id, body: z.object({ version, userId: objectId }) },
      handler: (req) => hv.assign(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/start',
      permission: 'lab:homevisit:update',
      audit: 'UPDATE',
      summary: 'On the way to the patient',
      schema: { params: id, body: z.object({ version }) },
      handler: (req) => hv.start(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/collect',
      permission: ['lab:homevisit:update', 'lab:sample:collect'],
      audit: 'CREATE',
      summary: 'Collect at home after the UHID card scan; returns the barcode labels',
      schema: { params: id, body: z.object({ version, scan: z.string().trim().min(3).max(40) }) },
      handler: (req) => hv.collectAtHome(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/handover',
      permission: 'lab:homevisit:update',
      audit: 'UPDATE',
      summary: 'Samples handed to the lab reception',
      schema: { params: id, body: z.object({ version }) },
      handler: (req) => hv.handOver(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/cancel',
      permission: ['lab:homevisit:assign', 'lab:homevisit:create'],
      audit: 'UPDATE',
      summary: 'Cancel an open visit (its uncollected tests are cancelled)',
      schema: {
        params: id,
        body: z.object({ version, reason: z.string().trim().min(5).max(200) }),
      },
      handler: (req) => hv.cancel(req.valid.params.id, req.valid.body),
    },
  ],
});
