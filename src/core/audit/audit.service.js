import { AuditLog } from './audit.model.js';
import { maybeCurrent } from '../tenancy/context.js';

const SENSITIVE = /password|secret|token|otp|pin$/i;

/** Removes secrets and keeps values small enough to store and show. */
export function sanitise(value, depth = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date || value?._bsontype) return value;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitise(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '__v' || k === 'tenantId') continue;
    out[k] = SENSITIVE.test(k) ? '[redacted]' : sanitise(v, depth + 1);
  }
  return out;
}

/**
 * Records one audit entry in the current request context (joins the open transaction).
 * Pass `tenantId` explicitly only for events before a user is known (failed logins).
 */
export async function recordAudit({
  action,
  entity,
  entityId,
  summary,
  before,
  after,
  userId,
  userName,
  tenantId,
}) {
  const c = maybeCurrent();
  if (!c?.tenantId && !tenantId) return null;
  const [entry] = await AuditLog.create([
    {
      tenantId: tenantId ?? c.tenantId,
      action,
      entity,
      entityId: entityId != null ? String(entityId) : undefined,
      summary,
      userId: userId ?? c?.userId ?? undefined,
      userName: userName ?? c?.userName,
      branchId: c?.branchId || undefined,
      requestId: c?.requestId,
      ip: c?.ip,
      before: sanitise(before),
      after: sanitise(after),
    },
  ]);
  return entry;
}
