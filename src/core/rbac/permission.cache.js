import { Role } from '../auth/models/role.model.js';
import { User } from '../auth/models/user.model.js';
import { redis } from '../cache/redis.js';

const TTL_SEC = 60;
const key = (tenantId, userId) => `perm:${tenantId}:${userId}`;

/** Data scopes from narrowest to widest (spec 4.1); a user gets the widest of their roles. */
export const SCOPES = ['own', 'ward', 'department', 'branch', 'all'];

/**
 * The signed-in user's effective access: union of active role permissions, the widest data
 * scope, role panels, branches and departments. Cached for 60 s so a disabled user or changed
 * role takes effect within a minute; user and role management call invalidate() to apply it now.
 */
export const permissionCache = {
  async forUser(tenantId, userId) {
    const hit = await redis().get(key(tenantId, userId));
    if (hit) return JSON.parse(hit);
    const user = await User.findById(userId)
      .select(
        'name status roles branchIds defaultBranchId departmentIds twoFactor.enabled mustChangePassword',
      )
      .lean();
    if (!user) return null;
    const roles = await Role.find({ _id: { $in: user.roles }, isActive: { $ne: false } })
      .select('code name panel permissions scope maxSessions')
      .lean();
    const limits = roles.map((r) => r.maxSessions).filter(Boolean);
    const access = {
      name: user.name,
      status: user.status,
      permissions: [...new Set(roles.flatMap((r) => r.permissions))],
      roles: roles.map((r) => ({ code: r.code, name: r.name, panel: r.panel, scope: r.scope })),
      scope: roles.reduce(
        (w, r) => (SCOPES.indexOf(r.scope) > SCOPES.indexOf(w) ? r.scope : w),
        'own',
      ),
      maxSessions: limits.length ? Math.max(...limits) : null,
      branchIds: (user.branchIds ?? []).map(String),
      departmentIds: (user.departmentIds ?? []).map(String),
      defaultBranchId: user.defaultBranchId ? String(user.defaultBranchId) : null,
      twoFactorEnabled: Boolean(user.twoFactor?.enabled),
      mustChangePassword: Boolean(user.mustChangePassword),
    };
    await redis().set(key(tenantId, userId), JSON.stringify(access), 'EX', TTL_SEC);
    return access;
  },
  async invalidate(tenantId, userId) {
    await redis().del(key(tenantId, userId));
  },
  /** After a role's permissions change: every holder re-reads on the next request. */
  async invalidateTenant(tenantId) {
    const stream = redis().scanStream({ match: `perm:${tenantId}:*`, count: 500 });
    for await (const keys of stream) if (keys.length) await redis().del(...keys);
  },
};
