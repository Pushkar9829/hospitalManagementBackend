import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context: tenant, user, branch, permissions, subscribed modules, request id.
 * Everything that touches tenant data reads it from here, so tenant isolation does not depend
 * on each developer remembering to pass the tenant around.
 */
const storage = new AsyncLocalStorage();

export function current() {
  const c = storage.getStore();
  if (!c)
    throw new Error('No request context. Call inside a request, runAsSystem() or runInContext().');
  return c;
}

export const maybeCurrent = () => storage.getStore();

export function runInContext(ctx, fn) {
  return storage.run({ permissions: new Set(), modules: new Set(), ...ctx }, fn);
}

/** For jobs, event handlers and scripts: full rights inside one tenant. */
export function runAsSystem(tenantId, fn, extra = {}) {
  return runInContext(
    {
      tenantId: String(tenantId),
      userId: null,
      system: true,
      permissions: new Set(['*']),
      requestId: `system-${Date.now()}`,
      ...extra,
    },
    fn,
  );
}
