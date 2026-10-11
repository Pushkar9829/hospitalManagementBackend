import { hasPermission } from '@hms/shared';
import { current } from '../tenancy/context.js';
import { AppError } from '../errors/index.js';
import { recordAudit } from '../audit/audit.service.js';

/** 402 when the hospital has not subscribed to the module. CORE is always on. */
export const requireModule = (code) => (_req, _res, next) =>
  code === 'CORE' || current().modules.has(code)
    ? next()
    : next(
        new AppError(
          402,
          'MODULE_NOT_SUBSCRIBED',
          `The ${code} module is not part of your subscription`,
        ),
      );

/** 403 unless the user holds at least one of the permission keys. Denials are audited. */
export const authorize =
  (...keys) =>
  async (req, _res, next) => {
    const c = current();
    if (keys.some((k) => hasPermission(c.permissions, k))) return next();
    await recordAudit({
      action: 'ACCESS_DENIED',
      entity: 'Route',
      entityId: `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`,
      summary: `Missing ${keys.join(' or ')}`,
    });
    next(new AppError(403, 'FORBIDDEN', `You need the permission ${keys.join(' or ')}`));
  };

/** For service code: throws 403 when the current user lacks the permission. */
export function assertPermission(key) {
  if (!hasPermission(current().permissions, key))
    throw new AppError(403, 'FORBIDDEN', `You need the permission ${key}`);
}
