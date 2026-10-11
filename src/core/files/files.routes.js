import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../http/route.js';
import { completeUpload, createUpload, downloadUrl } from './files.service.js';
import { localFileHandlers } from './storage.js';

export const fileRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/files',
  routes: [
    {
      method: 'post',
      path: '/upload-url',
      permission: 'authenticated',
      audit: 'CREATE',
      status: 201,
      summary:
        'Start an upload: checks type, size and permission for the purpose; returns a 5-minute PUT URL',
      schema: {
        body: z.object({
          purpose: z.string().regex(/^[a-z-]{3,40}$/),
          name: z.string().trim().min(1).max(200),
          mime: z.string().max(100),
          size: z.number().int().min(1),
          ownerEntity: z.string().max(40).optional(),
          ownerId: z.string().max(40).optional(),
        }),
      },
      handler: (req) => createUpload(req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/complete',
      permission: 'authenticated',
      audit: 'UPDATE',
      summary: 'Confirm the upload finished',
      schema: { params: z.object({ id: objectId }) },
      handler: (req) => completeUpload(req.valid.params.id),
    },
    {
      method: 'get',
      path: '/:id/download-url',
      permission: 'authenticated',
      audit: 'EXPORT',
      summary: 'A 5-minute download link (audited)',
      schema: { params: z.object({ id: objectId }) },
      handler: (req) => downloadUrl(req.valid.params.id),
    },
  ],
});

/** Local storage endpoints (development/tests). The signed token is the authorisation. */
export function localStorageRouter() {
  const r = Router();
  r.put('/api/files/local/:token', localFileHandlers.put);
  r.get('/api/files/local/:token', localFileHandlers.get);
  return r;
}
