import { z } from 'zod';
import {
  changePasswordBody,
  forgotPasswordBody,
  resetPasswordBody,
  loginBody,
  otpRequestBody,
  otpVerifyBody,
  switchBranchBody,
  twoFactorEnableBody,
  twoFactorVerifyBody,
} from '@hms/shared/schemas';
import { defineRoutes } from '../http/route.js';
import { current } from '../tenancy/context.js';
import { AppError } from '../errors/index.js';
import { ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './tokens.js';
import { permissionCache } from '../rbac/permission.cache.js';
import * as auth from './auth.service.js';

const meta = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/** Sets cookies and answers with the session, or with a two-factor challenge. */
async function finish(res, result) {
  if (result.challenge) return result.challenge;
  setAuthCookies(res, result.tokens ?? result);
  return auth.sessionPayload(result.tokens?.userId ?? result.userId);
}

/** Sign-in endpoints: mounted before `authenticate`, behind the login rate limit. */
export const authPublicRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/auth',
  routes: [
    {
      method: 'post',
      path: '/login',
      permission: 'public',
      audit: 'LOGIN',
      summary: 'Sign in with username (or mobile) and password',
      schema: { body: loginBody },
      handler: async (req, res) =>
        finish(res, await auth.loginWithPassword(req.valid.body, meta(req))),
    },
    {
      method: 'post',
      path: '/2fa/verify',
      permission: 'public',
      audit: 'LOGIN',
      summary: 'Complete sign-in with the authenticator app code',
      schema: { body: twoFactorVerifyBody },
      handler: async (req, res) =>
        finish(res, await auth.verifyTwoFactor(req.valid.body, meta(req))),
    },
    {
      method: 'post',
      path: '/otp/request',
      permission: 'public',
      audit: null,
      status: 202,
      summary: 'Send a sign-in code by SMS (always answers 202)',
      schema: { body: otpRequestBody },
      handler: (req) => auth.requestLoginOtp(req.valid.body),
    },
    {
      method: 'post',
      path: '/otp/verify',
      permission: 'public',
      audit: 'LOGIN',
      summary: 'Sign in with the SMS code',
      schema: { body: otpVerifyBody },
      handler: async (req, res) =>
        finish(res, await auth.verifyLoginOtp(req.valid.body, meta(req))),
    },
    {
      method: 'post',
      path: '/password/forgot',
      permission: 'public',
      audit: null,
      status: 202,
      summary: 'Send a password reset code to the registered mobile (always answers 202)',
      schema: { body: forgotPasswordBody },
      handler: (req) => auth.requestPasswordReset(req.valid.body),
    },
    {
      method: 'post',
      path: '/password/reset',
      permission: 'public',
      audit: 'PASSWORD_CHANGED',
      summary:
        'Set a new password with the SMS code; unlocks the account and signs out every device',
      schema: { body: resetPasswordBody },
      handler: (req) => auth.resetPassword(req.valid.body),
    },
    {
      method: 'post',
      path: '/refresh',
      permission: 'public',
      audit: null,
      noBody: true,
      summary: 'Rotate the refresh token and issue a new access token',
      handler: async (req, res) => {
        try {
          setAuthCookies(res, await auth.refreshSession(req.cookies?.[REFRESH_COOKIE], meta(req)));
        } catch (err) {
          clearAuthCookies(res);
          throw err;
        }
        return { ok: true };
      },
    },
    {
      method: 'post',
      path: '/logout',
      permission: 'public',
      audit: 'LOGOUT',
      noBody: true,
      summary: 'Sign out this device',
      handler: async (req, res) => {
        const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
        await auth.logout({
          refreshToken: req.cookies?.[REFRESH_COOKIE],
          accessToken: req.cookies?.[ACCESS_COOKIE] ?? bearer,
        });
        clearAuthCookies(res);
      },
    },
  ],
});

/** Endpoints for a signed-in user. */
export const authRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/auth',
  routes: [
    {
      method: 'get',
      path: '/me',
      permission: 'authenticated',
      audit: null,
      summary: 'The signed-in user, hospital, branches, roles and permissions',
      handler: () => auth.sessionPayload(),
    },
    {
      method: 'post',
      path: '/branch',
      permission: 'authenticated',
      audit: null,
      summary:
        'Check access to a branch and return the session for it (send it as x-branch-id afterwards)',
      schema: { body: switchBranchBody },
      handler: async (req) => {
        const c = current();
        const { branchId } = req.valid.body;
        if (!c.permissions.has('*') && !c.branchIds.includes(branchId))
          throw new AppError(403, 'FORBIDDEN', 'You do not have access to this branch');
        c.branchId = branchId;
        const session = await auth.sessionPayload();
        if (!session.branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
        return session;
      },
    },
    {
      method: 'post',
      path: '/password',
      permission: 'authenticated',
      audit: 'PASSWORD_CHANGED',
      summary: 'Change password (signs out other devices)',
      schema: { body: changePasswordBody },
      handler: (req) => auth.changePassword(req.valid.body),
    },
    {
      method: 'post',
      path: '/2fa/setup',
      permission: 'authenticated',
      audit: null,
      noBody: true,
      summary: 'Start authenticator app setup; returns the secret and otpauth URL',
      schema: { response: z.object({ secret: z.string(), otpauthUrl: z.string() }) },
      handler: () => auth.beginTwoFactorSetup(),
    },
    {
      method: 'post',
      path: '/2fa/enable',
      permission: 'authenticated',
      audit: 'TWO_FACTOR_ENABLED',
      summary: 'Confirm the first authenticator code and turn on two-factor sign-in',
      schema: { body: twoFactorEnableBody },
      handler: async (req) => {
        const r = await auth.enableTwoFactor(req.valid.body);
        await permissionCache.invalidate(current().tenantId, current().userId);
        return r;
      },
    },
  ],
});
