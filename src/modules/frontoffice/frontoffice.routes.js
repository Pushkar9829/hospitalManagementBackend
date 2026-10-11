import { z } from 'zod';
import { mobile, objectId, pageQuery } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import * as fo from './services/frontoffice.service.js';

const id = z.object({ id: objectId });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max = 120) => z.string().trim().max(max);
const READ = ['frontoffice:counter:read', 'frontoffice:*:read'];

export const frontOfficeRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/front-office',
  routes: withLiveUpdates(
    [
      {
        method: 'get',
        path: '/counters',
        permission: READ,
        audit: null,
        summary: 'Counters with the token now serving and how many wait',
        handler: () => fo.counters(),
      },
      {
        method: 'post',
        path: '/tokens',
        permission: 'frontoffice:token:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Issue a counter token',
        schema: {
          body: z.object({
            counterId: objectId,
            name: text().optional(),
            mobile: mobile.optional(),
          }),
        },
        handler: (req) => fo.issueToken(req.valid.body),
      },
      {
        method: 'post',
        path: '/counters/:id/call-next',
        permission: 'frontoffice:token:call',
        audit: 'UPDATE',
        summary: 'Finish the current token and call the next (409 QUEUE_EMPTY)',
        schema: { params: id },
        noBody: true,
        handler: (req) => fo.callNext(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/enquiries',
        permission: ['frontoffice:enquiry:read', 'frontoffice:*:read'],
        audit: null,
        summary: 'Enquiries for a day',
        schema: { query: pageQuery.extend({ date: ymd.optional(), q: text(60).optional() }) },
        handler: (req) => fo.listEnquiries(req.valid.query),
      },
      {
        method: 'post',
        path: '/enquiries',
        permission: 'frontoffice:enquiry:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Log an enquiry (a lead goes to CRM)',
        schema: {
          body: z.object({
            caller: text().optional(),
            mobile: mobile.optional(),
            topic: text(200).min(3, 'Write what they asked about'),
            category: z
              .enum(['DOCTOR', 'PACKAGE', 'TARIFF', 'BED', 'VISITING', 'OTHER'])
              .default('OTHER'),
            channel: z.enum(['PHONE', 'WALK_IN', 'WHATSAPP', 'EMAIL']),
            outcome: z.enum(['ANSWERED', 'BOOKED', 'LEAD', 'FOLLOW_UP']),
            notes: text(300).optional(),
          }),
        },
        handler: (req) => fo.logEnquiry(req.valid.body),
      },
      {
        method: 'get',
        path: '/enquiries/summary',
        permission: ['frontoffice:enquiry:read', 'frontoffice:*:read'],
        audit: null,
        summary: 'Enquiries per day with bookings, leads and the top topic',
        schema: { query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }) },
        handler: (req) => fo.enquirySummary(req.valid.query),
      },
      {
        method: 'get',
        path: '/passes',
        permission: ['frontoffice:pass:read', 'frontoffice:*:read'],
        audit: null,
        summary: 'Visitor and attendant passes',
        schema: {
          query: pageQuery.extend({
            status: z.enum(['INSIDE', 'OUT', 'REVOKED', 'ALL']).default('INSIDE'),
          }),
        },
        handler: (req) => fo.listPasses(req.valid.query),
      },
      {
        method: 'post',
        path: '/passes',
        permission: 'frontoffice:pass:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Issue an attendant or visitor pass with a QR code (409 ATTENDANT_LIMIT)',
        schema: {
          body: z.object({
            patientId: objectId,
            bed: text(30).optional(),
            type: z.enum(['ATTENDANT', 'VISITOR']),
            visitor: z.object({
              name: text().min(2, 'Write the visitor’s name'),
              relation: text(40).optional(),
              mobile: mobile.optional(),
            }),
          }),
        },
        handler: (req) => fo.issuePass(req.valid.body),
      },
      {
        method: 'post',
        path: '/passes/:id/out',
        permission: 'frontoffice:pass:create',
        audit: 'UPDATE',
        summary: 'Mark a visitor out',
        schema: { params: id },
        noBody: true,
        handler: (req) => fo.markOut(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/visitor-log',
        permission: ['frontoffice:pass:read', 'frontoffice:*:read'],
        audit: null,
        summary: 'Who came in and out on a day',
        schema: { query: pageQuery.extend({ date: ymd.optional() }) },
        handler: (req) => fo.visitorLog(req.valid.query),
      },
      {
        method: 'get',
        path: '/locator',
        permission: ['frontoffice:locator:read', 'frontoffice:*:read'],
        audit: 'VIEW',
        summary: 'Where a patient is now (no clinical details; VIP and MLC hidden)',
        schema: { query: z.object({ q: text(60).optional() }) },
        handler: (req) => fo.locate(req.valid.query),
      },
    ],
    'frontoffice:update',
  ),
});
