import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from './logger.js';
import { maybeCurrent } from '../tenancy/context.js';

const REQUEST_ID = /^[\w-]{8,64}$/;

/** Request id from CloudFront/ALB (x-request-id) or a new UUID; echoed in the response. */
export function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}

/** Query values that are safe to log; everything else (names, mobiles, UHIDs) is masked. */
const SAFE_QUERY = new Set(['page', 'limit', 'sort', 'status', 'box', 'tab', 'type', 'from', 'to']);
/** Path segments after these are secrets (one-time links). */
const SECRET_AFTER = new Set(['invite', 'reset']);

/** Logs the path and query keys only, so patient searches never land in the logs (DPDP). */
export function redactUrl(url = '') {
  const [path, query] = url.split('?');
  const parts = path.split('/');
  const safePath = parts
    .map((seg, i) => (i > 0 && SECRET_AFTER.has(parts[i - 1]) && seg ? '[redacted]' : seg))
    .join('/');
  if (!query) return safePath;
  const params = new URLSearchParams(query);
  const safe = [...params.keys()].map((k) =>
    SAFE_QUERY.has(k) ? `${k}=${params.get(k)}` : `${k}=[redacted]`,
  );
  return `${safePath}?${safe.join('&')}`;
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  autoLogging: { ignore: (req) => req.url === '/api/health' },
  customProps: (req) => {
    const c = req.ctx ?? maybeCurrent();
    return c ? { tenantId: c.tenantId, userId: c.userId } : {};
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: redactUrl(req.originalUrl ?? req.url) }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
