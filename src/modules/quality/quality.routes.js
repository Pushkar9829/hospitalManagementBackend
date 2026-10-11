import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { hasPermission } from '@hms/shared';
import { defineRoutes } from '../../core/http/route.js';
import { current } from '../../core/tenancy/context.js';
import * as q from './services/quality.service.js';

const id = z.object({ id: objectId });
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const can = (key) => hasPermission([...current().permissions], key);

/** Quality (board Quality): feedback, complaints, incidents, indicators, audits, documents, HAI. */
export const qualityRoutes = defineRoutes({
  module: 'QLT',
  basePath: '/quality',
  routes: [
    {
      method: 'get',
      path: '/overview',
      permission: 'quality:incident:read',
      audit: null,
      summary: 'Open incidents and complaints, documents due for review',
      handler: () => q.overview(),
    },
    {
      method: 'get',
      path: '/settings',
      permission: 'quality:indicator:read',
      audit: null,
      summary: 'Indicator targets, complaint turnaround, feedback switches',
      handler: () => q.getSettings(),
    },
    {
      method: 'put',
      path: '/settings',
      permission: 'quality:settings:update',
      audit: 'UPDATE',
      summary: 'Edit quality settings',
      schema: { body: q.settingsInput },
      handler: (req) => q.saveSettings(req.valid.body),
    },
    // feedback
    {
      method: 'get',
      path: '/feedback',
      permission: 'quality:feedback:read',
      audit: null,
      summary: 'Feedback for a period: averages, NPS, comments',
      schema: { query: z.object({ from: ymd, to: ymd }) },
      handler: (req) => q.feedbackSummary(req.valid.query),
    },
    // complaints
    {
      method: 'get',
      path: '/complaints',
      permission: 'quality:complaint:read',
      audit: null,
      summary: 'Complaint register',
      schema: { query: z.object({ status: z.string().max(80).optional() }) },
      handler: (req) => q.listComplaints(req.valid.query),
    },
    {
      method: 'post',
      path: '/complaints',
      permission: ['quality:complaint:create', 'patients:patient:create'],
      audit: 'CREATE',
      status: 201,
      summary: 'Register a complaint (front office, phone, written)',
      schema: { body: q.complaintInput },
      handler: (req) => q.createComplaint(req.valid.body),
    },
    {
      method: 'post',
      path: '/complaints/:id/action',
      permission: 'quality:complaint:update',
      audit: 'UPDATE',
      summary: 'Assign, escalate, resolve or close (closure message to the patient)',
      schema: { params: id, body: q.complaintActionInput },
      handler: (req) => q.complaintAction(req.valid.params.id, req.valid.body),
    },
    // incidents
    {
      method: 'get',
      path: '/incidents',
      permission: 'authenticated',
      audit: null,
      summary: 'Incidents (the quality team sees all; staff see the ones they reported by name)',
      schema: {
        query: z.object({
          status: z.string().max(80).optional(),
          type: z.string().max(30).optional(),
        }),
      },
      handler: (req) =>
        q.listIncidents({ ...req.valid.query, mine: !can('quality:incident:update') }),
    },
    {
      method: 'post',
      path: '/incidents',
      permission: 'authenticated',
      audit: 'CREATE',
      status: 201,
      summary: 'Report an incident (any staff)',
      schema: { body: q.incidentInput },
      handler: (req) => q.reportIncident(req.valid.body),
    },
    {
      method: 'post',
      path: '/incidents/anonymous',
      permission: 'authenticated',
      // Anonymous by design: the report is not attributed in the audit trail either.
      audit: null,
      status: 201,
      summary: 'Report an incident anonymously',
      schema: { body: q.incidentInput },
      handler: (req) => q.reportIncident(req.valid.body, { anonymous: true }),
    },
    {
      method: 'get',
      path: '/incidents/:id',
      // Incident reports are confidential to the quality team (not every quality reader).
      permission: 'quality:incident:update',
      audit: 'VIEW',
      summary: 'An incident with investigation and actions',
      schema: { params: id },
      handler: (req) => q.getIncident(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/incidents/:id/investigation',
      permission: 'quality:incident:update',
      audit: 'UPDATE',
      summary: 'Investigator, root cause and corrective/preventive actions',
      schema: { params: id, body: q.investigationInput },
      handler: (req) => q.investigate(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/incidents/:id/actions/:actionId/done',
      permission: 'quality:incident:update',
      audit: 'UPDATE',
      summary: 'Action completed',
      schema: { params: z.object({ id: objectId, actionId: objectId }) },
      noBody: true,
      handler: (req) => q.completeAction(req.valid.params.id, req.valid.params.actionId),
    },
    {
      method: 'post',
      path: '/incidents/:id/close',
      permission: 'quality:incident:update',
      audit: 'UPDATE',
      summary: 'Ask for closure (Quality Manager approves)',
      schema: { params: id },
      noBody: true,
      handler: (req, res) => q.requestClosure(req.valid.params.id, res),
    },
    // indicators and infection control
    {
      method: 'get',
      path: '/indicators',
      permission: 'quality:indicator:read',
      audit: null,
      summary: 'Monthly quality indicators against targets',
      schema: { query: z.object({ month }) },
      handler: (req) => q.indicators(req.valid.query),
    },
    {
      method: 'get',
      path: '/infection',
      permission: 'quality:infection:read',
      audit: null,
      summary: 'HAI cases and rates per 1,000 device days',
      schema: { query: z.object({ month }) },
      handler: (req) => q.infectionRates(req.valid.query),
    },
    {
      method: 'post',
      path: '/infection/cases',
      permission: 'quality:infection:update',
      audit: 'CREATE',
      status: 201,
      summary: 'Record a hospital-acquired infection',
      schema: { body: q.haiInput },
      handler: (req) => q.recordHai(req.valid.body),
    },
    {
      method: 'put',
      path: '/infection/device-days',
      permission: 'quality:infection:update',
      audit: 'UPDATE',
      summary: 'Device days for a ward and month',
      schema: { body: q.deviceDaysInput },
      handler: (req) => q.saveDeviceDays(req.valid.body),
    },
    // audits
    {
      method: 'get',
      path: '/audit-templates',
      permission: 'quality:audit:read',
      audit: null,
      summary: 'Audit checklists',
      handler: () => q.listTemplates(),
    },
    {
      method: 'get',
      path: '/audits',
      permission: 'quality:audit:read',
      audit: null,
      summary: 'Completed audits with scores',
      schema: { query: z.object({ templateCode: z.string().max(30).optional() }) },
      handler: (req) => q.listAudits(req.valid.query),
    },
    {
      method: 'post',
      path: '/audits',
      permission: 'quality:audit:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Record an audit (items not met need an action)',
      schema: { body: q.auditInput },
      handler: (req) => q.recordAudit(req.valid.body),
    },
    {
      method: 'post',
      path: '/audits/:id/actions/:actionId/done',
      permission: 'quality:audit:create',
      audit: 'UPDATE',
      summary: 'Audit action completed',
      schema: { params: z.object({ id: objectId, actionId: objectId }) },
      noBody: true,
      handler: (req) => q.closeAuditAction(req.valid.params.id, req.valid.params.actionId),
    },
    // documents
    {
      method: 'get',
      path: '/documents',
      permission: 'authenticated',
      audit: null,
      summary: 'Policies and SOPs (staff see the current ones)',
      schema: { query: z.object({ status: z.string().max(60).optional() }) },
      handler: (req) =>
        q.listDocuments(can('quality:document:create') ? req.valid.query : { status: 'ACTIVE' }),
    },
    {
      method: 'post',
      path: '/documents',
      permission: 'quality:document:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Draft a document or a new version',
      schema: { body: q.documentInput },
      handler: (req) => q.draftDocument(req.valid.body),
    },
    {
      method: 'post',
      path: '/documents/:id/approve',
      permission: 'quality:document:approve',
      audit: 'APPROVE',
      summary: 'Approve a draft (not by its author); the old version retires',
      schema: { params: id },
      noBody: true,
      handler: (req) => q.approveDocument(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/documents/:id/acknowledge',
      permission: 'authenticated',
      audit: 'UPDATE',
      summary: 'I have read this version',
      schema: { params: id },
      noBody: true,
      handler: (req) => q.acknowledge(req.valid.params.id),
    },
  ],
});

/** The patient's feedback page (public link from the SMS). */
export const feedbackPublicRoutes = defineRoutes({
  module: 'QLT',
  basePath: '/feedback',
  routes: [
    {
      method: 'get',
      path: '/:token',
      permission: 'public',
      audit: null,
      summary: 'Feedback form context',
      schema: { params: z.object({ token: z.string().regex(/^[a-f0-9]{32}$/) }) },
      handler: (req) => q.feedbackForm(req.valid.params.token),
    },
    {
      method: 'post',
      path: '/:token',
      permission: 'public',
      audit: 'CREATE',
      summary: 'Submit feedback',
      schema: {
        params: z.object({ token: z.string().regex(/^[a-f0-9]{32}$/) }),
        body: q.feedbackInput,
      },
      handler: (req) => q.submitFeedback(req.valid.params.token, req.valid.body),
    },
  ],
});
