import { Readable } from 'node:stream';

/**
 * A small in-memory stand-in for the Redis commands the API uses, for a single-instance demo
 * with no REDIS_URL. Keys live in this process only: they vanish on restart (users sign in
 * again) and are not shared between instances, so never use it with more than one instance.
 *
 * Supported: get, set (EX, PX, NX, XX, KEEPTTL, GET is not), del, incr, expire, exists, ping,
 * keys, scanStream({ match }), quit, disconnect, on.
 */
export class MemoryRedis {
  #data = new Map(); // key -> { value: string, expiresAt: number | null }

  #live(key) {
    const e = this.#data.get(key);
    if (!e) return null;
    if (e.expiresAt != null && e.expiresAt <= Date.now()) {
      this.#data.delete(key);
      return null;
    }
    return e;
  }

  async get(key) {
    return this.#live(key)?.value ?? null;
  }

  async set(key, value, ...args) {
    const opts = args.map((a) => (typeof a === 'string' ? a.toUpperCase() : a));
    const old = this.#live(key);
    if (opts.includes('NX') && old) return null;
    if (opts.includes('XX') && !old) return null;
    let expiresAt = null;
    const ex = opts.indexOf('EX');
    const px = opts.indexOf('PX');
    if (ex >= 0) expiresAt = Date.now() + Number(opts[ex + 1]) * 1000;
    else if (px >= 0) expiresAt = Date.now() + Number(opts[px + 1]);
    else if (opts.includes('KEEPTTL')) expiresAt = old?.expiresAt ?? null;
    this.#data.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async del(...keys) {
    let n = 0;
    for (const k of keys.flat()) if (this.#live(k) && this.#data.delete(k)) n += 1;
    return n;
  }

  async incr(key) {
    const e = this.#live(key);
    const next = (e ? Number(e.value) : 0) + 1;
    this.#data.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
    return next;
  }

  async expire(key, seconds) {
    const e = this.#live(key);
    if (!e) return 0;
    e.expiresAt = Date.now() + Number(seconds) * 1000;
    return 1;
  }

  async exists(...keys) {
    return keys.flat().filter((k) => this.#live(k)).length;
  }

  async ping() {
    return 'PONG';
  }

  async keys(pattern = '*') {
    const rx = globToRegExp(pattern);
    return [...this.#data.keys()].filter((k) => this.#live(k) && rx.test(k));
  }

  /** Like ioredis scanStream: emits arrays of matching keys. */
  scanStream({ match = '*' } = {}) {
    const self = this;
    let done = false;
    return new Readable({
      objectMode: true,
      async read() {
        if (done) return this.push(null);
        done = true;
        this.push(await self.keys(match));
      },
    });
  }

  on() {
    return this;
  }

  async quit() {
    return 'OK';
  }

  disconnect() {}
}

function globToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}
