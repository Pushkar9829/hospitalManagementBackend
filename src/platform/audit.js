import { recordAudit } from '../core/audit/audit.service.js';
import { runAsSystem } from '../core/tenancy/context.js';

/**
 * Writes a platform action into the hospital's own audit log, so the hospital sees what the
 * platform did (spec 3.2). Platform code runs without a tenant, so the entry opens one.
 */
export function platformAudit(tenantId, { userName, ...entry }) {
  return runAsSystem(tenantId, () => recordAudit({ ...entry, userName }), { userName });
}
