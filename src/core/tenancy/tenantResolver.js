import { current, runInContext } from './context.js';
import { tenantRegistry } from './tenant.registry.js';
import { AppError } from '../errors/index.js';

const READ_ONLY_OK = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Host (or X-Hms-Host) -> tenant; enforces subscription state (spec 2.4) and opens the request context.
 * TRIAL, ACTIVE and PAST_DUE work normally; READ_ONLY allows reads; SUSPENDED allows sign-in
 * and the subscription screen only; CLOSED answers as if the hospital did not exist.
 */
export async function tenantResolver(req, _res, next) {
  const tenant = await tenantRegistry.resolve(req.headers, req.hostname ?? '');
  if (!tenant) return next(new AppError(404, 'TENANT_NOT_FOUND', 'Unknown hospital address'));
  const isAuthCall = req.path.startsWith('/auth/');
  if (tenant.status === 'CLOSED')
    return next(new AppError(404, 'TENANT_NOT_FOUND', 'Unknown hospital address'));
  // Suspended: staff can still sign in, and the Super Admin can pay to reactivate.
  if (tenant.status === 'SUSPENDED' && !isAuthCall && !req.path.startsWith('/subscription')) {
    return next(new AppError(402, 'TENANT_SUSPENDED', 'This hospital’s subscription is suspended'));
  }
  if (
    tenant.status === 'READ_ONLY' &&
    !READ_ONLY_OK.has(req.method) &&
    !isAuthCall &&
    !req.path.startsWith('/subscription')
  ) {
    return next(
      new AppError(
        402,
        'TENANT_READ_ONLY',
        'Read-only mode: new records are paused until the subscription is renewed',
      ),
    );
  }
  req.tenant = tenant;
  runInContext(
    {
      tenantId: tenant.id,
      tenant,
      modules: new Set(tenant.modules),
      requestId: req.id,
      ip: req.ip,
    },
    () => {
      // The request logger writes after the response, outside this context; keep a handle.
      req.ctx = current();
      next();
    },
  );
}
