import { z } from 'zod';
import { objectId, pageQuery } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import * as adm from './services/admission.service.js';
import * as beds from './services/beds.service.js';
import * as charges from './services/charges.service.js';
import * as cfg from './services/settings.service.js';

const id = z.object({ id: objectId });
const text = (max = 300) => z.string().trim().max(max);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const CATEGORIES = [
  'GENERAL',
  'SEMI_PRIVATE',
  'PRIVATE',
  'DELUXE',
  'ICU',
  'NICU',
  'PICU',
  'HDU',
  'ISOLATION',
  'DAYCARE',
  'EMERGENCY',
  'LABOUR',
];
const READ = ['ipd:admission:read', 'ipd:bed:read'];
const DISCHARGE = ['ipd:discharge:update', 'ipd:discharge:sign'];

const payer = z.object({
  kind: z.enum(['CASH', 'INSURANCE', 'CORPORATE', 'SCHEME']).default('CASH'),
  payerId: objectId.optional(),
  policyNo: text(60).optional(),
  roomRentLimit: z.number().int().min(0).optional(),
});
const summary = z.object({
  diagnoses: z
    .array(z.object({ code: text(10), name: text(200) }))
    .max(20)
    .optional(),
  procedures: z.array(text(200)).max(20).optional(),
  course: text(6000).optional(),
  condition: text(500).optional(),
  medicines: z
    .array(
      z.object({
        name: text(120),
        dose: text(60).optional(),
        frequency: text(30).optional(),
        days: z.number().int().min(1).max(365).optional(),
      }),
    )
    .max(30)
    .optional(),
  followUp: z
    .object({ date: z.union([ymd, z.literal('')]).optional(), note: text(300).optional() })
    .optional(),
  advice: text(2000).optional(),
});

export const ipdRoutes = defineRoutes({
  module: 'IPD',
  basePath: '/ipd',
  routes: withLiveUpdates(
    [
      // ---------------------------------------------------------------- beds
      {
        method: 'get',
        path: '/beds',
        permission: 'ipd:bed:read',
        audit: null,
        summary: 'Bed board: wards, each bed’s state and patient, counts and occupancy',
        schema: {
          query: z.object({ wardId: objectId.optional(), category: z.enum(CATEGORIES).optional() }),
        },
        handler: (req) => beds.board(req.valid.query),
      },
      {
        method: 'get',
        path: '/beds/suggest',
        permission: 'ipd:bed:allocate',
        audit: null,
        summary: 'Free beds that suit a request (category, bay gender, isolation; rule R4)',
        schema: { query: z.object({ requestId: objectId }) },
        handler: (req) => beds.suggest(req.valid.query.requestId),
      },
      {
        method: 'post',
        path: '/beds/:id/block',
        permission: ['ipd:bed:block', 'ipd:settings:update'],
        audit: 'UPDATE',
        summary: 'Block an available bed (maintenance)',
        schema: { params: id, body: z.object({ reason: text(200).min(3) }) },
        handler: (req) => beds.block(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/beds/:id/unblock',
        permission: ['ipd:bed:block', 'ipd:settings:update'],
        audit: 'UPDATE',
        summary: 'Return a blocked bed to service',
        schema: { params: id },
        noBody: true,
        handler: (req) => beds.unblock(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/cleaning',
        permission: ['ipd:bed:clean', 'ipd:bed:read'],
        audit: null,
        summary: 'Bed cleaning tasks with the turnaround target',
        schema: { query: z.object({ status: z.enum(['OPEN', 'DONE', 'ALL']).default('OPEN') }) },
        handler: (req) => beds.cleaningTasks(req.valid.query),
      },
      {
        method: 'post',
        path: '/cleaning/:id/done',
        permission: ['ipd:bed:clean', 'ipd:bed:allocate'],
        audit: 'UPDATE',
        summary: 'Cleaning done: the bed is available again (rule R19)',
        schema: { params: id },
        noBody: true,
        handler: async (req) => beds.cleaningDone(req.valid.params.id, await adm.userName()),
      },

      {
        method: 'get',
        path: '/lookups',
        permission: ['ipd:admission:create', 'ipd:admission:read', 'ipd:bed:allocate'],
        audit: null,
        summary: 'Consultants and payers for the admission desk',
        handler: () => adm.lookups(),
      },

      // ---------------------------------------------------------------- requests
      {
        method: 'get',
        path: '/admission-requests',
        permission: ['ipd:admission:read', 'ipd:admission:create', 'ipd:bed:allocate'],
        audit: null,
        summary: 'Admission requests waiting (emergency first)',
        schema: {
          query: pageQuery.extend({
            status: text(120).optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
          }),
        },
        handler: (req) => adm.listRequests(req.valid.query),
      },
      {
        method: 'post',
        path: '/admission-requests',
        permission: ['ipd:admission:create', 'orders:create', 'ipd:discharge:update'],
        audit: 'CREATE',
        status: 201,
        summary: 'Admission advised (doctor order: consultant, reason, stay; rule R1)',
        schema: {
          body: z.object({
            patientId: objectId,
            doctorId: objectId,
            reason: text(500).min(3),
            expectedDays: z.number().int().min(1).max(90).optional(),
            wardCategory: z.enum(CATEGORIES).default('GENERAL'),
            urgency: z.enum(['ROUTINE', 'TODAY', 'EMERGENCY']).default('TODAY'),
            isolation: z.boolean().optional(),
            packageId: objectId.optional(),
          }),
        },
        handler: (req) => adm.createRequest(req.valid.body),
      },
      {
        method: 'post',
        path: '/admission-requests/:id/estimate',
        permission: 'ipd:admission:create',
        audit: 'UPDATE',
        summary: 'Estimate: room for the stay or the package, and the deposit',
        schema: {
          params: id,
          body: z.object({
            expectedDays: z.number().int().min(1).max(90).optional(),
            wardCategory: z.enum(CATEGORIES).optional(),
            packageId: objectId.optional(),
          }),
        },
        handler: (req) => adm.estimate(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/admission-requests/:id/sign-estimate',
        permission: 'ipd:admission:create',
        audit: 'UPDATE',
        summary: 'Record that the patient signed the estimate',
        schema: { params: id, body: z.object({ signedBy: text(120).min(2) }) },
        handler: (req) => adm.signEstimate(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/admission-requests/:id/reserve',
        permission: 'ipd:bed:allocate',
        audit: 'UPDATE',
        summary: 'Reserve a bed for the request (expires after the hold time; rule R3)',
        schema: { params: id, body: z.object({ bedId: objectId }) },
        handler: (req) => beds.reserve(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/admission-requests/:id/cancel',
        permission: 'ipd:admission:create',
        audit: 'UPDATE',
        summary: 'Cancel a request (releases a reserved bed)',
        schema: { params: id, body: z.object({ reason: text(200).min(2) }) },
        handler: (req) => adm.cancelRequest(req.valid.params.id, req.valid.body),
      },

      // ---------------------------------------------------------------- admissions
      {
        method: 'post',
        path: '/admissions',
        permission: 'ipd:admission:create',
        audit: 'CREATE',
        status: 201,
        idempotent: 'optional',
        summary:
          'Admit (emergency: bed first; planned cash: deposit first; insured: pre-auth follows)',
        schema: {
          body: z.object({
            requestId: objectId.optional(),
            patientId: objectId.optional(),
            doctorId: objectId.optional(),
            reason: text(500).optional(),
            expectedDays: z.number().int().min(1).max(90).optional(),
            bedId: objectId.optional(),
            emergency: z.boolean().optional(),
            payer: payer.optional(),
            mlc: z.object({ flag: z.boolean(), policeIntimation: text(200).optional() }).optional(),
            consentHigherCategory: z.boolean().optional(),
          }),
        },
        handler: (req) => adm.admit(req.valid.body),
      },
      {
        method: 'get',
        path: '/admissions',
        permission: READ,
        audit: null,
        summary: 'In-patients (doctorId=me for the signed-in consultant)',
        schema: {
          query: pageQuery.extend({
            status: text(120).optional(),
            doctorId: z.string().max(24).optional(),
            wardId: objectId.optional(),
            q: text(60).optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
          }),
        },
        handler: (req) => adm.listAdmissions(req.valid.query),
      },
      {
        method: 'get',
        path: '/admissions/:id',
        permission: READ,
        audit: 'VIEW',
        summary: 'A stay with its running bill, deposit and charges',
        schema: { params: id },
        handler: (req) => adm.getAdmission(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/admissions/:id/transfer',
        permission: 'ipd:bed:allocate',
        audit: 'UPDATE',
        summary: 'Transfer or ICU step-up (rule R5 consent above the policy room rent)',
        schema: {
          params: id,
          body: z.object({
            bedId: objectId,
            reason: text(300).min(3),
            consentHigherCategory: z.boolean().optional(),
          }),
        },
        handler: (req) => adm.transfer(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/admissions/:id/charges',
        permission: ['billing:ip:create', 'nursing:charge:create', 'ipd:note:write'],
        audit: 'CREATE',
        summary: 'Charge a service to the stay (lands on the running bill)',
        schema: {
          params: id,
          body: z.object({
            serviceId: objectId,
            qty: z.number().int().min(1).max(99).default(1),
            source: text(20).optional(),
          }),
        },
        handler: async (req) =>
          charges.addCharge(req.valid.params.id, req.valid.body, await adm.userName()),
      },
      {
        method: 'post',
        path: '/admissions/:id/plan-discharge',
        permission: DISCHARGE,
        audit: 'UPDATE',
        summary: 'Expected discharge (billing, pharmacy and the TPA desk are told)',
        schema: {
          params: id,
          body: z.object({ expectedAt: z.string().datetime({ offset: true }) }),
        },
        handler: (req) => adm.planDischarge(req.valid.params.id, req.valid.body),
      },
      {
        method: 'put',
        path: '/admissions/:id/discharge-summary',
        permission: DISCHARGE,
        audit: 'UPDATE',
        summary: 'Save the draft discharge summary',
        schema: { params: id, body: summary },
        handler: (req) => adm.saveSummary(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/admissions/:id/discharge-summary/sign',
        permission: 'ipd:discharge:sign',
        audit: 'APPROVE',
        summary: 'Consultant signs the summary (rule R14)',
        schema: { params: id },
        noBody: true,
        handler: (req) => adm.signSummary(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/admissions/:id/discharge-summary/addenda',
        permission: 'ipd:discharge:sign',
        audit: 'UPDATE',
        summary: 'Addendum to a signed summary',
        schema: { params: id, body: z.object({ text: text(2000).min(2) }) },
        handler: (req) => adm.addAddendum(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/admissions/:id/advise-discharge',
        permission: DISCHARGE,
        audit: 'UPDATE',
        summary: 'Discharge advised: final bill and insurer approval clocks start',
        schema: { params: id },
        noBody: true,
        handler: (req) => adm.adviseDischarge(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/admissions/:id/final-bill',
        permission: ['billing:ip:finalize', 'billing:ip:create'],
        audit: 'UPDATE',
        summary: 'Post charges through today and finalise the IP bill',
        schema: { params: id },
        noBody: true,
        handler: (req) => adm.finalBill(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/admissions/:id/discharge',
        permission: ['ipd:discharge:complete', 'billing:ip:finalize'],
        audit: 'UPDATE',
        summary:
          'Patient leaves: normal, LAMA, death, absconded or referred (dues need approval, 202)',
        schema: {
          params: id,
          body: z.object({
            outcome: z.enum(['NORMAL', 'LAMA', 'DEATH', 'ABSCONDED', 'REFERRED']).default('NORMAL'),
            reason: text(300).optional(),
            lama: z
              .object({ risksExplained: z.boolean(), witness: text(120), signedBy: text(120) })
              .optional(),
            death: z
              .object({
                at: z.string().datetime({ offset: true }),
                cause: text(300),
                mccdNo: text(40).optional(),
              })
              .optional(),
          }),
        },
        handler: (req, res) => adm.completeDischarge(req.valid.params.id, req.valid.body, res),
      },

      // ---------------------------------------------------------------- settings
      {
        method: 'get',
        path: '/settings',
        permission: ['ipd:settings:read', 'ipd:bed:read'],
        audit: null,
        summary: 'IPD settings: deposits, alerts, room rent, targets',
        handler: () => cfg.getSettings(),
      },
      {
        method: 'put',
        path: '/settings',
        permission: 'ipd:settings:update',
        audit: 'UPDATE',
        summary: 'Save IPD settings',
        schema: { body: cfg.settingsInput },
        handler: (req) => cfg.saveSettings(req.valid.body),
      },
    ],
    'bed:update',
  ),
});
