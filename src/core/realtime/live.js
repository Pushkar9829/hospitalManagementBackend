import { current } from '../tenancy/context.js';
import { emit } from './socket.js';

/**
 * Wraps a module's routes so every successful write tells the branch's live screens to refetch
 * (`event` on the branch room). Reads are left alone. The payload is only a hint: clients
 * refetch through the API, so nothing private travels over the socket.
 */
export function withLiveUpdates(routes, event) {
  return routes.map((r) =>
    r.method === 'get'
      ? r
      : {
          ...r,
          handler: async (req, res) => {
            const out = await r.handler(req, res);
            const c = current();
            emit(c.tenantId, event, { at: Date.now() }, { branchId: c.branchId ?? undefined });
            return out;
          },
        },
  );
}
