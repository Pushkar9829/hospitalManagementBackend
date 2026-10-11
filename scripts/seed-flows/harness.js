/**
 * Harness for the flow seeds: drives the real API in-process (supertest) as the demo hospital's
 * role logins, so seeded data goes through the same rules, approvals and postings as real use.
 * Development only.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import { env } from '../../src/config/env.js';
import { connectDb, disconnectDb } from '../../src/core/db/connection.js';
import { closeRedis } from '../../src/core/cache/redis.js';
import { createApp } from '../../src/app.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Tenant } from '../../src/core/tenancy/tenant.model.js';
import { registerSubscriptions } from '../../src/modules/index.js';
import { OutboxEvent } from '../../src/core/events/outbox.model.js';
import { subscribersFor } from '../../src/core/events/events.js';

if (env.isProd) throw new Error('flow seeds must never run in production');

const HOST = 'demo.localhost';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo@12345';

export const istDay = (offset = 0) =>
  new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
export const istMonth = (offset = 0) => {
  const d = new Date(Date.now() + 330 * 60_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
};

/** A failed call stops the section with the response, so problems are seen, not skipped. */
export function ok(res, ...statuses) {
  const want = statuses.length ? statuses : [200, 201, 202];
  if (!want.includes(res.status)) {
    const e = new Error(
      `${res.req?.method} ${res.req?.path} → ${res.status} ${JSON.stringify(res.body).slice(0, 600)}`,
    );
    e.status = res.status;
    e.body = res.body;
    throw e;
  }
  return res.body;
}

export async function boot() {
  await connectDb();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const app = createApp();
  const tenant = await Tenant.findOne({ subdomain: 'demo' }).lean();
  if (!tenant) throw new Error('Run npm run seed:dev first: there is no demo hospital.');
  registerSubscriptions();
  const clients = new Map();

  /** A signed-in client for a demo login (username = panel key). */
  async function as(username) {
    if (clients.has(username)) return clients.get(username);
    const agent = request.agent(app);
    const wrap = (method) => (path) => agent[method](`/api/v1${path}`).set('Host', HOST);
    const c = {
      get: wrap('get'),
      post: wrap('post'),
      put: wrap('put'),
      patch: wrap('patch'),
      delete: wrap('delete'),
    };
    const res = await c.post('/auth/login').send({ username, password: PASSWORD });
    if (res.status !== 200)
      throw new Error(`sign-in ${username}: ${res.status} ${JSON.stringify(res.body)}`);
    c.user = res.body.user;
    clients.set(username, c);
    return c;
  }

  /** Approves a request at its current level as the given login. */
  async function approve(username, approvalId, note = 'Approved (demo)') {
    const c = await as(username);
    const a = ok(await c.get(`/approvals/${approvalId}`));
    return ok(
      await c
        .post(`/approvals/${approvalId}/decision`)
        .send({ decision: 'APPROVE', version: a.version, comment: note }),
    );
  }

  /** Runs pending outbox events through their subscribers (what the worker does). */
  async function deliver() {
    for (let round = 0; round < 6; round++) {
      const events = await runAsSystem(tenant._id, () =>
        OutboxEvent.find({ tenantId: tenant._id, status: 'PENDING' })
          .sort({ createdAt: 1 })
          .lean()
          .exec(),
      );
      if (!events.length) return;
      for (const ev of events) {
        for (const s of subscribersFor(ev.type))
          await runAsSystem(tenant._id, async () => {
            try {
              await s.handler(ev.payload, { eventId: `${ev._id}:${s.name}`, type: ev.type });
            } catch (e) {
              console.warn(`  event ${ev.type} → ${s.name}: ${e.message}`);
            }
          });
        await runAsSystem(tenant._id, () =>
          OutboxEvent.updateOne({ _id: ev._id }, { $set: { status: 'SENT' } }).exec(),
        );
      }
    }
  }

  const system = (fn) => runAsSystem(tenant._id, fn);

  async function done() {
    await deliver();
    await disconnectDb();
    await closeRedis();
  }

  return { app, tenant, as, approve, deliver, system, done };
}

/** Runs named sections in order; a failing section is reported and the rest still run. */
export async function runSections(h, sections) {
  const results = [];
  for (const [name, fn] of sections) {
    const t0 = Date.now();
    try {
      const note = await fn(h);
      results.push([name, 'ok', note ?? '', Date.now() - t0]);
      console.log(`✔ ${name}${note ? `: ${note}` : ''}`);
    } catch (e) {
      results.push([name, 'FAILED', e.message, Date.now() - t0]);
      console.log(`✘ ${name}: ${e.message}`);
    }
    await h.deliver();
  }
  return results;
}
