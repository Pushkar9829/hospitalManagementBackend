import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../observability/logger.js';

let client;

/** Shared Redis connection (rate limits, token blacklist, OTPs, idempotency, caches). */
export function redis() {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableAutoPipelining: true,
      lazyConnect: false,
    });
    client.on('error', (err) => logger.error({ err }, 'Redis error'));
  }
  return client;
}

/** A new connection (BullMQ workers and Socket.IO pub/sub need their own). */
export function newRedisConnection(opts = {}) {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, ...opts });
}

export async function closeRedis() {
  if (client) await client.quit().catch(() => client.disconnect());
  client = undefined;
}
