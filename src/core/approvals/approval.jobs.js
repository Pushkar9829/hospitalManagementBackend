import { Tenant } from '../tenancy/tenant.model.js';
import { runAsSystem } from '../tenancy/context.js';
import { expireDueApprovals } from './approval.service.js';

/** Expires overdue approval requests in every open hospital. */
export async function sweepExpiredApprovals(now = new Date()) {
  const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } })
    .select('_id')
    .lean();
  let expired = 0;
  for (const t of tenants)
    expired += await runAsSystem(t._id, () => expireDueApprovals(now), {
      userName: 'system: approval expiry',
    });
  return { expired };
}
