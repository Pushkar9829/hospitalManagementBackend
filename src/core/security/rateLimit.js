import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../cache/redis.js';
import { maybeCurrent } from '../tenancy/context.js';
import { AppError } from '../errors/index.js';

const store = (prefix) =>
  new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command, ...args) => redis().call(command, ...args),
  });

const handler = (_req, _res, next) =>
  next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a minute and try again.'));

/**
 * Sign-in limits. The spec asks for 10/min per IP; a hospital usually reaches us from one NAT
 * address, so a shift change would lock everyone out. We apply 10/min per IP *and account*, plus
 * a 200/min ceiling per IP for the whole hospital.
 */
export const loginLimiters = () => [
  rateLimit({
    windowMs: 60_000,
    limit: 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store('login-ip'),
    handler,
    keyGenerator: (req) => `${maybeCurrent()?.tenantId}:${ipKeyGenerator(req.ip)}`,
  }),
  rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store('login'),
    handler,
    keyGenerator: (req) =>
      `${maybeCurrent()?.tenantId}:${ipKeyGenerator(req.ip)}:${String(
        req.body?.username ?? req.body?.email ?? req.body?.mobile ?? req.body?.challengeId ?? '',
      )
        .toLowerCase()
        .slice(0, 80)}`,
  }),
];

/** Spec "Rate limits": API 600/min per user. */
export const apiLimiter = () =>
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store('api'),
    handler,
    keyGenerator: (req) =>
      `${maybeCurrent()?.tenantId}:${maybeCurrent()?.userId ?? ipKeyGenerator(req.ip)}`,
  });

/** Public signup pages (no account yet): 30/min per IP; OTP sends are also capped per mobile. */
export const signupLimiter = () =>
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store('signup'),
    handler,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
  });
