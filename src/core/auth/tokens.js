import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { redis } from '../cache/redis.js';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
const REFRESH_PATH = '/api/v1/auth';

/** Short-lived RS256 access token: user, tenant, session family. */
export function signAccessToken({ userId, tenantId, familyId }) {
  const jti = randomUUID();
  const token = jwt.sign({ tid: tenantId, sid: familyId }, env.JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    subject: String(userId),
    expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
    jwtid: jti,
    issuer: 'hms',
  });
  return { token, jti };
}

export function verifyAccessToken(token) {
  const claims = jwt.verify(token, env.JWT_PUBLIC_KEY, { algorithms: ['RS256'], issuer: 'hms' });
  // Staff tokens carry no audience; a patient-portal token is never a staff session.
  if (claims.aud) throw new jwt.JsonWebTokenError('wrong audience');
  return claims;
}

const base = () => ({ httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax' });

export function setAuthCookies(
  res,
  { accessToken, refreshToken, rememberDevice, refreshExpiresAt },
) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base(),
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL_MIN * 60_000,
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base(),
    path: REFRESH_PATH,
    // Without "remember this device" the cookie ends with the browser session.
    ...(rememberDevice ? { expires: refreshExpiresAt } : {}),
  });
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: REFRESH_PATH });
}

/** Revoked access tokens (logout) until they would have expired anyway. */
export const tokenBlacklist = {
  async add(jti, expSec) {
    const ttl = Math.max(1, expSec - Math.floor(Date.now() / 1000));
    await redis().set(`jwt:revoked:${jti}`, '1', 'EX', ttl);
  },
  async has(jti) {
    return (await redis().exists(`jwt:revoked:${jti}`)) === 1;
  },
};
