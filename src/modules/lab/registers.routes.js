import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as reg from './services/registers.service.js';

const id = z.object({ id: objectId });
const version = z.object({ version: z.number().int().min(0) });
const READ = [
  'lab:qc:read',
  'lab:sample:read',
  'lab:settings:read',
  'lab:micro:read',
  'lab:histo:read',
];

/** CRUD routes for one register: GET list, POST add, PUT update by id with the version. */
function registerRoutes(path, r, { read, write, summary }) {
  return [
    {
      method: 'get',
      path,
      permission: read,
      audit: null,
      summary: `${summary}: list`,
      handler: () => r.list(),
    },
    {
      method: 'post',
      path,
      permission: write,
      audit: 'CREATE',
      status: 201,
      summary: `${summary}: add`,
      schema: { body: r.input },
      handler: (req) => r.create(req.valid.body),
    },
    {
      method: 'put',
      path: `${path}/:id`,
      permission: write,
      audit: 'UPDATE',
      summary: `${summary}: change`,
      schema: { params: id, body: r.input.partial().merge(version) },
      handler: (req) => r.update(req.valid.params.id, req.valid.body),
    },
  ];
}

/** Lab registers (boards QC, Lab settings, Sample receipt, Microbiology, Histopathology). */
export const labRegisterRoutes = defineRoutes({
  module: 'LAB',
  basePath: '/lab',
  routes: [
    ...registerRoutes('/qc/lots', reg.lots, {
      read: READ,
      write: 'lab:qc:create',
      summary: 'QC lots',
    }),
    ...registerRoutes('/qc/eqas', reg.eqas, {
      read: READ,
      write: 'lab:qc:create',
      summary: 'EQAS cycles',
    }),
    ...registerRoutes('/qc/maintenance', reg.maintenance, {
      read: READ,
      write: 'lab:qc:create',
      summary: 'Calibration and maintenance log',
    }),
    ...registerRoutes('/partners', reg.partners, {
      read: READ,
      write: 'lab:settings:update',
      summary: 'Partner labs',
    }),
    ...registerRoutes('/micro/media', reg.media, {
      read: READ,
      write: ['lab:micro:update', 'lab:qc:create'],
      summary: 'Culture media lots and their QC',
    }),
    {
      method: 'get',
      path: '/send-outs',
      permission: READ,
      audit: null,
      summary: 'Send-out manifests to partner labs',
      handler: () => reg.listSendOuts(),
    },
    {
      method: 'post',
      path: '/send-outs',
      permission: 'lab:sample:receive',
      audit: 'CREATE',
      status: 201,
      summary: 'Send received samples to a partner lab on a manifest',
      schema: { body: reg.sendOutInput },
      handler: (req) => reg.createSendOut(req.valid.body),
    },
    {
      method: 'post',
      path: '/send-outs/:id/received',
      permission: 'lab:sample:receive',
      audit: 'UPDATE',
      summary: "The partner lab's results have come back",
      schema: { params: id, body: version },
      handler: (req) => reg.sendOutResults(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/samples-rejected',
      permission: READ,
      audit: null,
      summary: 'Samples rejected on a day, with the reason',
      schema: {
        query: z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        }),
      },
      handler: (req) => reg.rejections(req.valid.query),
    },
    {
      method: 'get',
      path: '/storage',
      permission: READ,
      audit: null,
      summary: 'Stored samples, those past their keep-until date first',
      handler: () => reg.storage(),
    },
    {
      method: 'post',
      path: '/storage/:sampleNo',
      permission: 'lab:sample:receive',
      audit: 'UPDATE',
      summary: 'Store a tested sample at a rack for some days',
      schema: {
        params: z.object({ sampleNo: z.string().trim().toUpperCase().min(3).max(30) }),
        body: z.object({
          location: z.string().trim().min(2).max(60),
          days: z.number().int().min(1).max(3650),
        }),
      },
      handler: (req) => reg.storeSample(req.valid.params.sampleNo, req.valid.body),
    },
    {
      method: 'post',
      path: '/storage/:sampleNo/discard',
      permission: 'lab:sample:receive',
      audit: 'DELETE',
      summary: 'Discard a stored sample',
      schema: { params: z.object({ sampleNo: z.string().trim().toUpperCase().min(3).max(30) }) },
      handler: (req) => reg.discardSample(req.valid.params.sampleNo),
    },
    {
      method: 'get',
      path: '/histo/stains',
      permission: READ,
      audit: null,
      summary: 'Cases with special stains or IHC',
      handler: () => reg.stains(),
    },
    {
      method: 'get',
      path: '/histo/archive',
      permission: READ,
      audit: null,
      summary: 'Archived blocks and slides with who has them',
      handler: () => reg.archive(),
    },
    {
      method: 'post',
      path: '/histo/archive/:id/issue',
      permission: 'lab:histo:update',
      audit: 'UPDATE',
      summary: 'Issue blocks and slides (second opinion, review)',
      schema: {
        params: id,
        body: z.object({
          to: z.string().trim().min(2).max(120),
          reason: z.string().trim().max(200).optional(),
        }),
      },
      handler: (req) => reg.issueArchive(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/histo/archive/:id/return',
      permission: 'lab:histo:update',
      audit: 'UPDATE',
      summary: 'Blocks and slides back in the archive',
      schema: { params: id },
      handler: (req) => reg.returnArchive(req.valid.params.id),
    },
    {
      method: 'get',
      path: '/histo/turnaround',
      permission: READ,
      audit: null,
      summary: 'Receipt-to-report time by specimen, last 90 days',
      handler: () => reg.turnaround(),
    },
    {
      method: 'get',
      path: '/micro/alerts',
      permission: READ,
      audit: null,
      summary: 'Alert organisms (MRSA, VRE, CRE, ESBL) in the last 30 days',
      handler: () => reg.infectionAlerts(),
    },
  ],
});
