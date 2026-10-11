import { randomInt, randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { isMobile, normaliseMobile } from '@hms/shared';
import { env } from '../../config/env.js';
import { AppError, errors } from '../errors/index.js';
import { redis } from '../cache/redis.js';
import { current } from '../tenancy/context.js';
import { Branch } from '../tenancy/branch.model.js';
import { recordAudit } from '../audit/audit.service.js';
import { permissionCache } from '../rbac/permission.cache.js';
import { sendSms } from '../notify/notify.service.js';
import { decrypt, encrypt, randomToken, safeEqual, sha256 } from '../security/crypto.js';
import { User } from './models/user.model.js';
import { Session } from './models/session.model.js';
import { hashPassword, verifyPassword } from './password.js';
import { signAccessToken, tokenBlacklist, verifyAccessToken } from './tokens.js';
import { mustEnrolTwoFactor } from './authenticate.js';
import { idle, idleMinutes } from './idle.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const CHALLENGE_TTL_SEC = 300;
const OTP_TTL_SEC = 300;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS = 3; // per mobile per 10 minutes

authenticator.options = { window: 1 };

const invalid = () => new AppError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect');

// ---------------------------------------------------------------- password sign-in

export async function loginWithPassword({ username, password, rememberDevice }, meta) {
  const { tenantId } = current();
  const byMobile = isMobile(username);
  const user = await User.findOne(
    byMobile ? { mobile: normaliseMobile(username) } : { username },
  ).select('+passwordHash +twoFactor.secret');
  if (user?.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil);
  const ok = await verifyPassword(user?.passwordHash, password);
  if (!user || !ok) {
    if (user) await registerFailure(user);
    await recordAudit({
      action: 'LOGIN_FAILED',
      entity: 'User',
      entityId: user?._id,
      summary: `Sign-in failed for ${username}`,
      tenantId,
    });
    throw invalid();
  }
  if (user.status !== 'ACTIVE') throw invalid();
  return completeFirstFactor(user, { rememberDevice, method: 'password' }, meta);
}

/** Atomic count, so parallel guesses cannot slip past the lockout. */
async function registerFailure(user) {
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    { $inc: { failedLogins: 1 } },
    { new: true },
  )
    .select('failedLogins')
    .lean();
  if ((updated?.failedLogins ?? 0) < MAX_FAILED_LOGINS) return;
  const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
  const locked = await User.updateOne(
    { _id: user._id, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }] },
    { $set: { lockedUntil, failedLogins: 0 } },
  );
  if (locked.modifiedCount) {
    await recordAudit({
      action: 'ACCOUNT_LOCKED',
      entity: 'User',
      entityId: user._id,
      summary: `${MAX_FAILED_LOGINS} wrong attempts`,
    });
  }
  throw lockedError(lockedUntil);
}

function lockedError(until) {
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
  return new AppError(
    423,
    'ACCOUNT_LOCKED',
    `Too many wrong attempts. Try again in ${minutes} minute${minutes > 1 ? 's' : ''} or ask your admin to unlock the account.`,
  );
}

/** After the first factor: either issue the session or ask for the authenticator code. */
async function completeFirstFactor(user, { rememberDevice, method }, meta) {
  if (user.twoFactor?.enabled) {
    const challengeId = randomToken(24);
    await redis().set(
      `2fa:${challengeId}`,
      JSON.stringify({
        tenantId: current().tenantId,
        userId: String(user._id),
        rememberDevice,
        method,
        attempts: 0,
      }),
      'EX',
      CHALLENGE_TTL_SEC,
    );
    return { challenge: { twoFactorRequired: true, challengeId } };
  }
  return { tokens: await startSession(user, { rememberDevice, method }, meta) };
}

// ---------------------------------------------------------------- two-factor

export async function verifyTwoFactor({ challengeId, code }, meta) {
  const key = `2fa:${challengeId}`;
  const raw = await redis().get(key);
  if (!raw)
    throw new AppError(401, 'TOKEN_INVALID', 'This sign-in attempt expired. Please sign in again.');
  const ch = JSON.parse(raw);
  if (ch.tenantId !== current().tenantId)
    throw new AppError(401, 'TOKEN_INVALID', 'This sign-in attempt expired. Please sign in again.');
  const user = await User.findById(ch.userId).select('+twoFactor.secret');
  if (!user || user.status !== 'ACTIVE' || !user.twoFactor?.secret) throw invalid();
  if (!authenticator.check(code, decrypt(user.twoFactor.secret))) {
    ch.attempts += 1;
    if (ch.attempts >= 5) await redis().del(key);
    else await redis().set(key, JSON.stringify(ch), 'KEEPTTL');
    await recordAudit({
      action: 'LOGIN_FAILED',
      entity: 'User',
      entityId: user._id,
      summary: 'Wrong authenticator code',
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'The code is incorrect or has expired');
  }
  await redis().del(key);
  return startSession(
    user,
    { rememberDevice: ch.rememberDevice, method: `${ch.method}+totp` },
    meta,
  );
}

export async function beginTwoFactorSetup() {
  const { userId, tenant } = current();
  const user = await User.findById(userId);
  const secret = authenticator.generateSecret();
  await User.updateOne({ _id: userId }, { $set: { 'twoFactor.pendingSecret': encrypt(secret) } });
  return { secret, otpauthUrl: authenticator.keyuri(user.username, `HMS ${tenant.name}`, secret) };
}

export async function enableTwoFactor({ code }) {
  const { userId } = current();
  const user = await User.findById(userId).select('+twoFactor.pendingSecret');
  const pending = user?.twoFactor?.pendingSecret;
  if (!pending)
    throw new AppError(409, 'TWO_FACTOR_NOT_STARTED', 'Start the authenticator setup first');
  const secret = decrypt(pending);
  if (!authenticator.check(code, secret))
    throw new AppError(422, 'VALIDATION_FAILED', 'The code is incorrect', [
      { path: 'code', message: 'The code is incorrect' },
    ]);
  await User.updateOne(
    { _id: userId },
    {
      $set: { 'twoFactor.enabled': true, 'twoFactor.secret': encrypt(secret) },
      $unset: { 'twoFactor.pendingSecret': 1 },
    },
  );
  await recordAudit({ action: 'TWO_FACTOR_ENABLED', entity: 'User', entityId: userId });
  return { enabled: true };
}

// ---------------------------------------------------------------- mobile OTP sign-in

export async function requestLoginOtp({ mobile }) {
  const { tenantId, tenant } = current();
  const sends = await redis().incr(`otp:sends:${tenantId}:${mobile}`);
  if (sends === 1) await redis().expire(`otp:sends:${tenantId}:${mobile}`, 600);
  // Same answer whether or not the mobile belongs to a user, so numbers cannot be probed.
  const result = { expiresInSec: OTP_TTL_SEC };
  if (sends > OTP_MAX_SENDS) return result;
  const user = await User.findOne({ mobile, status: 'ACTIVE' }).select('_id preferredLanguage');
  if (!user) return result;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await redis().set(
    `otp:${tenantId}:${mobile}`,
    JSON.stringify({ hash: sha256(`${mobile}:${code}`), attempts: 0 }),
    'EX',
    OTP_TTL_SEC,
  );
  await sendSms({
    to: mobile,
    template: 'LOGIN_OTP',
    vars: { code, hospital: tenant.name },
    lang: user.preferredLanguage,
  });
  return result;
}

export async function verifyLoginOtp({ mobile, code }, meta) {
  const { tenantId } = current();
  const key = `otp:${tenantId}:${mobile}`;
  const raw = await redis().get(key);
  const wrong = new AppError(401, 'INVALID_CREDENTIALS', 'The code is incorrect or has expired');
  if (!raw) throw wrong;
  const otp = JSON.parse(raw);
  if (!safeEqual(otp.hash, sha256(`${mobile}:${code}`))) {
    otp.attempts += 1;
    if (otp.attempts >= OTP_MAX_ATTEMPTS) await redis().del(key);
    else await redis().set(key, JSON.stringify(otp), 'KEEPTTL');
    throw wrong;
  }
  await redis().del(key);
  const user = await User.findOne({ mobile }).select('+twoFactor.secret');
  if (!user || user.status !== 'ACTIVE') throw wrong;
  if (user.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil);
  return completeFirstFactor(user, { rememberDevice: false, method: 'otp' }, meta);
}

// ---------------------------------------------------------------- sessions

/**
 * Concurrent sessions per role (spec 4.4: doctors 2 devices, cashiers 1). Signing in on one more
 * device signs out the oldest ones.
 */
async function enforceDeviceLimit(userId) {
  const { tenantId } = current();
  const access = await permissionCache.forUser(tenantId, userId);
  const limit = access?.maxSessions;
  if (!limit) return;
  const families = await Session.aggregate([
    { $match: { userId, revokedAt: null, expiresAt: { $gt: new Date() } } },
    { $group: { _id: '$familyId', started: { $min: '$createdAt' } } },
    { $sort: { started: -1 } },
  ]);
  const surplus = families.slice(limit - 1).map((f) => f._id);
  if (!surplus.length) return;
  await Session.updateMany(
    { familyId: { $in: surplus }, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'device-limit' } },
  );
  await recordAudit({
    action: 'LOGOUT',
    entity: 'User',
    entityId: userId,
    userId,
    summary: `Signed out ${surplus.length} older device(s): limit is ${limit}`,
  });
}

async function startSession(user, { rememberDevice, method }, meta) {
  const { tenantId } = current();
  const familyId = randomUUID();
  await enforceDeviceLimit(user._id);
  const tokens = await issueTokens({ userId: user._id, familyId, rememberDevice }, meta);
  await idle.touch(tenantId, familyId, idleMinutes(current().tenant));
  await User.updateOne(
    { _id: user._id },
    { $set: { failedLogins: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: 1 } },
  );
  current().userId = String(user._id);
  current().userName = user.name;
  await recordAudit({
    action: 'LOGIN',
    entity: 'User',
    entityId: user._id,
    summary: `Signed in (${method})`,
    userId: user._id,
    userName: user.name,
    tenantId,
  });
  return { ...tokens, userId: String(user._id) };
}

async function issueTokens({ userId, familyId, rememberDevice }, meta, expiresAt) {
  const { tenantId } = current();
  const secret = randomToken(32);
  const refreshExpiresAt =
    expiresAt ??
    new Date(
      Date.now() +
        (rememberDevice
          ? env.REFRESH_TOKEN_TTL_DAYS * 86_400_000
          : env.SESSION_TTL_HOURS * 3_600_000),
    );
  const [session] = await Session.create([
    {
      userId,
      familyId,
      tokenHash: sha256(secret),
      expiresAt: refreshExpiresAt,
      rememberDevice,
      ip: meta?.ip,
      userAgent: meta?.userAgent?.slice(0, 200),
    },
  ]);
  const { token: accessToken } = signAccessToken({ userId, tenantId, familyId });
  return {
    accessToken,
    refreshToken: `${session._id}.${secret}`,
    rememberDevice,
    refreshExpiresAt,
    sessionId: session._id,
  };
}

/** Rotates the refresh token. A token used twice revokes its whole family (theft detection). */
export async function refreshSession(refreshToken, meta) {
  const expired = new AppError(
    401,
    'TOKEN_INVALID',
    'Your session has expired. Please sign in again.',
  );
  const [id, secret] = String(refreshToken ?? '').split('.');
  if (!/^[a-f\d]{24}$/i.test(id ?? '') || !secret) throw expired;
  const session = await Session.findOne({ _id: id, tokenHash: sha256(secret) });
  if (!session) throw expired;
  if (session.revokedAt && session.revokedReason !== 'rotated') throw expired;
  if (session.revokedAt) {
    await Session.updateMany(
      { familyId: session.familyId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'reuse' } },
    );
    await recordAudit({
      action: 'SESSION_REUSE_DETECTED',
      entity: 'Session',
      entityId: session.familyId,
      userId: session.userId,
      summary: 'Refresh token used twice; all sessions in the family revoked',
    });
    throw expired;
  }
  if (session.expiresAt <= new Date()) throw expired;
  const { tenantId, tenant } = current();
  if (!session.rememberDevice && !(await idle.isActive(tenantId, session.familyId))) {
    await Session.updateMany(
      { familyId: session.familyId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'idle' } },
    );
    throw new AppError(
      401,
      'SESSION_IDLE',
      `You were signed out after ${idleMinutes(tenant)} minutes without activity. Please sign in again.`,
    );
  }
  const user = await User.findById(session.userId).select('status');
  if (user?.status !== 'ACTIVE') throw expired;
  // Claim the token atomically so two parallel refreshes cannot both rotate it.
  const claimed = await Session.findOneAndUpdate(
    { _id: session._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'rotated' } },
  );
  if (!claimed) throw expired;
  const next = await issueTokens(
    { userId: session.userId, familyId: session.familyId, rememberDevice: session.rememberDevice },
    meta,
    session.expiresAt,
  );
  await Session.updateOne({ _id: session._id }, { $set: { replacedBy: next.sessionId } });
  current().userId = String(session.userId);
  return next;
}

/**
 * Signs out this device: revokes the session family and blacklists the access token.
 * Public route (works with an expired access token), so the token is read here, best effort.
 */
export async function logout({ refreshToken, accessToken }) {
  const { tenantId } = current();
  let claims = null;
  try {
    claims = accessToken ? verifyAccessToken(accessToken) : null;
  } catch {
    claims = null;
  }
  if (claims && claims.tid !== tenantId) claims = null;
  const revoke = { $set: { revokedAt: new Date(), revokedReason: 'logout' } };
  if (claims?.sid) {
    await Session.updateMany({ familyId: claims.sid, revokedAt: null }, revoke);
    await idle.clear(tenantId, claims.sid);
  }
  const [id, secret] = String(refreshToken ?? '').split('.');
  if (/^[a-f\d]{24}$/i.test(id ?? '') && secret) {
    const s = await Session.findOne({ _id: id, tokenHash: sha256(secret) })
      .select('familyId')
      .lean();
    if (s) await Session.updateMany({ familyId: s.familyId, revokedAt: null }, revoke);
  }
  if (claims) {
    await tokenBlacklist.add(claims.jti, claims.exp);
    await recordAudit({
      action: 'LOGOUT',
      entity: 'User',
      entityId: claims.sub,
      userId: claims.sub,
    });
  }
}

const HISTORY = 5;

/** Sets a new password if it is not the current one or one of the last 5 (spec 4.4). */
export async function setPassword(userId, newPassword, { mustChange = false } = {}) {
  const user = await User.findById(userId).select('+passwordHash +passwordHistory');
  if (!user) throw errors.notFound('User');
  for (const old of [user.passwordHash, ...(user.passwordHistory ?? [])].filter(Boolean)) {
    if (await verifyPassword(old, newPassword)) {
      throw errors.validation([
        {
          path: 'newPassword',
          message: `Choose a password you have not used in your last ${HISTORY} changes`,
        },
      ]);
    }
  }
  const history = [user.passwordHash, ...(user.passwordHistory ?? [])]
    .filter(Boolean)
    .slice(0, HISTORY);
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        passwordHash: await hashPassword(newPassword),
        passwordHistory: history,
        passwordChangedAt: new Date(),
        mustChangePassword: mustChange,
        failedLogins: 0,
      },
      $unset: { lockedUntil: 1 },
    },
  );
  await permissionCache.invalidate(current().tenantId, String(userId));
}

export async function changePassword({ currentPassword, newPassword }) {
  const c = current();
  const user = await User.findById(c.userId).select('+passwordHash');
  if (!(await verifyPassword(user?.passwordHash, currentPassword))) {
    throw errors.validation(
      [{ path: 'currentPassword', message: 'Current password is incorrect' }],
      'Current password is incorrect',
    );
  }
  await setPassword(c.userId, newPassword);
  // Sign out every other device.
  await Session.updateMany(
    { userId: c.userId, familyId: { $ne: c.familyId }, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'password-change' } },
  );
  await recordAudit({ action: 'PASSWORD_CHANGED', entity: 'User', entityId: c.userId });
}

// ---------------------------------------------------------------- forgotten password

/** Sends a reset code to the registered mobile. Same answer whether or not the user exists. */
export async function requestPasswordReset({ username }) {
  const { tenantId, tenant } = current();
  const user = await User.findOne(
    isMobile(username) ? { mobile: normaliseMobile(username) } : { username },
  ).select('mobile status preferredLanguage');
  const result = { expiresInSec: OTP_TTL_SEC };
  if (!user?.mobile || user.status !== 'ACTIVE') return result;
  const sendsKey = `pwreset:sends:${tenantId}:${user._id}`;
  const sends = await redis().incr(sendsKey);
  if (sends === 1) await redis().expire(sendsKey, 3600);
  if (sends > OTP_MAX_SENDS) return result;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await redis().set(
    `pwreset:${tenantId}:${user._id}`,
    JSON.stringify({ hash: sha256(`${user._id}:${code}`), attempts: 0 }),
    'EX',
    OTP_TTL_SEC,
  );
  await sendSms({
    to: user.mobile,
    template: 'PASSWORD_RESET_OTP',
    vars: { code, hospital: tenant.name },
    lang: user.preferredLanguage,
  });
  return result;
}

/** Checks the code, sets the new password, unlocks the account and signs out every device. */
export async function resetPassword({ username, code, newPassword }) {
  const { tenantId } = current();
  const wrong = new AppError(401, 'INVALID_CREDENTIALS', 'The code is incorrect or has expired');
  const user = await User.findOne(
    isMobile(username) ? { mobile: normaliseMobile(username) } : { username },
  ).select('_id status');
  if (!user || user.status !== 'ACTIVE') throw wrong;
  const key = `pwreset:${tenantId}:${user._id}`;
  const raw = await redis().get(key);
  if (!raw) throw wrong;
  const otp = JSON.parse(raw);
  if (!safeEqual(otp.hash, sha256(`${user._id}:${code}`))) {
    otp.attempts += 1;
    if (otp.attempts >= OTP_MAX_ATTEMPTS) await redis().del(key);
    else await redis().set(key, JSON.stringify(otp), 'KEEPTTL');
    throw wrong;
  }
  await redis().del(key);
  current().userId = String(user._id);
  await setPassword(user._id, newPassword);
  await Session.updateMany(
    { userId: user._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'password-reset' } },
  );
  await recordAudit({
    action: 'PASSWORD_CHANGED',
    entity: 'User',
    entityId: user._id,
    userId: user._id,
    summary: 'Reset with SMS code',
  });
}

// ---------------------------------------------------------------- session payload

/** Body of GET /auth/me and of a successful sign-in (shared `sessionSchema`). */
export async function sessionPayload(userId = current().userId) {
  const c = current();
  const { tenant } = c;
  const user = await User.findById(userId)
    .select('name username designation twoFactor.enabled preferredLanguage')
    .lean();
  const access = await permissionCache.forUser(c.tenantId, userId);
  if (!user || !access) throw new AppError(401, 'TOKEN_INVALID', 'Please sign in again');
  const all = access.permissions.includes('*');
  const branches = await Branch.find(
    all ? { isActive: true } : { _id: { $in: access.branchIds }, isActive: true },
  )
    .select('name')
    .sort({ name: 1 })
    .lean();
  const list = branches.map((b) => ({ id: String(b._id), name: b.name }));
  const selected = c.branchId ?? access.defaultBranchId ?? list[0]?.id ?? null;
  return {
    user: {
      id: String(user._id),
      name: user.name,
      username: user.username,
      designation: user.designation ?? undefined,
      roles: access.roles.map(({ code, name, panel }) => ({ code, name, panel })),
      twoFactorEnabled: Boolean(user.twoFactor?.enabled),
      twoFactorSetupRequired: mustEnrolTwoFactor(access, tenant),
      mustChangePassword: access.mustChangePassword,
      preferredLanguage: user.preferredLanguage ?? 'en',
    },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      status: tenant.status,
      modules: tenant.modules,
    },
    branch: list.find((b) => b.id === selected) ?? null,
    branches: list,
    permissions: access.permissions,
    idleTimeoutMin: tenant.settings?.idleTimeoutMin ?? env.IDLE_TIMEOUT_MIN,
  };
}
