import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import * as catalog from './services/catalog.service.js';
import * as orders from './services/order.service.js';
import * as qc from './services/qc.service.js';
import * as reports from './services/reports.service.js';
import * as results from './services/result.service.js';

const id = z.object({ id: objectId });
const barcode = z.object({ sampleNo: z.string().trim().min(3).max(30) });
const text = (max = 300) => z.string().trim().max(max);
const PRIORITY = z.enum(['ROUTINE', 'URGENT', 'STAT']);
const DEPARTMENT = z.enum([
  'BIOCHEMISTRY',
  'HAEMATOLOGY',
  'CLINICAL_PATHOLOGY',
  'SEROLOGY',
  'MICROBIOLOGY',
  'HISTOPATHOLOGY',
]);
const READ = ['lab:order:read', 'lab:sample:read', 'lab:result:read'];
const resultValues = z
  .array(z.object({ code: text(12).min(1), value: text(200) }))
  .min(1)
  .max(40);

/** Laboratory (docs/modules/LAB.md): order to released report, QC, settings. */
export const labRoutes = defineRoutes({
  module: 'LAB',
  basePath: '/lab',
  routes: withLiveUpdates(
    [
      // ---------------------------------------------------------------- orders and worklists
      {
        method: 'post',
        path: '/orders',
        permission: 'lab:order:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Order tests for an in-patient (to the running bill) or a walk-in (an OP bill)',
        schema: {
          body: z
            .object({
              admissionId: objectId.optional(),
              patientId: objectId.optional(),
              doctorId: objectId.optional(),
              tests: z.array(objectId).min(1).max(30),
              priority: PRIORITY.default('ROUTINE'),
              clinicalNotes: text(500).optional(),
              duplicateReason: text(200).optional(),
            })
            .refine((b) => b.admissionId || b.patientId, {
              message: 'Pick the patient or the stay',
              path: ['patientId'],
            }),
        },
        handler: (req) => orders.createOrder(req.valid.body),
      },
      {
        method: 'get',
        path: '/items',
        permission: READ,
        audit: null,
        summary: 'Worklist: tests by stage (collect, receive, results, verify, validate, released)',
        schema: {
          query: z.object({
            stage: z
              .enum(['collect', 'receive', 'results', 'verify', 'validate', 'released'])
              .optional(),
            status: text(200).optional(),
            department: DEPARTMENT.optional(),
            priority: PRIORITY.optional(),
            source: z.enum(['OPD', 'IPD', 'WALKIN']).optional(),
            patientId: objectId.optional(),
            visitId: objectId.optional(),
            admissionId: objectId.optional(),
            orderNo: text(40).optional(),
            held: z.coerce.boolean().optional(),
            q: text(80).optional(),
            days: z.coerce.number().int().min(1).max(30).optional(),
            limit: z.coerce.number().int().min(1).max(500).optional(),
          }),
        },
        handler: (req) => orders.listItems(req.valid.query),
      },
      {
        method: 'get',
        path: '/items/counts',
        permission: READ,
        audit: null,
        summary: 'Tests waiting at each stage (worklist tab counts)',
        handler: () => orders.stageCounts(),
      },
      {
        method: 'get',
        path: '/items/:id',
        permission: READ,
        audit: 'VIEW',
        summary: 'One test with its results, holds and history',
        schema: { params: id },
        handler: (req) => orders.getItem(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/items/:id/cancel',
        permission: ['lab:order:cancel', 'lab:order:create'],
        audit: 'DELETE',
        summary: 'Cancel a test not yet collected',
        schema: { params: id, body: z.object({ reason: text(200).min(3) }) },
        handler: (req) => orders.cancelItem(req.valid.params.id, req.valid.body),
      },

      // ---------------------------------------------------------------- collection and receipt
      {
        method: 'get',
        path: '/collection',
        permission: ['lab:sample:collect', 'lab:sample:read'],
        audit: null,
        summary: 'Collection list by patient order, with payment state (rule R2)',
        schema: {
          query: z.object({
            source: z.enum(['OPD', 'IPD', 'WALKIN']).optional(),
            q: text(80).optional(),
          }),
        },
        handler: (req) => orders.collectionList(req.valid.query),
      },
      {
        method: 'post',
        path: '/collect',
        permission: 'lab:sample:collect',
        audit: 'CREATE',
        summary: 'Collect after the wristband scan (rule R1); returns the barcode labels',
        schema: {
          body: z.object({
            itemIds: z.array(objectId).min(1).max(30),
            scan: text(40).min(3),
          }),
        },
        handler: (req) => orders.collect(req.valid.body),
      },
      {
        method: 'get',
        path: '/samples',
        permission: ['lab:sample:read', 'lab:sample:receive'],
        audit: null,
        summary: 'Samples by status (in transit by default)',
        schema: {
          query: z.object({ status: text(80).optional(), q: text(80).optional() }),
        },
        handler: (req) => orders.listSamples(req.valid.query),
      },
      {
        method: 'get',
        path: '/samples/:sampleNo',
        permission: ['lab:sample:read', 'lab:sample:receive'],
        audit: null,
        summary: 'A sample by its barcode',
        schema: { params: barcode },
        handler: (req) => orders.getSample(req.valid.params.sampleNo),
      },
      {
        method: 'post',
        path: '/samples/:sampleNo/receive',
        permission: 'lab:sample:receive',
        audit: 'UPDATE',
        summary: 'Accession on scan: the tests move to the bench worklists',
        schema: { params: barcode },
        noBody: true,
        handler: (req) => orders.receive(req.valid.params.sampleNo),
      },
      {
        method: 'post',
        path: '/samples/:sampleNo/reject',
        permission: 'lab:sample:receive',
        audit: 'REJECT',
        summary: 'Reject with a reason; the tests return for recollection (rule R3)',
        schema: {
          params: barcode,
          body: z.object({ reason: text(40).min(2), note: text(300).optional() }),
        },
        handler: (req) => orders.reject(req.valid.params.sampleNo, req.valid.body),
      },

      // ---------------------------------------------------------------- results and release
      {
        method: 'put',
        path: '/items/:id/results',
        permission: 'lab:result:enter',
        audit: 'UPDATE',
        summary: 'Enter results: range, critical and delta checks; QC must be in control (R4)',
        schema: {
          params: id,
          body: z.object({ results: resultValues, comment: text(1000).optional() }),
        },
        handler: (req) => results.enterResults(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/items/:id/verify',
        permission: 'lab:result:verify',
        audit: 'UPDATE',
        summary: 'Technical verification (step one of rule R9)',
        schema: { params: id },
        noBody: true,
        handler: (req) => results.verify(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/items/:id/release',
        permission: 'lab:result:release',
        audit: 'APPROVE',
        summary: 'Pathologist validates and releases (never the person who entered, rule R9)',
        schema: {
          params: id,
          body: z.object({
            comment: text(1000).optional(),
            acceptDelta: z.boolean().default(false),
          }),
        },
        handler: (req) => results.release(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/items/:id/amend',
        permission: 'lab:result:amend',
        audit: 'UPDATE',
        summary: 'Amend a released report: a new version after approval (rule R10)',
        schema: {
          params: id,
          body: z.object({ reason: text(500).min(5), results: resultValues }),
        },
        handler: (req, res) => results.amend(req.valid.params.id, req.valid.body, res),
      },
      {
        method: 'post',
        path: '/items/:id/acknowledge',
        permission: ['lab:result:acknowledge', 'lab:result:read'],
        audit: 'UPDATE',
        summary: 'The doctor acknowledges a released result',
        schema: { params: id },
        noBody: true,
        handler: (req) => results.acknowledge(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/reports/:orderNo',
        permission: READ,
        audit: 'VIEW',
        summary: 'The report for an order: released tests with ranges, flags and trends',
        schema: { params: z.object({ orderNo: text(40).min(3) }) },
        handler: (req) => results.report(req.valid.params.orderNo),
      },
      {
        method: 'get',
        path: '/patients/:id/results',
        permission: READ,
        audit: 'VIEW',
        summary: 'A patient’s tests: status for all, values once released',
        schema: { params: id },
        handler: (req) => results.patientResults(req.valid.params.id),
      },

      // ---------------------------------------------------------------- critical calls (R7)
      {
        method: 'get',
        path: '/critical-calls',
        permission: ['lab:critical:read', 'lab:result:read'],
        audit: null,
        summary: 'Critical values waiting to be phoned (overdue first)',
        schema: { query: z.object({ open: z.coerce.boolean().default(true) }) },
        handler: (req) => results.listCalls(req.valid.query),
      },
      {
        method: 'post',
        path: '/critical-calls/:id/log',
        permission: 'lab:critical:log',
        audit: 'UPDATE',
        summary: 'Log a call: reached with read-back closes it; not reached stays open',
        schema: {
          params: id,
          body: z.object({
            to: text(80).min(2),
            role: z.enum(['DOCTOR', 'NURSE', 'HOD', 'MEDICAL_SUPERINTENDENT']),
            reached: z.boolean(),
            readBack: z.boolean().default(false),
            note: text(300).optional(),
          }),
        },
        handler: (req) => results.logCall(req.valid.params.id, req.valid.body),
      },

      // ---------------------------------------------------------------- quality control
      {
        method: 'get',
        path: '/qc/controls',
        permission: ['lab:qc:read', 'lab:result:enter'],
        audit: null,
        summary: 'QC controls with their latest run',
        handler: () => qc.listControls(),
      },
      {
        method: 'post',
        path: '/qc/controls',
        permission: 'lab:qc:update',
        audit: 'CREATE',
        status: 201,
        summary: 'Add a QC control (analyser, analyte, level, mean and SD)',
        schema: { body: qc.controlInput },
        handler: (req) => qc.createControl(req.valid.body),
      },
      {
        method: 'post',
        path: '/qc/runs',
        permission: 'lab:qc:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Record a QC value; Westgard rules decide (a rejected run holds results)',
        schema: {
          body: z.object({
            controlId: objectId,
            value: z.number().finite(),
            note: text(300).optional(),
          }),
        },
        handler: (req) => qc.recordRun(req.valid.body),
      },
      {
        method: 'get',
        path: '/qc/levey-jennings',
        permission: ['lab:qc:read', 'lab:result:enter'],
        audit: null,
        summary: 'Levey-Jennings chart data for a control',
        schema: { query: z.object({ control: objectId }) },
        handler: (req) => qc.leveyJennings(req.valid.query.control),
      },
      {
        method: 'get',
        path: '/qc/status',
        permission: READ,
        audit: null,
        summary: 'Each analyser: in control or not (rule R4)',
        handler: () => qc.qcStatus(),
      },

      // ---------------------------------------------------------------- settings and tests
      {
        method: 'get',
        path: '/tests',
        permission: [
          'lab:settings:read',
          'lab:order:create',
          'lab:order:read',
          'lab:homevisit:create',
        ],
        audit: null,
        summary: 'Test master: sample, container, analyser, ranges, critical and delta limits',
        schema: { query: z.object({ q: text(80).optional(), department: DEPARTMENT.optional() }) },
        handler: (req) => catalog.listTests(req.valid.query),
      },
      {
        method: 'get',
        path: '/tests/:id',
        permission: ['lab:settings:read', 'lab:result:enter', 'lab:order:read'],
        audit: null,
        summary: 'One test definition',
        schema: { params: id },
        handler: (req) => catalog.getTest(req.valid.params.id),
      },
      {
        method: 'put',
        path: '/tests/:id',
        permission: 'lab:settings:update',
        audit: 'UPDATE',
        summary: 'Edit a test: ranges, critical and delta limits (prices stay in setup)',
        schema: { params: id, body: catalog.testInput },
        handler: (req) => catalog.updateTest(req.valid.params.id, req.valid.body),
      },
      {
        method: 'get',
        path: '/settings',
        permission: ['lab:settings:read', 'lab:sample:receive', 'lab:result:enter'],
        audit: null,
        summary: 'Lab settings: call times, delta look-back, TAT targets, rejection reasons',
        handler: () => catalog.getSettings(),
      },
      {
        method: 'put',
        path: '/settings',
        permission: 'lab:settings:update',
        audit: 'UPDATE',
        summary: 'Save lab settings',
        schema: { body: catalog.settingsInput },
        handler: (req) => catalog.saveSettings(req.valid.body),
      },
    ],
    'lab:update',
  ),
});

/** Lab analytics (board LabAnalytics). */
export const labReportRoutes = defineRoutes({
  module: 'LAB',
  basePath: '/reports',
  routes: [
    {
      method: 'get',
      path: '/lab-tat',
      permission: 'reports:lab:read',
      audit: null,
      summary: 'Lab turnaround by stage, priority and test',
      schema: {
        query: z.object({
          period: z.enum(['today', 'week', 'month']).default('today'),
          department: DEPARTMENT.optional(),
        }),
      },
      handler: (req) => reports.tat(req.valid.query),
    },
    {
      method: 'get',
      path: '/lab-indicators',
      permission: 'reports:lab:read',
      audit: null,
      summary: 'NABL quality indicators: rejections, critical calls, QC, amendments, volume',
      schema: { query: z.object({ period: z.enum(['today', 'week', 'month']).default('today') }) },
      handler: (req) => reports.indicators(req.valid.query),
    },
  ],
});
