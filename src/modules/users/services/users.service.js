import { PRIVILEGED_ROLES } from '@hms/shared';
import { env } from '../../../config/env.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { withTransaction } from '../../../core/db/model.js';
import { paginate } from '../../../core/http/paginate.js';
import { Tenant } from '../../../core/tenancy/tenant.model.js';
import { Branch } from '../../../core/tenancy/branch.model.js';
import { User } from '../../../core/auth/models/user.model.js';
import { Role } from '../../../core/auth/models/role.model.js';
import { Session } from '../../../core/auth/models/session.model.js';
import { hashPassword } from '../../../core/auth/password.js';
import { setPassword } from '../../../core/auth/auth.service.js';
import { permissionCache } from '../../../core/rbac/permission.cache.js';
import { onApprovalDecided, requestApproval } from '../../../core/approvals/approval.service.js';
import { recordAudit } from '../../../core/audit/audit.service.js';
import { sendSms } from '../../../core/notify/notify.service.js';
import { randomToken, sha256 } from '../../../core/security/crypto.js';
import { Department } from '../../setup/index.js';

const MAX_SUPER_ADMINS = 3; // spec 4.6
const INVITE_HOURS = 72;
const COUNTED = ['ACTIVE', 'INVITED', 'LOCKED', 'PENDING_APPROVAL'];

export const userDto = (u, roles = []) => ({
  id: String(u._id),
  name: u.name,
  username: u.username,
  mobile: u.mobile,
  email: u.email,
  designation: u.designation,
  status: u.status,
  roles: roles
    .filter((r) => u.roles.some((id) => String(id) === String(r._id)))
    .map((r) => ({ id: String(r._id), code: r.code, name: r.name })),
  pendingRoleCodes: u.pendingRoleCodes,
  branchIds: (u.branchIds ?? []).map(String),
  defaultBranchId: u.defaultBranchId && String(u.defaultBranchId),
  departmentIds: (u.departmentIds ?? []).map(String),
  preferredLanguage: u.preferredLanguage,
  twoFactorEnabled: Boolean(u.twoFactor?.enabled),
  lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : undefined,
  mustChangePassword: Boolean(u.mustChangePassword),
  lastLoginAt: u.lastLoginAt,
  inviteExpiresAt: u.status === 'INVITED' ? u.invite?.expiresAt : undefined,
  version: u.version,
});

const isPrivileged = (role) =>
  PRIVILEGED_ROLES.includes(role.code) || PRIVILEGED_ROLES.includes(role.clonedFrom);

async function rolesByCode(codes) {
  const roles = await Role.find({ code: { $in: codes }, status: 'ACTIVE' }).lean();
  const missing = codes.filter((c) => !roles.some((r) => r.code === c));
  if (missing.length)
    throw errors.validation([
      { path: 'roleCodes', message: `Unknown or inactive role: ${missing.join(', ')}` },
    ]);
  return roles;
}

async function checkRefs({ branchIds, departmentIds = [] }) {
  const details = [];
  if (
    (await Branch.countDocuments({ _id: { $in: branchIds }, status: 'ACTIVE' })) !==
    new Set(branchIds).size
  )
    details.push({ path: 'branchIds', message: 'Choose active branches' });
  if (
    departmentIds.length &&
    (await Department.countDocuments({ _id: { $in: departmentIds }, status: 'ACTIVE' })) !==
      new Set(departmentIds).size
  )
    details.push({ path: 'departmentIds', message: 'Choose active departments' });
  if (details.length) throw errors.validation(details);
}

/** Only a Super Admin may change another Super Admin. */
function guardSuperAdmin(target, roles) {
  const holdsSuper = target.roles.some((id) =>
    roles.some((r) => r.code === 'superadmin' && String(r._id) === String(id)),
  );
  if (holdsSuper && !current().permissions.has('*'))
    throw errors.forbidden('Only a Super Admin can change a Super Admin');
}

async function assertSuperAdminSeat(excludeUserId) {
  const sa = await Role.findOne({ code: 'superadmin' }).select('_id').lean();
  const n = await User.countDocuments({
    roles: sa._id,
    status: { $in: COUNTED },
    ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}),
  });
  if (n >= MAX_SUPER_ADMINS)
    throw new AppError(
      409,
      'SUPER_ADMIN_LIMIT',
      `A hospital can have at most ${MAX_SUPER_ADMINS} Super Admins`,
    );
}

export async function listUsers({ q, status, role, branchId, departmentId, ...page }) {
  const filter = {};
  if (status) filter.status = status;
  if (branchId) filter.branchIds = branchId;
  if (departmentId) filter.departmentIds = departmentId;
  if (role) {
    const r = await Role.findOne({ code: role }).select('_id').lean();
    filter.roles = r?._id ?? null;
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { username: rx }, { mobile: rx }];
  }
  const roles = await Role.find().select('code name').lean();
  return paginate(
    User,
    filter,
    { ...page, sort: page.sort ?? 'name' },
    {
      allowedSort: ['name', 'username', 'lastLoginAt', 'createdAt'],
      defaultSort: 'name',
      map: (u) => userDto(u, roles),
    },
  );
}

export async function getUser(id) {
  const u = await User.findById(id).lean();
  if (!u) throw errors.notFound('User');
  return userDto(u, await Role.find().select('code name').lean());
}

function inviteLink(token) {
  const { tenant } = current();
  return `${env.WEB_URL_TEMPLATE.replace('{subdomain}', tenant.subdomain)}/welcome?token=${token}`;
}

async function sendInvite(user) {
  const token = randomToken(32);
  user.invite = {
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + INVITE_HOURS * 3_600_000),
    sentAt: new Date(),
  };
  user.status = 'INVITED';
  await user.save();
  await sendSms({
    to: user.mobile,
    template: 'USER_INVITE',
    vars: { hospital: current().tenant.name, username: user.username, link: inviteLink(token) },
    lang: user.preferredLanguage,
  });
}

/**
 * Creates a staff login. Within the plan's user limit; a privileged role (Admin, Billing Manager,
 * Finance, HR, Payroll, Super Admin) waits for Super Admin approval before the login works.
 */
export async function createUser(input) {
  const { tenant } = current();
  const { roleCodes, onboarding, reason, ...fields } = input;
  const roles = await rolesByCode(roleCodes);
  await checkRefs(fields);
  if (await User.exists({ username: fields.username }))
    throw errors.validation([{ path: 'username', message: 'This username is taken' }]);
  if (fields.mobile && (await User.exists({ mobile: fields.mobile })))
    throw errors.validation([{ path: 'mobile', message: 'Another login uses this mobile number' }]);
  const limit = (await Tenant.findById(tenant.id).select('limits').lean())?.limits?.users ?? 25;
  if ((await User.countDocuments({ status: { $in: COUNTED } })) >= limit) {
    throw new AppError(
      402,
      'LIMIT_REACHED',
      `Your plan allows ${limit} users. Deactivate unused logins or add users to your subscription.`,
    );
  }
  if (roles.some((r) => r.code === 'superadmin')) await assertSuperAdminSeat();
  const privileged = roles.filter(isPrivileged);
  return withTransaction(async () => {
    const [user] = await User.create([
      {
        ...fields,
        defaultBranchId: fields.defaultBranchId ?? fields.branchIds[0],
        roles: roles.map((r) => r._id),
        status: 'PENDING_APPROVAL',
        ...(onboarding.mode === 'TEMP_PASSWORD'
          ? {
              passwordHash: await hashPassword(onboarding.temporaryPassword),
              mustChangePassword: true,
            }
          : {}),
      },
    ]);
    const approval = privileged.length
      ? await requestApproval({
          action: 'users.privilegedRole',
          module: 'CORE',
          entity: 'User',
          entityId: user._id,
          title: `New login ${user.name} (${user.username}) with ${privileged.map((r) => r.name).join(', ')}`,
          after: { roles: roles.map((r) => r.name), branches: fields.branchIds.length },
          payload: { op: 'CREATE', onboarding: onboarding.mode },
          reason: reason || `New ${privileged[0].name}`,
        })
      : null;
    if (!approval) await activateNewUser(user, onboarding.mode);
    return { user: userDto(user, roles), approvalId: approval ? String(approval._id) : null };
  });
}

async function activateNewUser(user, mode) {
  if (mode === 'INVITE') await sendInvite(user);
  else {
    user.status = 'ACTIVE';
    await user.save();
  }
}

/** Updates details, roles, branches and departments. Adding a privileged role waits for approval. */
export async function updateUser(id, input) {
  const { roleCodes, version, reason, ...fields } = input;
  const user = await User.findById(id);
  if (!user) throw errors.notFound('User');
  if (user.version !== version) throw errors.versionConflict();
  const allRoles = await Role.find().lean();
  guardSuperAdmin(user, allRoles);
  const roles = await rolesByCode(roleCodes);
  await checkRefs(fields);
  if (fields.mobile && (await User.exists({ mobile: fields.mobile, _id: { $ne: id } })))
    throw errors.validation([{ path: 'mobile', message: 'Another login uses this mobile number' }]);
  const had = new Set(user.roles.map(String));
  const added = roles.filter((r) => !had.has(String(r._id)));
  if (added.some((r) => r.code === 'superadmin')) await assertSuperAdminSeat(id);
  if (
    user.roles.some((rid) =>
      allRoles.find((r) => r.code === 'superadmin' && String(r._id) === String(rid)),
    ) &&
    !roles.some((r) => r.code === 'superadmin')
  ) {
    await assertNotLastSuperAdmin(user);
  }
  const addedPrivileged = added.filter(isPrivileged);
  return withTransaction(async () => {
    user.set({ ...fields, defaultBranchId: fields.defaultBranchId ?? fields.branchIds[0] });
    let approvalId = null;
    if (addedPrivileged.length) {
      // Keep the current roles, minus any removed, until the Super Admin approves the new ones.
      user.roles = roles.filter((r) => had.has(String(r._id))).map((r) => r._id);
      user.pendingRoleCodes = roleCodes;
      const approval = await requestApproval({
        action: 'users.privilegedRole',
        module: 'CORE',
        entity: 'User',
        entityId: user._id,
        title: `Give ${user.name} the role ${addedPrivileged.map((r) => r.name).join(', ')}`,
        before: { roles: allRoles.filter((r) => had.has(String(r._id))).map((r) => r.name) },
        after: { roles: roles.map((r) => r.name) },
        payload: { op: 'ROLES', roleCodes },
        reason: reason || 'Role change',
      });
      if (!approval) {
        user.roles = roles.map((r) => r._id);
        user.pendingRoleCodes = undefined;
      }
      approvalId = approval ? String(approval._id) : null;
    } else user.roles = roles.map((r) => r._id);
    await user.save();
    await permissionCache.invalidate(current().tenantId, String(user._id));
    return { user: userDto(user, allRoles), approvalId };
  });
}

async function assertNotLastSuperAdmin(user) {
  const sa = await Role.findOne({ code: 'superadmin' }).select('_id').lean();
  if (!user.roles.some((r) => String(r) === String(sa._id))) return;
  const others = await User.countDocuments({
    roles: sa._id,
    status: 'ACTIVE',
    _id: { $ne: user._id },
  });
  if (!others)
    throw new AppError(
      409,
      'LAST_SUPER_ADMIN',
      'The last active Super Admin cannot be deactivated or lose the role',
    );
}

async function signOutEverywhere(userId, reason) {
  await Session.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  await permissionCache.invalidate(current().tenantId, String(userId));
}

export async function deactivateUser(id, { version, reason }) {
  const user = await User.findById(id);
  if (!user) throw errors.notFound('User');
  if (user.version !== version) throw errors.versionConflict();
  if (String(user._id) === String(current().userId))
    throw new AppError(409, 'INVALID_STATE', 'You cannot deactivate your own login');
  guardSuperAdmin(user, await Role.find().lean());
  await assertNotLastSuperAdmin(user);
  user.status = 'DISABLED';
  await user.save();
  await signOutEverywhere(user._id, 'deactivated');
  await recordAudit({
    action: 'UPDATE',
    entity: 'User',
    entityId: user._id,
    summary: `Deactivated: ${reason}`,
  });
  return getUser(id);
}

export async function activateUser(id, { version }) {
  const user = await User.findById(id).select('+passwordHash');
  if (!user) throw errors.notFound('User');
  if (user.version !== version) throw errors.versionConflict();
  if (user.status !== 'DISABLED')
    throw new AppError(409, 'INVALID_STATE', 'Only a deactivated login can be activated');
  guardSuperAdmin(user, await Role.find().lean());
  const limit =
    (await Tenant.findById(current().tenant.id).select('limits').lean())?.limits?.users ?? 25;
  if ((await User.countDocuments({ status: { $in: COUNTED } })) >= limit)
    throw new AppError(402, 'LIMIT_REACHED', `Your plan allows ${limit} users`);
  user.status = user.passwordHash ? 'ACTIVE' : 'INVITED';
  await user.save();
  return getUser(id);
}

/** Admin unlock (spec 4.4: "Admin can unlock"). */
export async function unlockUser(id) {
  const user = await User.findById(id);
  if (!user) throw errors.notFound('User');
  guardSuperAdmin(user, await Role.find().lean());
  await User.updateOne({ _id: id }, { $set: { failedLogins: 0 }, $unset: { lockedUntil: 1 } });
  await recordAudit({
    action: 'UPDATE',
    entity: 'User',
    entityId: id,
    summary: 'Unlocked by admin',
  });
  return getUser(id);
}

/** Admin reset: a temporary password the user must change at the next sign-in. */
export async function resetUserPassword(id, { temporaryPassword }) {
  const user = await User.findById(id);
  if (!user) throw errors.notFound('User');
  guardSuperAdmin(user, await Role.find().lean());
  await setPassword(user._id, temporaryPassword, { mustChange: true });
  await signOutEverywhere(user._id, 'admin-reset');
  await recordAudit({
    action: 'PASSWORD_CHANGED',
    entity: 'User',
    entityId: id,
    summary: 'Temporary password set by admin',
  });
  return getUser(id);
}

export async function resendInvite(id) {
  const user = await User.findById(id);
  if (!user) throw errors.notFound('User');
  if (user.status !== 'INVITED')
    throw new AppError(409, 'INVALID_STATE', 'Only an invited user can get a new invitation');
  if (!user.mobile)
    throw errors.validation([{ path: 'mobile', message: 'Add a mobile number first' }]);
  await sendInvite(user);
  return getUser(id);
}

export async function revokeSessions(id) {
  const user = await User.findById(id);
  if (!user) throw errors.notFound('User');
  guardSuperAdmin(user, await Role.find().lean());
  await signOutEverywhere(user._id, 'admin-signout');
}

// ---------------------------------------------------------------- invitations (public)

async function findInvite(token) {
  const user = await User.findOne({ 'invite.tokenHash': sha256(token), status: 'INVITED' }).select(
    '+invite.tokenHash',
  );
  if (!user || !user.invite?.expiresAt || user.invite.expiresAt < new Date()) {
    throw new AppError(
      410,
      'INVITE_EXPIRED',
      'This invitation has expired or was already used. Ask your admin for a new one.',
    );
  }
  return user;
}

export async function inviteInfo(token) {
  const user = await findInvite(token);
  return { name: user.name, username: user.username, hospital: current().tenant.name };
}

export async function acceptInvite({ token, newPassword }) {
  const user = await findInvite(token);
  current().userId = String(user._id);
  await setPassword(user._id, newPassword);
  await User.updateOne({ _id: user._id }, { $set: { status: 'ACTIVE' }, $unset: { invite: 1 } });
  await recordAudit({
    action: 'PASSWORD_CHANGED',
    entity: 'User',
    entityId: user._id,
    userId: user._id,
    summary: 'Invitation accepted',
  });
  return { username: user.username };
}

onApprovalDecided('users.privilegedRole', async (req, outcome) => {
  const user = await User.findById(req.entityId);
  if (!user) return;
  const approved = outcome === 'APPROVED';
  if (req.payload.op === 'CREATE') {
    if (approved) await activateNewUser(user, req.payload.onboarding);
    else {
      user.status = 'DISABLED';
      await user.save();
    }
  } else {
    if (approved) {
      const roles = await Role.find({ code: { $in: req.payload.roleCodes }, status: 'ACTIVE' })
        .select('_id')
        .lean();
      user.roles = roles.map((r) => r._id);
    }
    user.pendingRoleCodes = undefined;
    await user.save();
  }
  await permissionCache.invalidate(current().tenantId, String(user._id));
});
