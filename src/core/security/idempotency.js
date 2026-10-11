import { redis } from '../cache/redis.js';
import { current } from '../tenancy/context.js';
import { AppError } from '../errors/index.js';
import { sha256 } from './crypto.js';

const TTL_SEC = 24 * 3600;
const KEY = /^[\w-]{8,100}$/;

/**
 * Idempotency-Key support (spec "Conventions"): a repeated POST with the same key within 24 h
 * returns the first result instead of creating a second bill, payment or stock movement.
 */
export function idempotency({ required = false } = {}) {
  return async (req, res, next) => {
    const header = req.headers['idempotency-key'];
    if (!header) {
      return required
        ? next(new AppError(400, 'BAD_REQUEST', 'Idempotency-Key header is required'))
        : next();
    }
    if (!KEY.test(header)) return next(new AppError(400, 'BAD_REQUEST', 'Invalid Idempotency-Key'));
    const c = current();
    const key = `idem:${c.tenantId}:${c.userId}:${header}`;
    const fingerprint = sha256(
      `${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? {})}`,
    );
    const claimed = await redis().set(
      key,
      JSON.stringify({ state: 'pending', fingerprint }),
      'EX',
      TTL_SEC,
      'NX',
    );
    if (!claimed) {
      const prior = JSON.parse((await redis().get(key)) ?? '{}');
      if (prior.fingerprint && prior.fingerprint !== fingerprint) {
        return next(
          new AppError(
            422,
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was used for a different request',
          ),
        );
      }
      if (prior.state !== 'done')
        return next(
          new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed'),
        );
      res.setHeader('Idempotent-Replayed', 'true');
      return prior.body === undefined
        ? res.status(prior.status).end()
        : res.status(prior.status).json(prior.body);
    }
    let body;
    const json = res.json.bind(res);
    res.json = (b) => {
      body = b;
      return json(b);
    };
    res.on('finish', () => {
      // Server errors release the key so the client can retry; everything else is remembered.
      const p =
        res.statusCode >= 500
          ? redis().del(key)
          : redis().set(
              key,
              JSON.stringify({ state: 'done', fingerprint, status: res.statusCode, body }),
              'EX',
              TTL_SEC,
            );
      p.catch(() => {});
    });
    next();
  };
}
