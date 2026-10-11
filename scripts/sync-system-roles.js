/**
 * Release step: refreshes system roles and seeds missing approval rules in every hospital, so a
 * hospital created before a release gets the new permissions. Custom roles are left alone.
 * Usage: node --env-file=.env scripts/sync-system-roles.js
 */
import { connectDb, disconnectDb } from '../src/core/db/connection.js';
import '../src/modules/index.js'; // registers module seeders
import { closeRedis, redis } from '../src/core/cache/redis.js';
import { runAsSystem } from '../src/core/tenancy/context.js';
import { Tenant } from '../src/core/tenancy/tenant.model.js';
import { runTenantSeeders, syncSystemRoles } from '../src/core/tenancy/provision.js';
import { seedApprovalRules } from '../src/core/approvals/approval.service.js';
import { permissionCache } from '../src/core/rbac/permission.cache.js';

await connectDb();
await redis().ping();
const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } })
  .select('_id name')
  .lean();
for (const t of tenants) {
  await runAsSystem(t._id, async () => {
    await syncSystemRoles();
    await seedApprovalRules();
    await runTenantSeeders({ tenant: t });
  });
  await permissionCache.invalidateTenant(String(t._id));
  console.log(`synced ${t.name}`);
}
await disconnectDb();
await closeRedis();
