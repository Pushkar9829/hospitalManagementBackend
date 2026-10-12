import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../observability/logger.js';
import { MemoryRedis } from './memory.js';

let client;

/**
 * True when no REDIS_URL is set: the cache lives in this process (see memory.js), rate limits
 * use the limiter's memory store, events are delivered without a queue and scheduled jobs run
 * on timers. Fine for a single-instance demo; production runs with Redis.
 */
export const inMemory = !env.REDIS_URL;

/** Shared Redis connection (rate limits, token blacklist, OTPs, idempotency, caches). */
export function redis() {
  if (!client && inMemory) {
    client = new MemoryRedis();
    logger.warn('REDIS_URL is not set: using an in-memory cache (single instance only)');
  }
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
  if (inMemory) throw new Error('No REDIS_URL: queues and the socket adapter need Redis');
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, ...opts });
}

export async function closeRedis() {
  if (client) await client.quit().catch(() => client.disconnect());
  client = undefined;
}
