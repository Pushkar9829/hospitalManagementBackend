import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { hasPermission } from '@hms/shared';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import { current } from '../../core/tenancy/context.js';
import * as fac from './services/facility.service.js';

const id = z.object({ id: objectId });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const can = (key) => hasPermission([...current().permissions], key);
/** Ward staff request porters and enter waste; the facility team runs everything. */
const WARD_PORTER = ['facility:porter:create', 'nursing:porter:create'];
const WARD_WASTE = ['facility:waste:create', 'nursing:waste:create'];

/** Facility (board Facility): housekeeping, linen, porters, equipment, tickets, waste. */
export const facilityRoutes = defineRoutes({
  module: 'FAC',
  basePath: '/facility',
  routes: withLiveUpdates(
    [
      {
        method: 'get',
        path: '/settings',
        permission: 'authenticated',
        audit: null,
        summary: 'Linen types and par levels, ticket targets, waste facility',
        handler: () => fac.getSettings(),
      },
      {
        method: 'put',
        path: '/settings',
        permission: 'facility:settings:update',
        audit: 'UPDATE',
        summary: 'Edit facility settings',
        schema: { body: fac.settingsInput },
        handler: (req) => fac.saveSettings(req.valid.body),
      },
      // housekeeping
      {
        method: 'get',
        path: '/hk-schedules',
        permission: 'facility:housekeeping:read',
        audit: null,
        summary: 'Area cleaning schedules',
        handler: () => fac.listSchedules(),
      },
      {
        method: 'post',
        path: '/hk-schedules',
        permission: 'facility:housekeeping:update',
        audit: 'CREATE',
        status: 201,
        summary: 'Add an area cleaning schedule with its checklist',
        schema: { body: fac.scheduleInput },
        handler: (req) => fac.createSchedule(req.valid.body),
      },
      {
        method: 'get',
        path: '/hk-tasks',
        permission: 'facility:housekeeping:read',
        audit: null,
        summary: 'The day’s cleaning rounds',
        schema: { query: z.object({ date: ymd.optional() }) },
        handler: (req) => fac.rounds(req.valid.query),
      },
      {
        method: 'post',
        path: '/hk-tasks/:id/done',
        permission: 'facility:housekeeping:update',
        audit: 'UPDATE',
        summary: 'Round done with the checklist',
        schema: { params: id, body: fac.roundInput },
        handler: (req) => fac.completeRound(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/hk-tasks/:id/verify',
        permission: 'facility:housekeeping:verify',
        audit: 'APPROVE',
        summary: 'Supervisor sign-off (not by the person who cleaned)',
        schema: { params: id },
        noBody: true,
        handler: (req) => fac.verifyRound(req.valid.params.id),
      },
      // linen
      {
        method: 'get',
        path: '/linen',
        permission: 'facility:linen:read',
        audit: null,
        summary: 'Linen per ward against par levels',
        handler: () => fac.linenBoard(),
      },
      {
        method: 'post',
        path: '/linen/issue',
        permission: 'facility:linen:update',
        audit: 'CREATE',
        summary: 'Issue new or replacement linen to a ward',
        schema: { body: fac.issueInput },
        handler: (req) => fac.issueLinen(req.valid.body),
      },
      {
        method: 'get',
        path: '/laundry',
        permission: 'facility:linen:read',
        audit: null,
        summary: 'Laundry batches',
        schema: { query: z.object({ status: z.enum(['SENT', 'RECEIVED']).optional() }) },
        handler: (req) => fac.listLaundry(req.valid.query),
      },
      {
        method: 'post',
        path: '/laundry',
        permission: 'facility:linen:update',
        audit: 'CREATE',
        status: 201,
        summary: 'Soiled linen counted out of a ward to the laundry',
        schema: { body: fac.laundryInput },
        handler: (req) => fac.sendLaundry(req.valid.body),
      },
      {
        method: 'post',
        path: '/laundry/:id/receive',
        permission: 'facility:linen:update',
        audit: 'UPDATE',
        summary: 'Clean linen counted back (shortage recorded)',
        schema: { params: id, body: fac.receiveInput },
        handler: (req) => fac.receiveLaundry(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/linen/condemn',
        permission: 'facility:linen:update',
        audit: 'CREATE',
        status: 201,
        summary: 'Write off damaged linen (Hospital Admin approves)',
        schema: { body: fac.condemnInput },
        handler: (req, res) => fac.condemn(req.valid.body, res),
      },
      // porters
      {
        method: 'get',
        path: '/porters',
        permission: ['facility:porter:read', 'nursing:porter:create'],
        audit: null,
        summary: 'Patient transport requests',
        schema: { query: z.object({ status: z.string().max(80).optional() }) },
        handler: (req) => fac.porters(req.valid.query),
      },
      {
        method: 'post',
        path: '/porters',
        permission: WARD_PORTER,
        audit: 'CREATE',
        status: 201,
        summary: 'Request a porter (wheelchair, stretcher, bed)',
        schema: { body: fac.porterInput },
        handler: (req) => fac.requestPorter(req.valid.body),
      },
      {
        method: 'post',
        path: '/porters/:id/:action',
        permission: ['facility:porter:update', 'nursing:porter:create'],
        audit: 'UPDATE',
        summary: 'Assign, picked up, dropped or cancel',
        schema: {
          params: z.object({
            id: objectId,
            action: z.enum(['assign', 'pick', 'done', 'cancel']),
          }),
          body: z.object({ porter: z.string().trim().max(60).optional() }),
        },
        handler: (req) =>
          fac.movePorter(req.valid.params.id, {
            action: req.valid.params.action.toUpperCase(),
            porter: req.valid.body.porter,
          }),
      },
      // equipment
      {
        method: 'get',
        path: '/assets',
        permission: ['facility:asset:read', 'facility:ticket:read'],
        audit: null,
        summary: 'Equipment register',
        schema: {
          query: z.object({
            q: z.string().trim().max(60).optional(),
            status: z.string().max(60).optional(),
            category: z.string().max(20).optional(),
          }),
        },
        handler: (req) => fac.listAssets(req.valid.query),
      },
      {
        method: 'post',
        path: '/assets',
        permission: 'facility:asset:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Add equipment with PM, calibration and AMC',
        schema: { body: fac.assetInput },
        handler: (req) => fac.createAsset(req.valid.body),
      },
      {
        method: 'get',
        path: '/assets/due',
        permission: 'facility:asset:read',
        audit: null,
        summary: 'PM and calibration due, AMC/CMC ending soon',
        schema: { query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) },
        handler: (req) => fac.dueList(req.valid.query),
      },
      {
        method: 'get',
        path: '/assets/:id',
        permission: 'facility:asset:read',
        audit: null,
        summary: 'Equipment with PM records and tickets',
        schema: { params: id },
        handler: (req) => fac.getAsset(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/assets/:id/pm',
        permission: 'facility:asset:update',
        audit: 'UPDATE',
        summary: 'Record PM or calibration (certificate optional)',
        schema: { params: id, body: fac.pmInput },
        handler: (req) => fac.recordPm(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/assets/:id/status',
        permission: 'facility:asset:update',
        audit: 'UPDATE',
        summary: 'Take out of or return to service',
        schema: {
          params: id,
          body: z.object({
            status: z.enum(['IN_SERVICE', 'OUT_OF_SERVICE']),
            reason: z.string().trim().min(3).max(200),
          }),
        },
        handler: (req) => fac.changeAssetStatus(req.valid.params.id, req.valid.body),
      },
      // tickets
      {
        method: 'get',
        path: '/tickets',
        permission: 'authenticated',
        audit: null,
        summary: 'Maintenance tickets (others see the ones they raised)',
        schema: {
          query: z.object({
            status: z.string().max(80).optional(),
            category: z.string().max(20).optional(),
          }),
        },
        handler: (req) =>
          fac.listTickets({ ...req.valid.query, mine: !can('facility:ticket:read') }),
      },
      {
        method: 'post',
        path: '/tickets',
        permission: 'authenticated',
        audit: 'CREATE',
        status: 201,
        summary: 'Raise a maintenance ticket (any user)',
        schema: { body: fac.ticketInput },
        handler: (req) => fac.raiseTicket(req.valid.body),
      },
      {
        method: 'post',
        path: '/tickets/:id/action',
        permission: 'authenticated',
        audit: 'UPDATE',
        summary: 'Assign, start, resolve; the requester confirms or reopens',
        schema: { params: id, body: fac.ticketActionInput },
        handler: (req) =>
          fac.ticketAction(req.valid.params.id, req.valid.body, {
            canManage: can('facility:ticket:update'),
          }),
      },
      // biomedical waste
      {
        method: 'get',
        path: '/waste',
        permission: ['facility:waste:read', 'nursing:waste:create'],
        audit: null,
        summary: 'Waste by ward for a day, with handovers',
        schema: { query: z.object({ date: ymd.optional() }) },
        handler: (req) => fac.wasteDay(req.valid.query),
      },
      {
        method: 'post',
        path: '/waste',
        permission: WARD_WASTE,
        audit: 'CREATE',
        summary: 'Enter a ward’s waste by colour (kg)',
        schema: { body: fac.wasteInput },
        handler: (req) => fac.recordWaste(req.valid.body),
      },
      {
        method: 'post',
        path: '/waste/handover',
        permission: 'facility:waste:create',
        audit: 'CREATE',
        summary: 'Handover to the treatment facility with the manifest',
        schema: { body: fac.handoverInput },
        handler: (req) => fac.handoverWaste(req.valid.body),
      },
      {
        method: 'get',
        path: '/waste/report',
        permission: 'facility:waste:read',
        audit: null,
        summary: 'Monthly biomedical waste report',
        schema: { query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }) },
        handler: (req) => fac.wasteMonth(req.valid.query),
      },
    ],
    'facility:update',
  ),
});
