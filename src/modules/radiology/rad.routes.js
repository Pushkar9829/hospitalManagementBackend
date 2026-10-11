import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import { MODALITIES } from './models/rad.models.js';
import * as rad from './services/rad.service.js';

const id = z.object({ id: objectId });
const text = (max = 300) => z.string().trim().max(max);
const READ = ['rad:study:read', 'rad:report:read'];
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Radiology (board Radiology): orders, scheduling, safety checks, reporting and sign-off. */
export const radRoutes = defineRoutes({
  module: 'RAD',
  basePath: '/rad',
  routes: withLiveUpdates(
    [
      {
        method: 'post',
        path: '/orders',
        permission: ['rad:order:create', 'lab:order:create'],
        audit: 'CREATE',
        status: 201,
        summary: 'Order imaging for an in-patient (running bill) or a walk-in (an OP bill)',
        schema: {
          body: z
            .object({
              admissionId: objectId.optional(),
              patientId: objectId.optional(),
              doctorId: objectId.optional(),
              studies: z.array(objectId).min(1).max(10),
              priority: z.enum(['ROUTINE', 'URGENT', 'STAT']).default('ROUTINE'),
              clinicalNotes: text(500).optional(),
            })
            .refine((b) => b.admissionId || b.patientId, {
              message: 'Pick the patient or the stay',
              path: ['patientId'],
            }),
        },
        handler: (req) => rad.createOrder(req.valid.body),
      },
      {
        method: 'get',
        path: '/studies',
        permission: READ,
        audit: null,
        summary: 'Studies by stage (schedule, today, report, sign, signed)',
        schema: {
          query: z.object({
            stage: z.enum(['schedule', 'today', 'report', 'sign', 'signed']).optional(),
            status: text(120).optional(),
            modality: z.enum(MODALITIES).optional(),
            patientId: objectId.optional(),
            visitId: objectId.optional(),
            admissionId: objectId.optional(),
            pcpndt: z.coerce.boolean().optional(),
            date: ymd.optional(),
            q: text(80).optional(),
            days: z.coerce.number().int().min(1).max(60).optional(),
          }),
        },
        handler: (req) => rad.listStudies(req.valid.query),
      },
      {
        method: 'get',
        path: '/studies/counts',
        permission: READ,
        audit: null,
        summary: 'Studies waiting at each stage',
        handler: () => rad.counts(),
      },
      {
        method: 'get',
        path: '/studies/:id',
        permission: READ,
        audit: 'VIEW',
        summary: 'One study with checks and report',
        schema: { params: id },
        handler: (req) => rad.getStudy(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/slots',
        permission: ['rad:study:schedule', 'rad:study:read'],
        audit: null,
        summary: 'Free slots per room for a modality and day',
        schema: { query: z.object({ modality: z.enum(MODALITIES), date: ymd.optional() }) },
        handler: (req) => rad.slots(req.valid.query),
      },
      {
        method: 'post',
        path: '/studies/:id/schedule',
        permission: 'rad:study:schedule',
        audit: 'UPDATE',
        summary: 'Book a slot; the preparation SMS goes to the patient',
        schema: {
          params: id,
          body: z.object({ room: text(10).min(2), at: z.string().datetime() }),
        },
        handler: (req) => rad.schedule(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/studies/:id/arrive',
        permission: ['rad:study:schedule', 'rad:study:perform'],
        audit: 'UPDATE',
        summary: 'Patient arrived (out-patients pay first)',
        schema: { params: id },
        noBody: true,
        handler: (req) => rad.arrive(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/studies/:id/contrast',
        permission: 'rad:study:perform',
        audit: 'UPDATE',
        summary: 'Contrast consent and creatinine before a contrast study',
        schema: { params: id, body: rad.contrastInput },
        handler: (req) => rad.contrastCheck(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/studies/:id/form-f',
        permission: 'rad:study:perform',
        audit: 'CREATE',
        summary: 'PCPNDT Form F before an obstetric ultrasound',
        schema: { params: id, body: rad.formFInput },
        handler: (req) => rad.saveFormF(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/studies/:id/perform',
        permission: 'rad:study:perform',
        audit: 'UPDATE',
        summary: 'Study performed (contrast check and Form F enforced)',
        schema: { params: id, body: z.object({ techNotes: text(500).optional() }) },
        handler: (req) => rad.perform(req.valid.params.id, req.valid.body),
      },
      {
        method: 'put',
        path: '/studies/:id/report',
        permission: 'rad:report:write',
        audit: 'UPDATE',
        summary: 'Draft the report from the template',
        schema: {
          params: id,
          body: z.object({
            findings: text(8000).min(5),
            impression: text(2000).min(3),
            critical: z.boolean().default(false),
          }),
        },
        handler: (req) => rad.saveReport(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/studies/:id/sign',
        permission: 'rad:report:sign',
        audit: 'APPROVE',
        summary: 'Radiologist sign-off (not the one who drafted)',
        schema: { params: id },
        noBody: true,
        handler: (req) => rad.sign(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/studies/:id/addenda',
        permission: 'rad:report:sign',
        audit: 'UPDATE',
        summary: 'Addendum to a signed report',
        schema: { params: id, body: z.object({ text: text(2000).min(3) }) },
        handler: (req) => rad.addAddendum(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/studies/:id/cancel',
        permission: ['rad:order:cancel', 'rad:study:schedule'],
        audit: 'DELETE',
        summary: 'Cancel a study not yet started',
        schema: { params: id, body: z.object({ reason: text(200).min(3) }) },
        handler: (req) => rad.cancel(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/studies/:id/acknowledge',
        permission: ['rad:report:acknowledge', 'rad:report:read'],
        audit: 'UPDATE',
        summary: 'The doctor acknowledges a signed report',
        schema: { params: id },
        noBody: true,
        handler: (req) => rad.acknowledge(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/patients/:id/studies',
        permission: READ,
        audit: 'VIEW',
        summary: 'A patient’s imaging: report only once signed',
        schema: { params: id },
        handler: (req) => rad.patientStudies(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/form-f',
        permission: ['rad:pcpndt:read', 'rad:study:perform'],
        audit: 'VIEW',
        summary: 'PCPNDT Form F register for a month',
        schema: {
          query: z.object({
            month: z
              .string()
              .regex(/^\d{4}-\d{2}$/)
              .optional(),
          }),
        },
        handler: (req) => rad.formFRegister(req.valid.query),
      },
      {
        method: 'get',
        path: '/studies-master',
        permission: ['rad:settings:read', 'rad:order:create', 'rad:study:read', 'lab:order:create'],
        audit: null,
        summary: 'Study master: modality, preparation, contrast, template',
        schema: { query: z.object({ modality: z.enum(MODALITIES).optional() }) },
        handler: (req) => rad.listDefs(req.valid.query),
      },
      {
        method: 'put',
        path: '/studies-master/:id',
        permission: 'rad:settings:update',
        audit: 'UPDATE',
        summary: 'Edit a study definition',
        schema: { params: id, body: rad.defInput },
        handler: (req) => rad.updateDef(req.valid.params.id, req.valid.body),
      },
      {
        method: 'get',
        path: '/settings',
        permission: ['rad:settings:read', 'rad:study:read'],
        audit: null,
        summary: 'Rooms, hours, PACS viewer link, creatinine limit',
        handler: () => rad.getSettings(),
      },
      {
        method: 'put',
        path: '/settings',
        permission: 'rad:settings:update',
        audit: 'UPDATE',
        summary: 'Save radiology settings',
        schema: { body: rad.settingsInput },
        handler: (req) => rad.saveSettings(req.valid.body),
      },
    ],
    'rad:update',
  ),
});
