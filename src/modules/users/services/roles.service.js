import { isPermissionKey, permissionCatalog } from '@hms/shared';
import { PANELS } from '@hms/shared/catalog';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { withTransaction } from '../../../core/db/model.js';
import { Role } from '../../../core/auth/models/role.model.js';
import { User } from '../../../core/auth/models/user.model.js';
import { permissionCache } from '../../../core/rbac/permission.cache.js';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';

export const roleDto = (r, userCount) => ({
  id: String(r._id),
  code: r.code,
  name: r.name,
  panel: r.panel,
  isSystem: r.isSystem,
  clonedFrom: r.clonedFrom,
  permissions: r.permissions,
  pendingPermissions: r.pendingPermissions,
  scope: r.scope,
  maxSessions: r.maxSessions ?? null,
  status: r.status ?? (r.isActive === false ? 'INACTIVE' : 'ACTIVE'),
  userCount,
  version: r.version,
});

export async function listRoles() {
  const roles = await Role.find().sort({ isSystem: -1, name: 1 }).lean();
  const counts = await User.aggregate([
    { $match: { status: { $in: ['ACTIVE', 'INVITED', 'LOCKED'] } } },
    { $unwind: '$roles' },
    { $group: { _id: '$roles', n: { $sum: 1 } } },
  ]);
  const byRole = new Map(counts.map((c) => [String(c._id), c.n]));
  return roles.map((r) => roleDto(r, byRole.get(String(r._id)) ?? 0));
}

/** Known keys plus module and resource wildcards of known modules; never `*` in a custom role. */
function checkPermissions(perms) {
  const known = new Set(permissionCatalog().flatMap((g) => g.permissions));
  const prefixes = new Set(
    [...known].flatMap((k) => {
      const [m, r] = k.split(':');
      return [`${m}:*`, `${m}:${r}:*`, `${m}:*:read`];
    }),
  );
  const bad = perms.filter(
    (p) => p === '*' || !isPermissionKey(p) || (!known.has(p) && !prefixes.has(p)),
  );
  if (bad.length)
    throw errors.validation([
      { path: 'permissions', message: `Not allowed in a custom role: ${bad.join(', ')}` },
    ]);
  return [...new Set(perms)].sort();
}

const diff = (before, after) => ({
  added: after.filter((p) => !before.includes(p)),
  removed: before.filter((p) => !after.includes(p)),
});

/** A custom role starts as a copy of a system role; its permissions take effect after approval. */
export async function createRole({
  code,
  name,
  clonedFrom,
  permissions,
  scope,
  maxSessions,
  reason,
}) {
  const base = await Role.findOne({ code: clonedFrom, isSystem: true }).lean();
  if (!base)
    throw errors.validation([
      { path: 'clonedFrom', message: 'Choose a system role to start from' },
    ]);
  if (base.code === 'superadmin')
    throw errors.validation([
      { path: 'clonedFrom', message: 'The Super Admin role cannot be copied' },
    ]);
  if (PANELS[code] || (await Role.exists({ code })))
    throw errors.validation([{ path: 'code', message: 'This code is already used' }]);
  const perms = checkPermissions(permissions);
  return withTransaction(async () => {
    const [role] = await Role.create([
      {
        code,
        name,
        panel: base.panel,
        clonedFrom,
        permissions: [],
        pendingPermissions: perms,
        scope,
        maxSessions: maxSessions ?? undefined,
        isSystem: false,
        isActive: false,
        status: 'PENDING_APPROVAL',
      },
    ]);
    const approval = await requestApproval({
      action: 'users.rolePermission',
      module: 'CORE',
      entity: 'Role',
      entityId: role._id,
      title: `New role ${name} (copy of ${base.name})`,
      before: { permissions: base.permissions },
      after: { permissions: perms, ...diff(base.permissions, perms) },
      payload: { op: 'CREATE' },
      reason: reason || `New role ${name}`,
    });
    if (!approval) await applyPermissions(role, true);
    return { role: roleDto(role, 0), approvalId: approval ? String(approval._id) : null };
  });
}

export async function updateRole(id, { version, name, permissions, scope, maxSessions, reason }) {
  const role = await Role.findById(id);
  if (!role) throw errors.notFound('Role');
  if (role.isSystem)
    throw new AppError(
      409,
      'SYSTEM_ROLE',
      'System roles cannot be edited. Copy it into a custom role instead.',
    );
  if (role.version !== version) throw errors.versionConflict();
  const perms = checkPermissions(permissions);
  return withTransaction(async () => {
    role.set({ name, scope, maxSessions: maxSessions ?? undefined });
    let approvalId = null;
    const changed = diff(role.permissions, perms);
    if (changed.added.length || changed.removed.length) {
      if (role.status === 'PENDING_APPROVAL')
        throw new AppError(
          409,
          'APPROVAL_ALREADY_PENDING',
          'A permission change for this role is already waiting for approval',
        );
      role.pendingPermissions = perms;
      role.status = role.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING_APPROVAL';
      const approval = await requestApproval({
        action: 'users.rolePermission',
        module: 'CORE',
        entity: 'Role',
        entityId: role._id,
        title: `Change permissions of ${role.name}`,
        before: { permissions: role.permissions },
        after: { permissions: perms, ...changed },
        payload: { op: 'UPDATE' },
        reason: reason || `Permission change for ${role.name}`,
      });
      approvalId = approval ? String(approval._id) : null;
      if (!approval) await applyPermissions(role, true);
    }
    await role.save();
    await permissionCache.invalidateTenant(current().tenantId);
    return { role: roleDto(role), approvalId };
  });
}

export async function deactivateRole(id, { version }) {
  const role = await Role.findById(id);
  if (!role) throw errors.notFound('Role');
  if (role.isSystem) throw new AppError(409, 'SYSTEM_ROLE', 'System roles cannot be deactivated');
  if (role.version !== version) throw errors.versionConflict();
  const holders = await User.countDocuments({
    roles: role._id,
    status: { $in: ['ACTIVE', 'INVITED', 'LOCKED', 'PENDING_APPROVAL'] },
  });
  if (holders) throw new AppError(409, 'ROLE_IN_USE', `${holders} user(s) still have this role`);
  role.set({ status: 'INACTIVE', isActive: false });
  await role.save();
  return roleDto(role, 0);
}

async function applyPermissions(role, approved) {
  if (approved) {
    role.permissions = role.pendingPermissions ?? role.permissions;
    role.set({ status: 'ACTIVE', isActive: true });
  } else if (role.status === 'PENDING_APPROVAL') role.set({ status: 'REJECTED', isActive: false });
  role.pendingPermissions = undefined;
  await role.save();
}

onApprovalDecided('users.rolePermission', async (req, outcome) => {
  const role = await Role.findById(req.entityId);
  if (!role) return;
  await applyPermissions(role, outcome === 'APPROVED');
  await permissionCache.invalidateTenant(current().tenantId);
});
