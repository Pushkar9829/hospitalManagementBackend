import { describe, expect, it, vi } from 'vitest';
import { MemoryRedis } from '../../src/core/cache/memory.js';

describe('in-memory cache (no REDIS_URL)', () => {
  it('gets, sets with expiry, NX and KEEPTTL, counts and deletes', async () => {
    vi.useFakeTimers();
    const r = new MemoryRedis();
    expect(await r.set('a', 1, 'EX', 10)).toBe('OK');
    expect(await r.get('a')).toBe('1');
    expect(await r.set('a', 2, 'NX')).toBeNull();
    expect(await r.set('a', 3, 'KEEPTTL')).toBe('OK');
    vi.advanceTimersByTime(10_001);
    expect(await r.get('a')).toBeNull(); // KEEPTTL kept the first expiry

    expect(await r.incr('n')).toBe(1);
    expect(await r.incr('n')).toBe(2);
    expect(await r.expire('n', 1)).toBe(1);
    expect(await r.exists('n', 'missing')).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await r.exists('n')).toBe(0);

    await r.set('perm:t1:u1', 'x');
    await r.set('perm:t1:u2', 'y');
    await r.set('perm:t2:u1', 'z');
    const found = [];
    for await (const keys of r.scanStream({ match: 'perm:t1:*' })) found.push(...keys);
    expect(found.sort()).toEqual(['perm:t1:u1', 'perm:t1:u2']);
    expect(await r.del('perm:t1:u1', 'perm:t1:u2', 'nope')).toBe(2);
    expect(await r.ping()).toBe('PONG');
    vi.useRealTimers();
  });
});
