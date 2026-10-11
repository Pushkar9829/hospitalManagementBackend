import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as portal from './services/portal.service.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * Patient portal API. Mounted before staff sign-in: every route after the code check reads the
 * signed-in mobile from the portal cookie and only shows patients registered on that number.
 */
export const portalRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/portal',
  routes: [
    {
      method: 'post',
      path: '/auth/otp',
      permission: 'public',
      audit: null,
      summary: 'Send a sign-in code to a registered patient mobile',
      schema: { body: z.object({ mobile: portal.mobileSchema }) },
      handler: (req) => portal.requestOtp(req.valid.body),
    },
    {
      method: 'post',
      path: '/auth/verify',
      permission: 'public',
      audit: 'LOGIN',
      summary: 'Check the code and open a portal session',
      schema: {
        body: z.object({ mobile: portal.mobileSchema, code: z.string().regex(/^\d{6}$/) }),
      },
      handler: (req, res) => portal.verifyOtp(req.valid.body, res),
    },
    {
      method: 'post',
      path: '/auth/logout',
      permission: 'public',
      audit: null,
      summary: 'End the portal session',
      noBody: true,
      handler: (_req, res) => portal.logout(res),
    },
    {
      method: 'get',
      path: '/me',
      permission: 'public',
      audit: null,
      summary: 'Family on this mobile, next appointment, dues, new reports, current stay',
      handler: (req) => portal.me(portal.portalMobile(req)),
    },
    {
      method: 'get',
      path: '/patients/:id/reports',
      permission: 'public',
      audit: 'VIEW',
      summary: 'Released lab and imaging reports of a family member',
      schema: { params: z.object({ id: objectId }) },
      handler: (req) => portal.reports(portal.portalMobile(req), req.valid.params.id),
    },
    {
      method: 'get',
      path: '/bills',
      permission: 'public',
      audit: null,
      summary: 'Bills due and paid, receipts and deposits of the family',
      handler: (req) => portal.bills(portal.portalMobile(req)),
    },
    {
      method: 'get',
      path: '/stay',
      permission: 'public',
      audit: null,
      summary: 'The current stay: bed, consultant, running bill, discharge steps',
      handler: (req) => portal.stay(portal.portalMobile(req)),
    },
    {
      method: 'get',
      path: '/departments',
      permission: 'public',
      audit: null,
      summary: 'Departments with doctors',
      handler: (req) => {
        portal.portalMobile(req);
        return portal.departments();
      },
    },
    {
      method: 'get',
      path: '/slots',
      permission: 'public',
      audit: null,
      summary: 'Free slots by doctor for a date',
      schema: {
        query: z.object({ date: ymd.optional(), department: z.string().trim().max(60).optional() }),
      },
      handler: (req) => {
        portal.portalMobile(req);
        return portal.freeSlots(req.valid.query);
      },
    },
    {
      method: 'get',
      path: '/appointments',
      permission: 'public',
      audit: null,
      summary: 'Upcoming appointments of the family',
      handler: (req) => portal.appointments(portal.portalMobile(req)),
    },
    {
      method: 'post',
      path: '/appointments',
      permission: 'public',
      audit: 'CREATE',
      status: 201,
      summary: 'Book a visit for a family member (pay at the hospital)',
      schema: { body: portal.bookingInput },
      handler: (req) => portal.bookVisit(portal.portalMobile(req), req.valid.body),
    },
    {
      method: 'post',
      path: '/appointments/:id/cancel',
      permission: 'public',
      audit: 'UPDATE',
      summary: 'Cancel a booking',
      schema: { params: z.object({ id: objectId }) },
      noBody: true,
      handler: (req) => portal.cancelVisit(portal.portalMobile(req), req.valid.params.id),
    },
  ],
});
