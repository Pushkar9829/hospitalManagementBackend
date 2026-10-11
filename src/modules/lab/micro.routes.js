import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import * as micro from './services/micro.service.js';

const id = z.object({ id: objectId });
const text = (max = 300) => z.string().trim().max(max);
const list = z.object({
  status: text(120).optional(),
  q: text(80).optional(),
  open: z.coerce.boolean().default(true),
});

/** Microbiology (board LabMicro) and histopathology (board LabHisto). */
export const microRoutes = defineRoutes({
  module: 'LAB',
  basePath: '/lab',
  routes: withLiveUpdates(
    [
      {
        method: 'get',
        path: '/cultures',
        permission: ['lab:micro:read', 'lab:micro:update'],
        audit: null,
        summary: 'Cultures on the bench (open by default)',
        schema: { query: list },
        handler: (req) => micro.listCultures(req.valid.query),
      },
      {
        method: 'get',
        path: '/cultures/antibiogram',
        permission: ['lab:micro:read', 'reports:lab:read'],
        audit: null,
        summary: 'Antibiogram: % susceptible by organism and antibiotic',
        schema: { query: z.object({ days: z.coerce.number().int().min(7).max(730).default(180) }) },
        handler: (req) => micro.antibiogram(req.valid.query),
      },
      {
        method: 'get',
        path: '/cultures/:id',
        permission: ['lab:micro:read', 'lab:micro:update'],
        audit: 'VIEW',
        summary: 'One culture with readings and sensitivity',
        schema: { params: id },
        handler: (req) => micro.getCulture(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/cultures/:id/plate',
        permission: 'lab:micro:update',
        audit: 'UPDATE',
        summary: 'Plate the sample on media',
        schema: { params: id, body: z.object({ media: z.array(text(40).min(2)).min(1).max(8) }) },
        handler: (req) => micro.plate(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/cultures/:id/readings',
        permission: 'lab:micro:update',
        audit: 'UPDATE',
        summary: 'Plate reading: growth at 24 h sends a preliminary report',
        schema: { params: id, body: z.object({ growth: z.boolean(), text: text(500).min(2) }) },
        handler: (req) => micro.addReading(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/cultures/:id/identify',
        permission: 'lab:micro:update',
        audit: 'UPDATE',
        summary: 'Organism identified, with colony count',
        schema: {
          params: id,
          body: z.object({ organism: text(120).min(2), colonyCount: text(60).optional() }),
        },
        handler: (req) => micro.identify(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/cultures/:id/sensitivity',
        permission: 'lab:micro:update',
        audit: 'UPDATE',
        summary: 'Antibiotic sensitivity (S, I, R)',
        schema: { params: id, body: micro.sensitivityInput },
        handler: (req) => micro.setSensitivity(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/cultures/:id/final',
        permission: 'lab:micro:update',
        audit: 'UPDATE',
        summary: 'Final culture report onto the test, for the pathologist’s release',
        schema: { params: id },
        noBody: true,
        handler: (req) => micro.finalizeCulture(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/histo/cases',
        permission: ['lab:histo:read', 'lab:histo:update'],
        audit: null,
        summary: 'Histopathology cases (open by default)',
        schema: { query: list },
        handler: (req) => micro.listCases(req.valid.query),
      },
      {
        method: 'get',
        path: '/histo/cases/:id',
        permission: ['lab:histo:read', 'lab:histo:update'],
        audit: 'VIEW',
        summary: 'One histopathology case',
        schema: { params: id },
        handler: (req) => micro.getCase(req.valid.params.id),
      },
      {
        method: 'put',
        path: '/histo/cases/:id',
        permission: 'lab:histo:update',
        audit: 'UPDATE',
        summary: 'Save grossing, processing, slides and microscopy; advance a step',
        schema: { params: id, body: micro.caseInput },
        handler: (req) => micro.updateCase(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/histo/cases/:id/report',
        permission: 'lab:histo:update',
        audit: 'UPDATE',
        summary: 'Sign out the diagnosis onto the test, for release',
        schema: { params: id },
        noBody: true,
        handler: (req) => micro.reportCase(req.valid.params.id),
      },
    ],
    'lab:update',
  ),
});
