import { z } from 'zod';
import { defineRoutes } from '../../core/http/route.js';
import * as admin from './services/admin.service.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const code = z.object({ code: z.string().regex(/^[A-Z_]{3,40}$/) });

/** Hospital settings: print defaults, message templates, integrations, security, data export. */
export const adminSettingsRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/settings',
  routes: [
    {
      method: 'get',
      path: '/print',
      permission: 'settings:hospital:read',
      audit: null,
      summary: 'Print defaults: paper, letterhead lines, signatory',
      handler: () => admin.getPrint(),
    },
    {
      method: 'put',
      path: '/print',
      permission: 'settings:hospital:update',
      audit: 'UPDATE',
      summary: 'Save print defaults',
      schema: { body: admin.printInput },
      handler: (req) => admin.savePrint(req.valid.body),
    },
    {
      method: 'get',
      path: '/messages',
      permission: 'settings:hospital:read',
      audit: null,
      summary: 'Message templates with the hospital’s wording',
      handler: () => admin.listMessages(),
    },
    {
      method: 'put',
      path: '/messages/:code',
      permission: 'settings:hospital:update',
      audit: 'UPDATE',
      summary: 'Reword a message (placeholders unchanged) or turn it off',
      schema: { params: code, body: admin.messageInput },
      handler: (req) => admin.saveMessage(req.valid.params.code, req.valid.body),
    },
    {
      method: 'post',
      path: '/messages/:code/reset',
      permission: 'settings:hospital:update',
      audit: 'UPDATE',
      summary: 'Go back to the standard wording',
      schema: { params: code, body: z.object({ version: z.number().int().min(0) }) },
      handler: (req) => admin.resetMessage(req.valid.params.code, req.valid.body),
    },
    {
      method: 'get',
      path: '/integrations',
      permission: 'settings:hospital:read',
      audit: null,
      summary: 'Outside services and whether each is set up',
      handler: () => admin.getIntegrations(),
    },
    {
      method: 'put',
      path: '/integrations',
      permission: 'settings:hospital:update',
      audit: 'UPDATE',
      summary: 'Save one integration’s settings (no secrets)',
      schema: { body: admin.integrationInput },
      handler: (req) => admin.saveIntegration(req.valid.body),
    },
    {
      method: 'get',
      path: '/security',
      permission: 'settings:security:read',
      audit: null,
      summary: 'Two-factor roles, idle sign-out and password rules',
      handler: () => admin.getSecurity(),
    },
    {
      method: 'put',
      path: '/security',
      permission: 'settings:security:update',
      audit: 'UPDATE',
      summary: 'Change who must use two-factor sign-in and the idle sign-out',
      schema: { body: admin.securityInput },
      handler: (req) => admin.saveSecurity(req.valid.body),
    },
    {
      method: 'get',
      path: '/export/:dataset',
      permission: 'settings:export:run',
      audit: 'EXPORT',
      summary: 'Download the hospital’s data as CSV',
      schema: {
        params: z.object({ dataset: z.enum(admin.DATASETS) }),
        query: z.object({ from: ymd.optional(), to: ymd.optional() }),
      },
      handler: (req) => admin.exportData({ ...req.valid.params, ...req.valid.query }),
    },
  ],
});
