import { MAX_SESSIONS, systemRolePermissions } from '@hms/shared';
import { PANELS } from '@hms/shared/catalog';
import { runAsSystem } from './context.js';
import { Tenant } from './tenant.model.js';
import { Branch } from './branch.model.js';
import { Role } from '../auth/models/role.model.js';
import { User } from '../auth/models/user.model.js';
import { hashPassword } from '../auth/password.js';
import { randomToken, sha256 } from '../security/crypto.js';
import { withTransaction } from '../db/model.js';
import { seedApprovalRules } from '../approvals/approval.service.js';

/** Module seeders run inside the provisioning transaction (default masters, numbering, ...). */
const seeders = [];
export function registerTenantSeeder(name, seed) {
  if (!seeders.some((s) => s.name === name)) seeders.push({ name, seed });
}

/** Runs every module seeder for the current hospital; seeders must be idempotent. */
export async function runTenantSeeders(ctx) {
  for (const s of seeders) await s.seed(ctx);
}

const scopeOf = (code, panel) => (code === 'superadmin' || panel.readOnly ? 'all' : 'branch');

/**
 * Creates or updates the system roles of the current hospital from the product defaults
 * (role panels + ROLE_GRANTS). Custom roles are never touched. Safe to run on every release.
 */
export async function syncSystemRoles() {
  const roles = [];
  for (const [code, panel] of Object.entries(PANELS)) {
    const fields = {
      name: panel.name,
      panel: code,
      permissions: code === 'superadmin' ? ['*'] : systemRolePermissions(code),
      scope: scopeOf(code, panel),
      maxSessions: MAX_SESSIONS[code],
      isSystem: true,
      // System roles cannot be deactivated; this also backfills roles stored before `status`.
      status: 'ACTIVE',
      isActive: true,
    };
    let role = await Role.findOne({ code });
    if (!role) [role] = await Role.create([{ code, ...fields }]);
    else if (role.isSystem) {
      role.set(fields);
      if (role.isModified()) await role.save();
    }
    roles.push(role);
  }
  return roles;
}

/**
 * Creates a hospital with its first branch, the system roles, the maker-checker rules and a
 * Super Admin. Used by self-service signup, the platform console and tests.
 * All or nothing: a failure part-way never leaves a hospital without roles or an admin.
 */
export async function provisionTenant({
  name,
  subdomain,
  modules = [],
  status = 'ACTIVE',
  settings = {},
  branch = { name: 'Main Branch', code: 'MAIN' },
  admin,
}) {
  const passwordHash = admin?.password ? await hashPassword(admin.password) : undefined;
  // Self-service signup: no password yet; the first Super Admin sets it from a one-time link.
  const inviteToken = admin && !admin.password ? randomToken(32) : undefined;
  return withTransaction(async () => {
    const [tenant] = await Tenant.create([
      { name, subdomain, status, modules: modules.map((code) => ({ code })), settings },
    ]);
    return runAsSystem(tenant._id, async () => {
      const [mainBranch] = await Branch.create([branch]);
      const roles = await syncSystemRoles();
      await seedApprovalRules();
      await runTenantSeeders({ tenant, branch: mainBranch });
      let superAdmin = null;
      if (admin) {
        [superAdmin] = await User.create([
          {
            name: admin.name,
            username: admin.username,
            mobile: admin.mobile,
            email: admin.email,
            designation: 'Super Admin',
            passwordHash,
            ...(inviteToken
              ? {
                  status: 'INVITED',
                  invite: {
                    tokenHash: sha256(inviteToken),
                    expiresAt: new Date(Date.now() + 72 * 3_600_000),
                    sentAt: new Date(),
                  },
                }
              : {}),
            roles: [roles.find((r) => r.code === 'superadmin')._id],
            branchIds: [mainBranch._id],
            defaultBranchId: mainBranch._id,
          },
        ]);
      }
      return { tenant, branch: mainBranch, roles, superAdmin, inviteToken };
    });
  });
}
