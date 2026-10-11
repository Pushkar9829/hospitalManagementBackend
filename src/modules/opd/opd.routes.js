import { z } from 'zod';
import { objectId, pageQuery } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import * as appts from './services/appointment.service.js';
import * as consult from './services/consult.service.js';
import * as displays from './services/display.service.js';
import * as extras from './services/extras.service.js';
import * as reports from './services/reports.service.js';
import * as schedules from './services/schedule.service.js';
import * as settings from './services/settings.service.js';
import * as visits from './services/visit.service.js';

const id = z.object({ id: objectId });
const doctorParam = z.object({ doctorId: objectId });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm');
const text = (max = 300) => z.string().trim().max(max);
const reason = z.object({ reason: text(300).min(2, 'Give a reason') });
const reasonOptional = z.object({ reason: text(300).optional() });
const VISIT_TYPES = ['NEW', 'FOLLOW_UP', 'TELE', 'VACCINATION', 'PROCEDURE', 'HEALTH_CHECK'];
const CHANNELS = ['DESK', 'PHONE', 'PORTAL', 'WHATSAPP', 'WALK_IN'];

/** Who may read the day's OPD (desk, nurse, doctor, schedulers, cashier). */
const READ = [
  'opd:appointment:read',
  'opd:vitals:create',
  'opd:consultation:read',
  'opd:schedule:read',
];
const CONSULT_READ = ['opd:consultation:read', 'opd:consultation:write'];
const CONSULT_WRITE = 'opd:consultation:write';

const bookInput = z.object({
  patientId: objectId,
  doctorId: objectId,
  date: ymd.optional(),
  time: hhmm.optional(),
  visitType: z.enum(VISIT_TYPES).default('NEW'),
  channel: z.enum(CHANNELS).default('DESK'),
  notes: text().optional(),
});

const vitalsInput = z.object({
  bp: z
    .string()
    .regex(/^\d{2,3}\/\d{2,3}$/, 'Write BP as 120/80.')
    .nullish(),
  pulse: z.number().int().min(30).max(220).nullish(),
  tempF: z.number().min(90).max(110).nullish(),
  spo2: z.number().int().min(50).max(100).nullish(),
  weightKg: z.number().min(0.5).max(300).nullish(),
  heightCm: z.number().min(30).max(250).nullish(),
  sugar: z.number().min(20).max(600).nullish(),
  painScore: z.number().int().min(0).max(10).nullish(),
  complaint: text(300).optional(),
  priority: z.enum(['GREEN', 'AMBER', 'RED']).default('GREEN'),
  priorityReason: text(300).optional(),
  allergiesConfirmed: z.boolean().optional(),
});

const rxLine = z.object({
  drugId: z.string().max(40),
  brand: text(120),
  generic: text(120).optional(),
  dose: text(60).optional(),
  frequency: text(20).optional(),
  days: z.number().int().min(1).max(365).nullish(),
  route: text(30).optional(),
  instructions: text(200).optional(),
});
const orderLine = z.object({
  code: text(20),
  serviceId: objectId.optional(),
  name: text(120),
  type: text(10).optional(),
  priority: z.enum(['ROUTINE', 'TODAY', 'STAT', 'SCHEDULE']).default('ROUTINE'),
  price: z.number().int().min(0).optional(),
  status: text(20).optional(),
});
const consultationInput = z.object({
  complaints: text(2000).optional(),
  history: text(4000).optional(),
  examination: text(4000).optional(),
  diagnoses: z
    .array(z.object({ code: text(10), name: text(200), provisional: z.boolean().optional() }))
    .max(20)
    .optional(),
  noDiagnosisReason: text(300).optional(),
  rx: z.array(rxLine).max(30).optional(),
  orders: z.array(orderLine).max(40).optional(),
  advice: text(2000).optional(),
  followUp: z
    .object({ date: z.union([ymd, z.literal('')]).optional(), note: text(200).optional() })
    .optional(),
  printLanguage: z.enum(['en', 'hi', 'mr']).optional(),
  specialty: z.string().max(30).nullish(),
});

const session = z.object({
  start: hhmm,
  end: hhmm,
  room: text(20).optional(),
  slotNew: z.number().int().min(5).max(120),
  slotFollowUp: z.number().int().min(5).max(120),
  max: z.number().int().min(1).max(200),
  overbook: z.number().int().min(0).max(5),
  online: z.boolean(),
  tele: z.boolean(),
});
const scheduleInput = z.object({
  week: z
    .array(
      z.object({
        day: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
        sessions: z.array(session).max(4),
      }),
    )
    .length(7)
    .optional(),
  fees: z
    .object({
      NEW: z.number().int().min(0),
      FOLLOW_UP: z.number().int().min(0),
      TELE: z.number().int().min(0),
    })
    .partial()
    .optional(),
  followUp: z
    .object({ days: z.number().int().min(0).max(60), visits: z.number().int().min(0).max(3) })
    .optional(),
});

const int = (min, max) => z.number().int().min(min).max(max);
const settingsInput = z.object({
  booking: z
    .object({
      bookAheadDays: int(1, 180),
      latestBeforeMin: int(0, 1440),
      holdMin: int(1, 30),
      maxFuturePerDoctor: int(1, 10),
      walkInEvery: int(1, 10),
      lateGraceMin: int(0, 60),
      prepayOnline: z.enum(['OPTIONAL', 'REQUIRED', 'OFF']),
      triageRequired: z.array(text(60)).max(50),
    })
    .optional(),
  cancellation: z
    .object({
      freeUntilHours: int(0, 72),
      keepPercent: int(0, 100),
      noShowAfterMin: int(5, 240),
      noShowRefund: z.enum(['CREDIT', 'REFUND', 'NONE']),
      prepayAfterNoShows: int(1, 10),
      prepayWindowDays: int(7, 365),
      hospitalChange: z.enum(['FULL_REFUND_OR_FREE_RESCHEDULE', 'FREE_RESCHEDULE']),
    })
    .optional(),
});

const period = z.object({
  period: z.enum(['today', 'week', 'month']).default('today'),
  department: text(60).optional(),
});

export const opdRoutes = defineRoutes({
  module: 'OPD',
  basePath: '/opd',
  routes: withLiveUpdates(
    [
      // ---------------------------------------------------------------- masters and slots
      {
        method: 'get',
        path: '/doctors',
        permission: READ,
        audit: null,
        summary: 'OPD doctors with fees and follow-up rule',
        schema: { query: z.object({ department: text(60).optional(), q: text(60).optional() }) },
        handler: (req) => schedules.listDoctors(req.valid.query),
      },
      {
        method: 'get',
        path: '/departments',
        permission: READ,
        audit: null,
        summary: 'Departments that have OPD doctors',
        handler: () => schedules.listDepartments(),
      },
      {
        method: 'get',
        path: '/slots',
        permission: READ,
        audit: null,
        summary: 'Slot grid for a day: doctors x times with booking state',
        schema: { query: z.object({ date: ymd.optional(), department: text(60).optional() }) },
        handler: (req) => schedules.slots(req.valid.query),
      },

      // ---------------------------------------------------------------- appointments
      {
        method: 'get',
        path: '/appointments',
        permission: READ,
        audit: null,
        summary: 'Bookings for a day (filter by doctor, status, search)',
        schema: {
          query: pageQuery.extend({
            date: ymd.optional(),
            doctorId: objectId.optional(),
            status: text(120).optional(),
            q: text(60).optional(),
            from: hhmm.optional(),
            limit: z.coerce.number().int().min(1).max(200).default(100),
          }),
        },
        handler: (req) => appts.listAppointments(req.valid.query),
      },
      {
        method: 'get',
        path: '/appointments/:id',
        permission: READ,
        audit: null,
        summary: 'One booking',
        schema: { params: id },
        handler: (req) => appts.getAppointment(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/appointments',
        permission: 'opd:appointment:create',
        audit: 'CREATE',
        status: 201,
        idempotent: 'optional',
        summary:
          'Book a slot (409 SLOT_TAKEN with the next free time); a walk-in is checked in at once',
        schema: { body: bookInput },
        handler: (req) => appts.book(req.valid.body),
      },
      {
        method: 'post',
        path: '/appointments/bulk-move',
        permission: ['opd:appointment:update', 'opd:schedule:update'],
        audit: 'UPDATE',
        summary: 'Move bookings to another doctor or date (doctor leave)',
        schema: {
          body: z.object({
            appointmentIds: z.array(objectId).min(1).max(200),
            doctorId: objectId.optional(),
            date: ymd.optional(),
          }),
        },
        handler: (req) => appts.bulkMove(req.valid.body),
      },
      {
        method: 'post',
        path: '/appointments/:id/check-in',
        permission: 'opd:visit:create',
        audit: 'CREATE',
        idempotent: 'optional',
        summary: 'Check in: issue the token and open the visit',
        schema: {
          params: id,
          body: z.object({
            detailsConfirmed: z.boolean().optional(),
            whatsappConsent: z.boolean().optional(),
            complaint: text().optional(),
          }),
        },
        handler: (req) => appts.checkIn(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/appointments/:id/reschedule',
        permission: 'opd:appointment:update',
        audit: 'UPDATE',
        summary: 'Move a booking that has not arrived',
        schema: {
          params: id,
          body: z.object({
            doctorId: objectId.optional(),
            date: ymd.optional(),
            time: hhmm,
            reason: text().optional(),
          }),
        },
        handler: (req) => appts.reschedule(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/appointments/:id/cancel',
        permission: ['opd:appointment:cancel', 'opd:appointment:update'],
        audit: 'UPDATE',
        summary: 'Cancel a booking (rule R9 refund or credit)',
        schema: { params: id, body: reasonOptional },
        handler: (req) => appts.cancel(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/appointments/:id/no-show',
        permission: 'opd:appointment:update',
        audit: 'UPDATE',
        summary: 'Mark a booking as no-show',
        schema: { params: id },
        noBody: true,
        handler: (req) => appts.markNoShow(req.valid.params.id),
      },

      // ---------------------------------------------------------------- queue and visits
      {
        method: 'get',
        path: '/queue',
        permission: READ,
        audit: null,
        summary: 'Live queue: stage=triage | doctor | all; doctorId=me for the signed-in doctor',
        schema: {
          query: z.object({
            doctorId: z.string().max(24).optional(),
            stage: z.enum(['triage', 'doctor', 'all']).optional(),
          }),
        },
        handler: (req) => visits.queue(req.valid.query),
      },
      {
        method: 'get',
        path: '/queue/display',
        permission: 'authenticated',
        audit: null,
        summary: 'Queue TV: each room now and next',
        handler: () => visits.display(),
      },
      {
        method: 'get',
        path: '/display-keys',
        permission: ['opd:settings:read', 'opd:settings:update'],
        audit: null,
        summary: 'Queue TVs registered for this branch',
        handler: () => displays.listKeys(),
      },
      {
        method: 'post',
        path: '/display-keys',
        permission: 'opd:settings:update',
        audit: 'CREATE',
        status: 201,
        summary: 'Register a Queue TV: its key is shown once',
        schema: { body: displays.keyInput },
        handler: (req) => displays.createKey(req.valid.body),
      },
      {
        method: 'post',
        path: '/display-keys/:id/revoke',
        permission: 'opd:settings:update',
        audit: 'DELETE',
        summary: 'Switch a Queue TV off (its key stops working at once)',
        schema: { params: id },
        noBody: true,
        handler: (req) => displays.revokeKey(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/visits/:id',
        permission: READ,
        audit: 'VIEW',
        summary: 'A visit with the patient history and vitals trend',
        schema: { params: id },
        handler: (req) => visits.getVisit(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/visits/:id/start-triage',
        permission: 'opd:vitals:create',
        audit: 'UPDATE',
        summary: 'Start triage for a waiting patient',
        schema: { params: id },
        noBody: true,
        handler: (req) => visits.startTriage(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/visits/:id/vitals',
        permission: 'opd:vitals:create',
        audit: 'UPDATE',
        summary: 'Save vitals and priority; sends the patient to the doctor',
        schema: { params: id, body: vitalsInput },
        handler: (req) => visits.saveVitals(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/skip-triage',
        permission: 'opd:vitals:create',
        audit: 'UPDATE',
        summary: 'Send the patient to the doctor without vitals (reason audited)',
        schema: { params: id, body: reason },
        handler: (req) => visits.skipTriage(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/procedures',
        permission: 'opd:vitals:create',
        audit: 'CREATE',
        summary: 'Record an injection, dressing or nebulisation at triage',
        schema: {
          params: id,
          body: z.object({ type: text(30), detail: text(200).min(2), notes: text().optional() }),
        },
        handler: (req) => visits.recordProcedure(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/call',
        permission: [CONSULT_WRITE, 'opd:visit:create'],
        audit: 'UPDATE',
        summary: 'Call the patient in (TV and SMS)',
        schema: { params: id },
        noBody: true,
        handler: (req) => visits.call(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/visits/:id/skip',
        permission: [CONSULT_WRITE, 'opd:visit:create'],
        audit: 'UPDATE',
        summary: 'Patient not answering: back after the next on-time patient',
        schema: { params: id, body: reasonOptional },
        handler: (req) => visits.skip(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/move',
        permission: [CONSULT_WRITE, 'opd:visit:create'],
        audit: 'UPDATE',
        summary: 'Move a patient to the top (reason required, rule R11)',
        schema: { params: id, body: reason },
        handler: (req) => visits.move(req.valid.params.id, req.valid.body),
      },

      // ---------------------------------------------------------------- consultation
      {
        method: 'get',
        path: '/visits/:id/consultation',
        permission: CONSULT_READ,
        audit: 'VIEW',
        summary: 'The consultation with allergy and interaction checks',
        schema: { params: id },
        handler: (req) => consult.getConsultation(req.valid.params.id),
      },
      {
        method: 'put',
        path: '/visits/:id/consultation',
        permission: CONSULT_WRITE,
        audit: 'UPDATE',
        summary: 'Auto-save the draft consultation (409 once signed, rule R14)',
        schema: { params: id, body: consultationInput },
        handler: (req) => consult.saveConsultation(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/complete',
        permission: CONSULT_WRITE,
        audit: 'UPDATE',
        summary: 'Sign and complete the visit (422 NO_DIAGNOSIS, rule R13)',
        schema: { params: id, body: consultationInput },
        handler: (req) => consult.completeVisit(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/addenda',
        permission: CONSULT_WRITE,
        audit: 'UPDATE',
        summary: 'Add an addendum to a signed consultation',
        schema: { params: id, body: z.object({ text: text(2000).min(2, 'Write the addendum.') }) },
        handler: (req) => consult.addAddendum(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/share',
        permission: CONSULT_WRITE,
        audit: 'PRINT',
        summary: 'Send the prescription to the patient (WhatsApp or SMS)',
        schema: {
          params: id,
          body: z.object({ channel: z.enum(['WHATSAPP', 'SMS']).default('WHATSAPP') }),
        },
        handler: (req) => consult.shareVisit(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/admission-request',
        permission: CONSULT_WRITE,
        audit: 'CREATE',
        summary: 'Request admission (to the IPD admission desk)',
        schema: {
          params: id,
          body: z.object({ wardType: text(30), urgency: text(20), reason: text(500).min(3) }),
        },
        handler: (req) => consult.requestAdmission(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/referral',
        permission: CONSULT_WRITE,
        audit: 'CREATE',
        summary: 'Refer to another doctor with a same-day slot',
        schema: {
          params: id,
          body: z.object({
            doctorId: objectId,
            priority: z.enum(['ROUTINE', 'TODAY', 'STAT']),
            note: text(500).min(3),
          }),
        },
        handler: (req) => consult.refer(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/visits/:id/certificates',
        permission: CONSULT_WRITE,
        audit: 'CREATE',
        summary: 'Issue a medical certificate',
        schema: {
          params: id,
          body: z
            .object({
              type: z.enum(['SICK_LEAVE', 'FITNESS', 'MEDICAL']),
              from: ymd,
              to: ymd,
              remarks: text(500).optional(),
            })
            .refine((v) => v.to >= v.from, {
              path: ['to'],
              message: 'The end date is before the start date.',
            }),
        },
        handler: (req) => consult.issueCertificate(req.valid.params.id, req.valid.body),
      },
      {
        method: 'get',
        path: '/visits/:id/charges',
        permission: [CONSULT_WRITE, 'billing:bill:create'],
        audit: null,
        summary: 'What the visit will bill: consultation and orders',
        schema: { params: id },
        handler: (req) => consult.visitCharges(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/visits/:id/close',
        permission: 'billing:bill:create',
        audit: 'UPDATE',
        idempotent: 'optional',
        summary: 'Clinic desk: bill, take payment and close the visit',
        schema: {
          params: id,
          body: z.object({
            mode: text(12).default('CASH'),
            reference: text(60).optional(),
            outputs: z
              .array(z.enum(['PRINT_RX', 'PRINT_RECEIPT', 'WHATSAPP', 'FOLLOW_UP_REMINDER']))
              .max(4)
              .default([]),
          }),
        },
        handler: (req) => consult.closeVisit(req.valid.params.id, req.valid.body),
      },

      // ---------------------------------------------------------------- look-ups and templates
      {
        method: 'get',
        path: '/icd10',
        permission: CONSULT_READ,
        audit: null,
        summary: 'ICD-10 search',
        schema: { query: z.object({ q: text(60).optional() }) },
        handler: (req) => consult.icd10(req.valid.query),
      },
      {
        method: 'get',
        path: '/formulary',
        permission: CONSULT_READ,
        audit: null,
        summary: 'Medicine search',
        schema: { query: z.object({ q: text(60).optional() }) },
        handler: (req) => consult.formulary(req.valid.query),
      },
      {
        method: 'get',
        path: '/orderables',
        permission: CONSULT_READ,
        audit: null,
        summary: 'Lab, radiology and procedure services to order',
        schema: {
          query: z.object({
            q: text(60).optional(),
            type: z.enum(['LAB', 'RAD', 'PROC']).optional(),
          }),
        },
        handler: (req) => consult.orderables(req.valid.query),
      },
      {
        method: 'get',
        path: '/templates',
        permission: [...CONSULT_READ, 'opd:settings:read'],
        audit: null,
        summary: 'Prescription templates, order sets and specialty forms',
        schema: {
          query: z.object({
            kind: z.enum(['RX', 'ORDER_SET', 'SPECIALTY']).optional(),
            q: text(60).optional(),
          }),
        },
        handler: (req) => settings.listTemplates(req.valid.query, consult.ordersFor),
      },
      {
        method: 'post',
        path: '/templates',
        permission: [CONSULT_WRITE, 'opd:settings:update'],
        audit: 'CREATE',
        status: 201,
        summary: 'Save a template or order set',
        schema: {
          body: z.object({
            name: text(80).min(3),
            kind: z.enum(['RX', 'ORDER_SET', 'SPECIALTY']),
            department: text(60).optional(),
            owner: text(60).optional(),
            rx: z.array(rxLine).max(30).optional(),
            orders: z
              .array(z.union([text(20), z.object({ code: text(20) })]))
              .max(40)
              .optional(),
            advice: text(2000).optional(),
            specialty: text(30).optional(),
          }),
        },
        handler: (req) => settings.createTemplate(req.valid.body, consult.ordersFor),
      },

      // ---------------------------------------------------------------- schedules and settings
      {
        method: 'get',
        path: '/schedules',
        permission: ['opd:schedule:read', 'opd:appointment:read'],
        audit: null,
        summary: 'Doctor schedule templates',
        schema: { query: z.object({ q: text(60).optional() }) },
        handler: (req) => schedules.listSchedules(req.valid.query),
      },
      {
        method: 'get',
        path: '/schedules/:doctorId',
        permission: ['opd:schedule:read', 'opd:appointment:read'],
        audit: null,
        summary: 'One doctor’s week and fees',
        schema: { params: doctorParam },
        handler: (req) => schedules.getSchedule(req.valid.params.doctorId),
      },
      {
        method: 'put',
        path: '/schedules/:doctorId',
        permission: 'opd:schedule:update',
        audit: 'UPDATE',
        summary: 'Save a doctor’s week; a fee change waits for approval (202)',
        schema: { params: doctorParam, body: scheduleInput },
        handler: (req, res) =>
          schedules.saveSchedule(req.valid.params.doctorId, req.valid.body, res),
      },
      {
        method: 'post',
        path: '/schedules/:doctorId/blocks',
        permission: ['opd:schedule:update', 'opd:appointment:update'],
        audit: 'CREATE',
        summary: 'Block leave dates and list the affected bookings',
        schema: {
          params: doctorParam,
          body: z.object({ from: ymd, to: ymd.optional(), reason: text(200).min(2) }),
        },
        handler: (req) => schedules.blockDates(req.valid.params.doctorId, req.valid.body),
      },
      {
        method: 'get',
        path: '/settings',
        permission: ['opd:settings:read', 'opd:schedule:read'],
        audit: null,
        summary: 'Booking and cancellation rules',
        handler: () => settings.getSettings(),
      },
      {
        method: 'put',
        path: '/settings',
        permission: 'opd:settings:update',
        audit: 'UPDATE',
        summary: 'Save booking rules; cancellation rules wait for approval (202)',
        schema: { body: settingsInput },
        handler: (req, res) => settings.saveSettings(req.valid.body, res),
      },
      {
        method: 'get',
        path: '/token-series',
        permission: 'opd:settings:read',
        audit: null,
        summary: 'Token series and their displays',
        handler: () => settings.listTokenSeries(),
      },
      {
        method: 'post',
        path: '/token-series',
        permission: 'opd:settings:update',
        audit: 'CREATE',
        status: 201,
        summary: 'Add a token series',
        schema: {
          body: z.object({
            prefix: z.string().regex(/^[A-Z]{1,3}-$/),
            usedFor: text(60).min(2),
            resets: z.enum(['DAILY', 'SESSION', 'NEVER']),
            display: text(60).min(2),
          }),
        },
        handler: (req) => settings.addTokenSeries(req.valid.body),
      },
      {
        method: 'get',
        path: '/message-templates',
        permission: 'opd:settings:read',
        audit: null,
        summary: 'Patient messages and when they go',
        handler: () => settings.listMessages(),
      },
      {
        method: 'put',
        path: '/message-templates/:code',
        permission: 'opd:settings:update',
        audit: 'UPDATE',
        summary: 'Turn a message on or off',
        schema: {
          params: z.object({ code: z.string().regex(/^[A-Z_]{3,30}$/) }),
          body: z.object({ on: z.boolean() }),
        },
        handler: (req) => settings.saveMessage(req.valid.params.code, req.valid.body),
      },
      {
        method: 'get',
        path: '/visit-types',
        permission: ['opd:settings:read', 'opd:appointment:read'],
        audit: null,
        summary: 'Visit types and how they are priced',
        handler: () => settings.listVisitTypes(),
      },
      {
        method: 'post',
        path: '/visit-types',
        permission: 'opd:settings:update',
        audit: 'CREATE',
        status: 201,
        summary: 'Add a visit type',
        schema: {
          body: z.object({
            code: z.string().regex(/^[A-Z_]{3,20}$/),
            name: text(60).min(2),
            slotMin: z.number().int().min(5).max(120),
            fee: text(30),
            online: z.boolean(),
            tele: z.boolean(),
          }),
        },
        handler: (req) => settings.addVisitType(req.valid.body),
      },

      // ---------------------------------------------------------------- other appointment tabs
      {
        method: 'get',
        path: '/health-checkups',
        permission: READ,
        audit: null,
        summary: 'Health check-ups today',
        schema: { query: pageQuery.extend({ date: ymd.optional() }) },
        handler: (req) => extras.listCheckups(req.valid.query),
      },
      {
        method: 'post',
        path: '/health-checkups',
        permission: 'opd:appointment:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Book a health check-up package',
        schema: {
          body: z.object({
            patientId: objectId,
            package: text(80).min(2),
            company: text(80).optional(),
            stations: z.number().int().min(1).max(20).optional(),
          }),
        },
        handler: (req) => extras.bookCheckup(req.valid.body),
      },
      {
        method: 'post',
        path: '/health-checkups/import',
        permission: 'opd:appointment:create',
        audit: 'CREATE',
        summary: 'Import a corporate check-up list (CSV: UHID,package)',
        schema: { body: z.object({ company: text(80).min(2), csv: z.string().max(200_000) }) },
        handler: (req) => extras.importCheckups(req.valid.body),
      },
      {
        method: 'get',
        path: '/tele-consults',
        permission: READ,
        audit: null,
        summary: 'Tele-consultations today',
        handler: () => appts.teleConsults(),
      },
      {
        method: 'post',
        path: '/tele-consults/:id/start',
        permission: [CONSULT_WRITE, 'opd:appointment:update'],
        audit: 'UPDATE',
        summary: 'Start the video call',
        schema: { params: id },
        noBody: true,
        handler: (req) => appts.startTele(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/treatment-plans',
        permission: READ,
        audit: null,
        summary: 'Multi-session treatment plans',
        schema: { query: pageQuery },
        handler: (req) => extras.listPlans(req.valid.query),
      },
      {
        method: 'post',
        path: '/treatment-plans',
        permission: ['opd:appointment:create', CONSULT_WRITE],
        audit: 'CREATE',
        status: 201,
        summary: 'Start a treatment plan',
        schema: {
          body: z.object({
            patientId: objectId,
            plan: text(120).min(3),
            sessions: z.number().int().min(1).max(100),
            firstSession: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
              .optional(),
            billing: z.enum(['PACKAGE', 'PER_SESSION']),
            amount: z.number().int().min(0).nullish(),
          }),
        },
        handler: (req) => extras.addPlan(req.valid.body),
      },
      {
        method: 'get',
        path: '/resources',
        permission: READ,
        audit: null,
        summary: 'Rooms, equipment and therapists',
        schema: { query: pageQuery },
        handler: (req) => extras.listResources(req.valid.query),
      },
      {
        method: 'post',
        path: '/resources',
        permission: ['opd:schedule:update', 'opd:settings:update'],
        audit: 'CREATE',
        status: 201,
        summary: 'Add a bookable resource',
        schema: {
          body: z.object({
            name: text(80).min(2),
            type: z.enum(['ROOM', 'EQUIPMENT', 'THERAPIST']),
            bookableFor: text(120).optional(),
            slots: z.number().int().min(1).max(100),
          }),
        },
        handler: (req) => extras.addResource(req.valid.body),
      },
    ],
    'queue:update',
  ),
});

/** OPD reports live under /reports (permission reports:opd:read). */
export const opdReportRoutes = defineRoutes({
  module: 'OPD',
  basePath: '/reports',
  routes: [
    {
      method: 'get',
      path: '/opd-wait-times',
      permission: 'reports:opd:read',
      audit: null,
      summary: 'OPD KPIs, median wait by stage and arrivals by hour',
      schema: { query: period },
      handler: (req) => reports.waitTimes(req.valid.query),
    },
    {
      method: 'get',
      path: '/opd-doctor-performance',
      permission: 'reports:opd:read',
      audit: null,
      summary: 'Doctor-wise booked, seen, waits, consult time and revenue',
      schema: { query: period },
      handler: (req) => reports.doctorPerformance(req.valid.query),
    },
  ],
});

/** Queue TV with a display key: no signed-in user, mounted before sign-in. */
export const opdPublicRoutes = defineRoutes({
  module: 'OPD',
  basePath: '/opd',
  routes: [
    {
      method: 'get',
      path: '/queue/display/tv',
      permission: 'public',
      audit: null,
      summary: 'Queue TV by display key (X-Display-Key): tokens and rooms only',
      handler: (req) => displays.displayForKey(req.get('x-display-key')),
    },
  ],
});
