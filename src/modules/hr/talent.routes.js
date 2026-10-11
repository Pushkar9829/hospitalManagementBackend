import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as tal from './services/talent.service.js';

const id = z.object({ id: objectId });
const version = z.object({ version: z.number().int().min(0) });

/** HR talent: recruitment, training, appraisal and exit clearances. */
export const talentRoutes = defineRoutes({
  module: 'HRM',
  basePath: '/hr',
  routes: [
    // ---------------------------------------------------------------- recruitment
    {
      method: 'get',
      path: '/openings',
      permission: ['hr:recruitment:read', 'hr:employee:read'],
      audit: null,
      summary: 'Job openings with the candidate pipeline',
      schema: { query: z.object({ status: z.enum(['OPEN', 'ON_HOLD', 'CLOSED']).optional() }) },
      handler: (req) => tal.listOpenings(req.valid.query),
    },
    {
      method: 'post',
      path: '/openings',
      permission: 'hr:recruitment:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Open a vacancy',
      schema: { body: tal.openingInput },
      handler: (req) => tal.createOpening(req.valid.body),
    },
    {
      method: 'put',
      path: '/openings/:id',
      permission: 'hr:recruitment:update',
      audit: 'UPDATE',
      summary: 'Hold, close or resize an opening',
      schema: {
        params: id,
        body: version.extend({
          status: z.enum(['OPEN', 'ON_HOLD', 'CLOSED']).optional(),
          positions: z.number().int().min(1).max(100).optional(),
        }),
      },
      handler: (req) => tal.updateOpening(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/openings/:id/candidates',
      permission: ['hr:recruitment:read', 'hr:employee:read'],
      audit: null,
      summary: 'Candidates for an opening',
      schema: { params: id },
      handler: (req) => tal.listCandidates({ openingId: req.valid.params.id }),
    },
    {
      method: 'post',
      path: '/openings/:id/candidates',
      permission: 'hr:recruitment:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Add a candidate',
      schema: { params: id, body: tal.candidateInput },
      handler: (req) => tal.addCandidate(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/candidates/:id/move',
      permission: 'hr:recruitment:update',
      audit: 'UPDATE',
      summary: 'Move a candidate: screen, interview (with rating), offer or reject',
      schema: { params: id, body: tal.moveInput },
      handler: (req) => tal.moveCandidate(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/candidates/:id/hire',
      permission: ['hr:recruitment:update', 'hr:employee:create'],
      audit: 'CREATE',
      summary: 'An offered candidate joins: creates the employee',
      schema: { params: id, body: tal.hireInput },
      handler: (req) => tal.hireCandidate(req.valid.params.id, req.valid.body),
    },
    // ---------------------------------------------------------------- training
    {
      method: 'get',
      path: '/training',
      permission: ['hr:training:read', 'hr:employee:read'],
      audit: null,
      summary: 'Training sessions',
      schema: {
        query: z.object({
          from: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          to: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        }),
      },
      handler: (req) => tal.listTraining(req.valid.query),
    },
    {
      method: 'post',
      path: '/training',
      permission: 'hr:training:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Record a training session with its attendees',
      schema: { body: tal.trainingInput },
      handler: (req) => tal.createTraining(req.valid.body),
    },
    {
      method: 'put',
      path: '/training/:id/attendance',
      permission: 'hr:training:update',
      audit: 'UPDATE',
      summary: 'Mark attendance and scores',
      schema: { params: id, body: tal.attendanceInput },
      handler: (req) => tal.markTraining(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/training/compliance',
      permission: ['hr:training:read', 'hr:employee:read'],
      audit: null,
      summary: 'Mandatory training compliance and gaps',
      handler: () => tal.trainingCompliance(),
    },
    // ---------------------------------------------------------------- appraisal
    {
      method: 'get',
      path: '/appraisal-cycles',
      permission: ['hr:appraisal:read', 'hr:employee:read'],
      audit: null,
      summary: 'Appraisal cycles and progress',
      handler: () => tal.listCycles(),
    },
    {
      method: 'post',
      path: '/appraisal-cycles',
      permission: 'hr:appraisal:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Open an appraisal cycle for every active employee',
      schema: { body: tal.cycleInput },
      handler: (req) => tal.openCycle(req.valid.body),
    },
    {
      method: 'post',
      path: '/appraisal-cycles/:id/close',
      permission: 'hr:appraisal:update',
      audit: 'UPDATE',
      summary: 'Close a cycle once every appraisal is finished',
      schema: { params: id, body: version },
      handler: (req) => tal.closeCycle(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/appraisal-cycles/:id/appraisals',
      permission: ['hr:appraisal:read', 'hr:employee:read'],
      audit: null,
      summary: 'Appraisals in a cycle',
      schema: {
        params: id,
        query: z.object({ status: z.enum(['SELF', 'MANAGER', 'HR', 'DONE']).optional() }),
      },
      handler: (req) => tal.listAppraisals({ cycleId: req.valid.params.id, ...req.valid.query }),
    },
    {
      method: 'post',
      path: '/appraisals/:id/final',
      permission: 'hr:appraisal:update',
      audit: 'APPROVE',
      summary: 'HR’s final rating closes an appraisal',
      schema: { params: id, body: tal.finalInput },
      handler: (req) => tal.finalise(req.valid.params.id, req.valid.body),
    },
    // ---------------------------------------------------------------- exits
    {
      method: 'get',
      path: '/exits',
      permission: 'hr:employee:read',
      audit: null,
      summary: 'Employees on notice or recently exited, with clearances',
      handler: () => tal.listExits(),
    },
    {
      method: 'post',
      path: '/exits/:id/clear',
      permission: 'hr:employee:update',
      audit: 'UPDATE',
      summary: 'Record a department’s exit clearance',
      schema: { params: id, body: tal.clearInput },
      handler: (req) => tal.clearExit(req.valid.params.id, req.valid.body),
    },
  ],
});

/** Self-service appraisal (My Space): own review and the reviews of direct reports. */
export const myTalentRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/me',
  routes: [
    {
      method: 'get',
      path: '/appraisal',
      permission: 'myspace:profile:read',
      audit: null,
      summary: 'My open appraisal and my team’s',
      handler: () => tal.myAppraisal(),
    },
    {
      method: 'post',
      path: '/appraisal/:id/self',
      permission: 'myspace:profile:read',
      audit: 'UPDATE',
      summary: 'Submit my self review',
      schema: { params: id, body: tal.selfInput },
      handler: (req) => tal.submitSelf(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/appraisal/:id/manager',
      permission: 'myspace:profile:read',
      audit: 'UPDATE',
      summary: 'Submit my review of a direct report',
      schema: { params: id, body: tal.managerInput },
      handler: (req) => tal.submitManager(req.valid.params.id, req.valid.body),
    },
  ],
});
