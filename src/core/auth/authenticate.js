import { current } from '../tenancy/context.js';
import { AppError } from '../errors/index.js';
import { permissionCache } from '../rbac/permission.cache.js';
import { ACCESS_COOKIE, tokenBlacklist, verifyAccessToken } from './tokens.js';
import { idle, idleMinutes } from './idle.js';

const OBJECT_ID = /^[a-f\d]{24}$/i;
/** Routes a user who still has to enrol in two-factor sign-in may call. */
const ENROLMENT_ROUTES = new Set([
  '/auth/me',
  '/auth/logout',
  '/auth/2fa/setup',
  '/auth/2fa/enable',
]);
/** Routes a user who must change their password (after an admin reset) may call. */
const PASSWORD_ROUTES = new Set(['/auth/me', '/auth/logout', '/auth/password']);

/** True when one of the user's roles must use two-factor sign-in and it is not set up yet. */
export function mustEnrolTwoFactor(access, tenant) {
  const required = new Set(tenant.settings?.twoFactorRoles ?? []);
  return !access.twoFactorEnabled && access.roles.some((r) => required.has(r.code));
}

/**
 * Verifies the access token (cookie for the web app, Bearer for integrations), loads the user's
 * permissions and resolves the working branch from `x-branch-id`.
 */
export async function authenticate(req, _res, next) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const token = req.cookies?.[ACCESS_COOKIE] ?? bearer;
  if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in'));
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    return next(
      new AppError(401, 'TOKEN_INVALID', 'Your session has expired. Please sign in again.'),
    );
  }
  const c = current();
  if (claims.tid !== c.tenantId || (await tokenBlacklist.has(claims.jti))) {
    return next(
      new AppError(401, 'TOKEN_INVALID', 'Your session has expired. Please sign in again.'),
    );
  }
  const access = await permissionCache.forUser(c.tenantId, claims.sub);
  if (!access || access.status !== 'ACTIVE') {
    return next(new AppError(401, 'TOKEN_INVALID', 'Your account is not active'));
  }
  if (access.mustChangePassword && !PASSWORD_ROUTES.has(req.path)) {
    return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password to continue'));
  }
  if (mustEnrolTwoFactor(access, c.tenant) && !ENROLMENT_ROUTES.has(req.path)) {
    return next(
      new AppError(403, 'TWO_FACTOR_SETUP_REQUIRED', 'Set up two-factor sign-in to continue'),
    );
  }
  const wanted = req.headers['x-branch-id'];
  const allBranches = access.permissions.includes('*');
  let branchId = access.defaultBranchId ?? access.branchIds[0] ?? null;
  if (typeof wanted === 'string' && wanted) {
    if (!OBJECT_ID.test(wanted) || (!allBranches && !access.branchIds.includes(wanted))) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have access to this branch'));
    }
    branchId = wanted;
  }
  // Activity keeps the session alive; background polling (x-background: 1) does not.
  if (req.headers['x-background'] !== '1')
    await idle.touch(c.tenantId, claims.sid, idleMinutes(c.tenant));
  Object.assign(c, {
    userId: claims.sub,
    userName: access.name,
    familyId: claims.sid,
    jti: claims.jti,
    tokenExp: claims.exp,
    permissions: new Set(access.permissions),
    roles: access.roles,
    scope: access.scope,
    departmentIds: access.departmentIds,
    branchId,
    branchIds: access.branchIds,
  });
  next();
}
