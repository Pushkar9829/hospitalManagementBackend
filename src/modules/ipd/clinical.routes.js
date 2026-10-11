import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import * as clinical from './services/clinical.service.js';

const id = z.object({ id: objectId });
const text = (max = 300) => z.string().trim().max(max);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm');
const STAY_READ = ['ipd:admission:read', 'ipd:bed:read', 'nursing:census:read'];

const medOrder = z.object({
  drug: z.object({
    drugId: text(40).optional(),
    brand: text(120).min(2),
    generic: text(120).optional(),
  }),
  dose: text(60).min(1),
  route: text(30).min(2),
  frequency: z.enum(['OD', 'BD', 'TDS', 'QID', 'Q6H', 'Q8H', 'HS', 'SOS', 'STAT']),
  times: z.array(hhmm).max(8).optional(),
  days: z.number().int().min(1).max(90).optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  highAlert: z.boolean().optional(),
  instructions: text(300).optional(),
});

/** Doctor's side of the stay: rounds notes and medicine orders; the pharmacist verifies. */
export const roundsRoutes = defineRoutes({
  module: 'IPD',
  basePath: '/ipd',
  routes: withLiveUpdates(
    [
      {
        method: 'get',
        path: '/admissions/:id/notes',
        permission: [...STAY_READ, 'ipd:note:read'],
        audit: 'VIEW',
        summary: 'Clinical notes on the stay (assessments, progress, nursing, handovers)',
        schema: { params: id, query: z.object({ kind: text(120).optional() }) },
        handler: (req) => clinical.listNotes(req.valid.params.id, req.valid.query),
      },
      {
        method: 'post',
        path: '/admissions/:id/notes',
        permission: 'ipd:note:write',
        audit: 'CREATE',
        status: 201,
        summary: 'Doctor’s initial assessment or progress note (signed on save; rule R13)',
        schema: {
          params: id,
          body: z.object({
            kind: z.enum(['DOCTOR_INITIAL', 'PROGRESS']),
            text: text(8000).min(3),
            data: z.record(z.string(), z.any()).optional(),
          }),
        },
        handler: (req) => clinical.addNote(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/notes/:id/addenda',
        permission: ['ipd:note:write', 'nursing:note:create'],
        audit: 'UPDATE',
        summary: 'Addendum to a signed note',
        schema: { params: id, body: z.object({ text: text(2000).min(2) }) },
        handler: (req) => clinical.addNoteAddendum(req.valid.params.id, req.valid.body),
      },
      {
        method: 'get',
        path: '/admissions/:id/med-orders',
        permission: [...STAY_READ, 'pharmacy:order:verify'],
        audit: null,
        summary: 'Medicine orders on the stay',
        schema: { params: id, query: z.object({ status: text(80).optional() }) },
        handler: (req) => clinical.listOrders(req.valid.params.id, req.valid.query),
      },
      {
        method: 'post',
        path: '/admissions/:id/med-orders',
        permission: ['orders:create', 'ipd:note:write'],
        audit: 'CREATE',
        status: 201,
        summary: 'Order a medicine (high-alert detected; STAT can be given before verification)',
        schema: { params: id, body: medOrder },
        handler: (req) => clinical.orderMedicine(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/med-orders/:id/verify',
        permission: 'pharmacy:order:verify',
        audit: 'APPROVE',
        summary: 'Pharmacist verifies or rejects an order (rule R11)',
        schema: {
          params: id,
          body: z.object({
            decision: z.enum(['VERIFY', 'REJECT']).default('VERIFY'),
            reason: text(300).optional(),
          }),
        },
        handler: (req) => clinical.verifyOrder(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/med-orders/:id/stop',
        permission: ['orders:create', 'ipd:note:write'],
        audit: 'UPDATE',
        summary: 'Stop a medicine (future doses come off the MAR)',
        schema: { params: id, body: z.object({ reason: text(300).min(2) }) },
        handler: (req) => clinical.stopOrder(req.valid.params.id, req.valid.body),
      },
    ],
    'ward:update',
  ),
});

/** Nursing station (module NUR): census, MAR, vitals with NEWS2, intake-output, notes. */
export const nursingRoutes = defineRoutes({
  module: 'NUR',
  basePath: '/nursing',
  routes: withLiveUpdates(
    [
      {
        method: 'get',
        path: '/wards',
        permission: ['nursing:census:read', 'ipd:bed:read'],
        audit: null,
        summary: 'Wards with patients and beds',
        handler: () => clinical.wards(),
      },
      {
        method: 'get',
        path: '/wards/:id/census',
        permission: ['nursing:census:read'],
        audit: null,
        summary: 'Ward census: NEWS2, doses due and late, fluid balance, overdue assessments',
        schema: { params: id },
        handler: (req) => clinical.census(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/admissions/:id/mar',
        permission: ['nursing:mar:read', 'ipd:note:write'],
        audit: 'VIEW',
        summary: 'Medicine administration record for a day',
        schema: { params: id, query: z.object({ date: ymd.optional() }) },
        handler: (req) => clinical.mar(req.valid.params.id, req.valid.query),
      },
      {
        method: 'post',
        path: '/mar/:id/administer',
        permission: 'nursing:mar:administer',
        audit: 'UPDATE',
        summary:
          'Give, hold or record a refused dose (wristband scan; second nurse for high-alert)',
        schema: {
          params: id,
          body: z.object({
            status: z.enum(['GIVEN', 'HELD', 'REFUSED']).default('GIVEN'),
            wristband: text(40).optional(),
            drugScan: text(60).optional(),
            witness: text(120).optional(),
            reason: text(300).optional(),
          }),
        },
        handler: (req) => clinical.administer(req.valid.params.id, req.valid.body),
      },
      {
        method: 'get',
        path: '/admissions/:id/vitals',
        permission: ['nursing:vitals:read', 'ipd:note:write', 'ipd:note:read'],
        audit: null,
        summary: 'Observation chart with NEWS2',
        schema: { params: id },
        handler: (req) => clinical.listVitals(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/admissions/:id/vitals',
        permission: 'nursing:vitals:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Record observations; NEWS2 is scored and a medium or high score alerts the RMO',
        schema: {
          params: id,
          body: z.object({
            rr: z.number().int().min(0).max(80).optional(),
            spo2: z.number().int().min(50).max(100).optional(),
            onOxygen: z.boolean().optional(),
            tempC: z.number().min(30).max(45).optional(),
            sbp: z.number().int().min(40).max(300).optional(),
            dbp: z.number().int().min(20).max(200).optional(),
            hr: z.number().int().min(20).max(250).optional(),
            consciousness: z.enum(['A', 'C', 'V', 'P', 'U']).default('A'),
            painScore: z.number().int().min(0).max(10).optional(),
            sugar: z.number().min(20).max(800).optional(),
            at: z.string().datetime({ offset: true }).optional(),
          }),
        },
        handler: (req) => clinical.recordVitals(req.valid.params.id, req.valid.body),
      },
      {
        method: 'get',
        path: '/admissions/:id/io',
        permission: ['nursing:io:read', 'ipd:note:write', 'ipd:note:read'],
        audit: null,
        summary: 'Intake, output and balance for a day',
        schema: { params: id, query: z.object({ date: ymd.optional() }) },
        handler: (req) => clinical.ioToday(req.valid.params.id, req.valid.query),
      },
      {
        method: 'post',
        path: '/admissions/:id/io',
        permission: 'nursing:io:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Record intake or output',
        schema: {
          params: id,
          body: z.object({
            kind: z.enum(['INTAKE', 'OUTPUT']),
            route: z.enum(['ORAL', 'IV', 'RT', 'URINE', 'DRAIN', 'VOMIT', 'STOOL', 'OTHER']),
            ml: z.number().int().min(0).max(10000),
            note: text(200).optional(),
            at: z.string().datetime({ offset: true }).optional(),
          }),
        },
        handler: (req) => clinical.recordIo(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/admissions/:id/notes',
        permission: 'nursing:note:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Nursing admission assessment (due in 2 h), nursing note or SBAR handover',
        schema: {
          params: id,
          body: z.object({
            kind: z.enum(['NURSING_ADMISSION', 'NURSING', 'HANDOVER']),
            text: text(8000).optional(),
            data: z.record(z.string(), z.any()).optional(),
          }),
        },
        handler: (req) => clinical.addNote(req.valid.params.id, req.valid.body),
      },
    ],
    'ward:update',
  ),
});
