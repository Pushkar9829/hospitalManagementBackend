import { z } from 'zod';
import { permissionCatalog } from '@hms/shared';
import {
  inviteAcceptBody,
  objectId,
  pageQuery,
  passwordPolicy,
  roleInput,
  userCreateInput,
  userUpdateInput,
} from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as users from './services/users.service.js';
import * as roles from './services/roles.service.js';

const id = z.object({ id: objectId });
const version = z.object({ version: z.number().int().min(0) });
const accepted = (res, result) => {
  if (result.approvalId) res.locals.status = 202;
  return result;
};

export const userRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/users',
  routes: [
    {
      method: 'get',
      path: '/',
      permission: 'settings:user:read',
      audit: null,
      summary: 'Staff logins, filterable by name, status, role, branch and department',
      schema: {
        query: pageQuery.extend({
          q: z.string().trim().max(60).optional(),
          status: z
            .enum(['PENDING_APPROVAL', 'ACTIVE', 'INVITED', 'LOCKED', 'DISABLED'])
            .optional(),
          role: z.string().max(40).optional(),
          branchId: objectId.optional(),
          departmentId: objectId.optional(),
        }),
      },
      handler: (req) => users.listUsers(req.valid.query),
    },
    {
      method: 'get',
      path: '/:id',
      permission: 'settings:user:read',
      audit: null,
      summary: 'One login',
      schema: { params: id },
      handler: (req) => users.getUser(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/',
      permission: 'settings:user:create',
      audit: 'CREATE',
      status: 201,
      summary:
        'Create a login (invitation by SMS or temporary password); privileged roles need approval (202)',
      schema: { body: userCreateInput },
      handler: async (req, res) => accepted(res, await users.createUser(req.valid.body)),
    },
    {
      method: 'put',
      path: '/:id',
      permission: 'settings:user:update',
      audit: 'UPDATE',
      summary: 'Update a login; adding a privileged role needs approval (202)',
      schema: { params: id, body: userUpdateInput },
      handler: async (req, res) =>
        accepted(res, await users.updateUser(req.valid.params.id, req.valid.body)),
    },
    {
      method: 'post',
      path: '/:id/deactivate',
      permission: 'settings:user:update',
      audit: 'UPDATE',
      summary:
        'Deactivate a login and sign it out everywhere (the last Super Admin cannot be deactivated)',
      schema: { params: id, body: version.extend({ reason: z.string().trim().min(3).max(500) }) },
      handler: (req) => users.deactivateUser(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/activate',
      permission: 'settings:user:update',
      audit: 'UPDATE',
      summary: 'Activate a deactivated login (within the user limit)',
      schema: { params: id, body: version },
      handler: (req) => users.activateUser(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/unlock',
      permission: 'settings:user:update',
      audit: 'UPDATE',
      noBody: true,
      summary: 'Unlock a login locked after wrong passwords',
      schema: { params: id },
      handler: (req) => users.unlockUser(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/:id/reset-password',
      permission: 'settings:user:update',
      audit: 'PASSWORD_CHANGED',
      summary: 'Set a temporary password the user must change at the next sign-in',
      schema: { params: id, body: z.object({ temporaryPassword: passwordPolicy }) },
      handler: (req) => users.resetUserPassword(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/resend-invite',
      permission: 'settings:user:update',
      audit: 'UPDATE',
      summary: 'Send a new invitation link',
      schema: { params: id },
      handler: (req) => users.resendInvite(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/:id/sign-out',
      permission: 'settings:user:update',
      audit: 'LOGOUT',
      summary: 'Sign the user out on every device',
      schema: { params: id },
      handler: (req) => users.revokeSessions(req.valid.params.id),
    },
  ],
});

export const roleRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/roles',
  routes: [
    {
      method: 'get',
      path: '/',
      permission: 'settings:role:read',
      audit: null,
      summary: 'System and custom roles with permissions, data scope and number of users',
      handler: () => roles.listRoles(),
    },
    {
      method: 'get',
      path: '/permissions',
      permission: 'settings:role:read',
      audit: null,
      summary: 'Every permission key grouped by module, for the role editor',
      handler: () => permissionCatalog(),
    },
    {
      method: 'post',
      path: '/',
      permission: 'settings:role:create',
      audit: 'CREATE',
      status: 201,
      summary:
        'Create a custom role from a system role; permissions apply after Super Admin approval (202)',
      schema: { body: roleInput },
      handler: async (req, res) => accepted(res, await roles.createRole(req.valid.body)),
    },
    {
      method: 'put',
      path: '/:id',
      permission: 'settings:role:update',
      audit: 'UPDATE',
      summary: 'Edit a custom role; permission changes need approval (202)',
      schema: {
        params: id,
        body: roleInput.omit({ code: true, clonedFrom: true }).extend(version.shape),
      },
      handler: async (req, res) =>
        accepted(res, await roles.updateRole(req.valid.params.id, req.valid.body)),
    },
    {
      method: 'post',
      path: '/:id/deactivate',
      permission: 'settings:role:update',
      audit: 'UPDATE',
      summary: 'Deactivate a custom role nobody holds',
      schema: { params: id, body: version },
      handler: (req) => roles.deactivateRole(req.valid.params.id, req.valid.body),
    },
  ],
});

/** Invitation links work before sign-in. */
export const invitePublicRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/auth/invite',
  routes: [
    {
      method: 'get',
      path: '/:token',
      permission: 'public',
      audit: null,
      summary: 'Who an invitation is for (name, username, hospital)',
      schema: { params: z.object({ token: z.string().min(20).max(200) }) },
      handler: (req) => users.inviteInfo(req.valid.params.token),
    },
    {
      method: 'post',
      path: '/accept',
      permission: 'public',
      audit: 'PASSWORD_CHANGED',
      summary: 'Set the first password from an invitation',
      schema: { body: inviteAcceptBody },
      handler: (req) => users.acceptInvite(req.valid.body),
    },
  ],
});
