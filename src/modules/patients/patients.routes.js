import { z } from 'zod';
import {
  objectId,
  patientCreateInput,
  patientMergeInput,
  patientSearchQuery,
  patientUpdateInput,
} from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as patients from './services/patients.service.js';

const id = z.object({ id: objectId });

export const patientRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/patients',
  routes: [
    {
      method: 'get',
      path: '/',
      permission: 'patients:patient:read',
      audit: null,
      summary: 'Search patients by UHID, mobile or name',
      schema: { query: patientSearchQuery },
      handler: (req) => patients.searchPatients(req.valid.query),
    },
    {
      method: 'post',
      path: '/',
      permission: 'patients:patient:create',
      audit: 'CREATE',
      status: 201,
      idempotent: 'optional',
      summary: 'Register a patient (quick or full); 409 POSSIBLE_DUPLICATE lists likely matches',
      schema: { body: patientCreateInput },
      handler: (req) => patients.registerPatient(req.valid.body),
    },
    {
      method: 'post',
      path: '/merge',
      permission: 'patients:merge:request',
      audit: 'UPDATE',
      summary: 'Ask to merge two UHIDs (Hospital Admin approves; records move to the survivor)',
      schema: { body: patientMergeInput },
      handler: async (req, res) => {
        const r = await patients.requestMerge(req.valid.body);
        if (r.approvalId) res.locals.status = 202;
        return r;
      },
    },
    {
      method: 'get',
      path: '/:id',
      permission: 'patients:patient:read',
      audit: 'VIEW',
      summary: 'Patient profile (the opening is written to the access log)',
      schema: { params: id },
      handler: (req) => patients.getPatient(req.valid.params.id),
    },
    {
      method: 'put',
      path: '/:id',
      permission: 'patients:patient:update',
      audit: 'UPDATE',
      summary: 'Update a patient (send the version you read)',
      schema: { params: id, body: patientUpdateInput },
      handler: (req) => patients.updatePatient(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/:id/timeline',
      permission: 'patients:patient:read',
      audit: null,
      summary: 'Registration, merges, visits, admissions, bills and reports in date order',
      schema: { params: id },
      handler: (req) => patients.timeline(req.valid.params.id),
    },
  ],
});
