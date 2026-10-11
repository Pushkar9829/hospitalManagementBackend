import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { env } from '../config/env.js';
import { AppError } from '../core/errors/index.js';
import { redis } from '../core/cache/redis.js';
import { runInContext } from '../core/tenancy/context.js';
import { verifyPassword } from '../core/auth/password.js';
import { decrypt, randomToken } from '../core/security/crypto.js';
import { PlatformUser } from './models/platform.models.js';

export const PLATFORM_COOKIE = 'platform_token';
const TTL_MIN = 30;

/** Platform roles (spec 3.2). No role can read patient data: platform routes never open tenant data. */
export const PLATFORM_ROLE_PERMISSIONS = Object.freeze({
  PLATFORM_SUPER_ADMIN: ['*'],
  SALES: [
    'platform:tenant:read',
    'platform:tenant:update',
    'platform:subscription:*',
    'platform:metrics:read',
    'platform:plan:read',
  ],
  FINANCE: [
    'platform:tenant:read',
    'platform:invoice:*',
    'platform:metrics:read',
    'platform:plan:read',
  ],
  SUPPORT: ['platform:tenant:read', 'platform:plan:read'],
});

const permissionsOf = (roles) => [
  ...new Set(roles.flatMap((r) => PLATFORM_ROLE_PERMISSIONS[r] ?? [])),
];

/** The console only answers on console.<root domain> (CloudFront also IP-restricts it). */
export function consoleHostOnly(req, _res, next) {
  if (!req.hostname?.startsWith('console.'))
    return next(new AppError(404, 'NOT_FOUND', 'Not found'));
  next();
}

/** Platform staff always use two-factor sign-in. */
export async function platformLogin({ email, password }) {
  const user = await PlatformUser.findOne({ email: email.toLowerCase() }).select(
    '+passwordHash +twoFactor.secret',
  );
  if (user?.lockedUntil && user.lockedUntil > new Date())
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many wrong attempts. Try again later.');
  const ok = await verifyPassword(user?.passwordHash, password);
  if (!user || !ok || user.status !== 'ACTIVE') {
    if (user) {
      const failed = user.failedLogins + 1;
      await PlatformUser.updateOne(
        { _id: user._id },
        {
          $set: {
            failedLogins: failed,
            ...(failed >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60_000) } : {}),
          },
        },
      );
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail or password is incorrect');
  }
  if (!user.twoFactor?.enabled || !user.twoFactor.secret)
    throw new AppError(
      403,
      'TWO_FACTOR_SETUP_REQUIRED',
      'Two-factor sign-in is not set up for this account',
    );
  const challengeId = randomToken(24);
  await redis().set(`p2fa:${challengeId}`, String(user._id), 'EX', 300);
  return { twoFactorRequired: true, challengeId };
}

export async function platformVerify({ challengeId, code }) {
  const userId = await redis().get(`p2fa:${challengeId}`);
  if (!userId) throw new AppError(401, 'TOKEN_INVALID', 'Sign in again');
  const user = await PlatformUser.findById(userId).select('+twoFactor.secret');
  if (!user || !authenticator.check(code, decrypt(user.twoFactor.secret)))
    throw new AppError(401, 'INVALID_CREDENTIALS', 'The code is incorrect');
  await redis().del(`p2fa:${challengeId}`);
  await PlatformUser.updateOne(
    { _id: user._id },
    { $set: { failedLogins: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: 1 } },
  );
  const token = jwt.sign({ roles: user.roles }, env.JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    subject: String(user._id),
    audience: 'platform',
    issuer: 'hms',
    expiresIn: `${TTL_MIN}m`,
    jwtid: randomUUID(),
  });
  return {
    token,
    user: { id: String(user._id), name: user.name, email: user.email, roles: user.roles },
  };
}

export function setPlatformCookie(res, token) {
  res.cookie(PLATFORM_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/platform',
    maxAge: TTL_MIN * 60_000,
  });
}

/** Opens a platform context: no tenant, platform permissions only. */
export async function platformAuthenticate(req, _res, next) {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const token = req.cookies?.[PLATFORM_COOKIE] ?? bearer;
  if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in'));
  let claims;
  try {
    claims = jwt.verify(token, env.JWT_PUBLIC_KEY, {
      algorithms: ['RS256'],
      audience: 'platform',
      issuer: 'hms',
    });
  } catch {
    return next(new AppError(401, 'TOKEN_INVALID', 'Your session has expired'));
  }
  const user = await PlatformUser.findById(claims.sub).lean();
  if (!user || user.status !== 'ACTIVE')
    return next(new AppError(401, 'TOKEN_INVALID', 'Your account is not active'));
  runInContext(
    {
      platform: true,
      tenantId: null,
      userId: String(user._id),
      userName: user.name,
      permissions: new Set(permissionsOf(user.roles)),
      modules: new Set(['CORE']),
      requestId: req.id,
      ip: req.ip,
    },
    () => next(),
  );
}
