import { Router } from 'express';
import { isModuleCode, isPermissionKey } from '@hms/shared';
import { authorize, requireModule } from '../rbac/guards.js';
import { idempotency } from '../security/idempotency.js';
import { validate } from './validate.js';
import { routeRegistry } from './openapi.js';
import { AUDIT_ACTIONS } from '../audit/audit.model.js';

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/**
 * The only way to add API routes. Each route must declare (PLAN section 6):
 *   module      subscription module, e.g. 'OPD' (402 when not subscribed)
 *   permission  key or keys, any of which allows the call (403 otherwise),
 *               'authenticated' for any signed-in user, or 'public' (mounted before sign-in)
 *   schema      Zod schemas for params / query / body (422 on failure) and response (docs)
 *   audit       the audit action this route performs, or null for reads
 *   summary     one line for the API docs
 * Optional: idempotent ('required' | 'optional') for money and stock writes; status (default 200).
 * `mount` is where the router is mounted (default /api/v1); it picks the OpenAPI document.
 * A route missing any of these fails at startup, and the contract test fails CI.
 */
export function defineRoutes({ module, basePath = '', mount = '/api/v1', routes }) {
  if (!isModuleCode(module)) throw new Error(`defineRoutes: unknown module ${module}`);
  const router = Router();
  for (const r of routes) {
    const where = `${module} ${r.method?.toUpperCase()} ${basePath}${r.path}`;
    if (!METHODS.has(r.method)) throw new Error(`${where}: method must be one of ${[...METHODS]}`);
    if (!r.summary) throw new Error(`${where}: summary is required`);
    const perms = [].concat(r.permission ?? []);
    if (
      !perms.length ||
      !perms.every((p) => p === 'authenticated' || p === 'public' || isPermissionKey(p))
    ) {
      throw new Error(`${where}: permission must be a valid key, 'authenticated' or 'public'`);
    }
    if (!('audit' in r) || (r.audit !== null && !AUDIT_ACTIONS.includes(r.audit))) {
      throw new Error(`${where}: audit must be an audit action or null`);
    }
    if (r.method !== 'get' && !r.schema?.body && !r.schema?.params && !r.noBody) {
      throw new Error(`${where}: writes need a body or params schema (or noBody: true)`);
    }
    if (typeof r.handler !== 'function') throw new Error(`${where}: handler is required`);

    const chain = [requireModule(module)];
    if (!perms.includes('authenticated') && !perms.includes('public'))
      chain.push(authorize(...perms));
    chain.push(validate(r.schema));
    if (r.idempotent) chain.push(idempotency({ required: r.idempotent === 'required' }));
    chain.push(async (req, res) => {
      const result = await r.handler(req, res);
      if (res.headersSent) return;
      // A handler may set res.locals.status, e.g. 202 when a change waits for approval.
      const status = res.locals.status ?? r.status;
      if (result === undefined) return res.status(status ?? 204).end();
      res.status(status ?? 200).json(result);
    });
    router[r.method](`${basePath}${r.path}`, ...chain);
    routeRegistry.push({
      ...r,
      module,
      permission: perms,
      schema: r.schema ?? {},
      fullPath: `${basePath}${r.path}`,
      mount,
    });
  }
  return router;
}
