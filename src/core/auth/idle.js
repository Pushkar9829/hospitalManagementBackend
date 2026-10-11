import { env } from '../../config/env.js';
import { redis } from '../cache/redis.js';

/** Hospital setting (5-60 min, spec 4.4) or the platform default. */
export const idleMinutes = (tenant) => tenant?.settings?.idleTimeoutMin ?? env.IDLE_TIMEOUT_MIN;

/**
 * Server-side idle timeout. Every user request renews a Redis key per session family; when the
 * access token expires, refresh is refused if the key has lapsed. Sessions on a remembered
 * personal device are exempt (they still end at their absolute expiry).
 */
export const idle = {
  key: (tenantId, familyId) => `idle:${tenantId}:${familyId}`,
  async touch(tenantId, familyId, minutes) {
    if (familyId) await redis().set(this.key(tenantId, familyId), '1', 'EX', minutes * 60);
  },
  async isActive(tenantId, familyId) {
    return (await redis().exists(this.key(tenantId, familyId))) === 1;
  },
  async clear(tenantId, familyId) {
    await redis().del(this.key(tenantId, familyId));
  },
};
