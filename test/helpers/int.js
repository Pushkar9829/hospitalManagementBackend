import { afterAll, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { authenticator } from 'otplib';
import { connectDb, disconnectDb } from '../../src/core/db/connection.js';
import { closeRedis, redis } from '../../src/core/cache/redis.js';
import { createApp } from '../../src/app.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { provisionTenant } from '../../src/core/tenancy/provision.js';
import { User } from '../../src/core/auth/models/user.model.js';
import { Role } from '../../src/core/auth/models/role.model.js';
import { hashPassword } from '../../src/core/auth/password.js';
import { encrypt } from '../../src/core/security/crypto.js';

export const PASSWORD = 'Correct-Horse-9';

/** Connects once per test file and drops the worker database at the end. */
export function useIntegration({ extraRouters } = {}) {
  const state = {};
  beforeAll(async () => {
    await connectDb();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    state.app = createApp({ extraRouters: extraRouters?.() });
  });
  afterAll(async () => {
    await mongoose.connection.db?.dropDatabase();
    await disconnectDb();
    await closeRedis();
  });
  return state;
}

let seq = 0;
/** A hospital with every module unless told otherwise; returns its host for requests. */
export async function makeTenant({
  modules = ['OPD', 'IPD', 'LAB'],
  status = 'ACTIVE',
  settings = { twoFactorRoles: [] },
} = {}) {
  const subdomain = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${seq++}`;
  const out = await provisionTenant({
    name: `Test Hospital ${subdomain}`,
    subdomain,
    modules,
    status,
    settings,
    admin: { name: 'Admin User', username: 'superadmin', mobile: '9000000001', password: PASSWORD },
  });
  await redis().del(`tenant:host:${subdomain}.localhost`);
  return { ...out, host: `${subdomain}.localhost` };
}

/** Adds a user holding the given role codes (role panels) inside the tenant. */
export async function makeUser(
  t,
  { username, roles = ['doctor'], mobile, twoFactorSecret, status = 'ACTIVE', permissions } = {},
) {
  return runAsSystem(t.tenant._id, async () => {
    let roleIds = (
      await Role.find({ code: { $in: roles } })
        .select('_id')
        .lean()
    ).map((r) => r._id);
    if (permissions) {
      const [custom] = await Role.create([
        { code: `custom${seq++}`, name: 'Custom', panel: 'employee', permissions },
      ]);
      roleIds = [custom._id];
    }
    const [user] = await User.create([
      {
        name: `User ${username}`,
        username,
        mobile,
        status,
        passwordHash: await hashPassword(PASSWORD),
        roles: roleIds,
        branchIds: [t.branch._id],
        defaultBranchId: t.branch._id,
        ...(twoFactorSecret
          ? { twoFactor: { enabled: true, secret: encrypt(twoFactorSecret) } }
          : {}),
      },
    ]);
    return user;
  });
}

/** A supertest agent bound to the hospital's host; keeps cookies between calls. */
export function client(app, host) {
  const agent = request.agent(app);
  const wrap = (method) => (path) => agent[method](`/api/v1${path}`).set('Host', host);
  return {
    agent,
    get: wrap('get'),
    post: wrap('post'),
    put: wrap('put'),
    patch: wrap('patch'),
    delete: wrap('delete'),
  };
}

export async function signIn(app, host, username = 'superadmin', password = PASSWORD) {
  const c = client(app, host);
  const res = await c.post('/auth/login').send({ username, password });
  if (res.status !== 200 || !res.body.user)
    throw new Error(`sign-in failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  c.loginRes = res;
  return c;
}

export const totp = (secret) => authenticator.generate(secret);

/** Value of a cookie set by a response. */
export function cookieFrom(res, name) {
  const line = [].concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));
  return line ? decodeURIComponent(line.slice(name.length + 1).split(';')[0]) : undefined;
}

let subscriptionsRegistered = false;
/**
 * Runs the event subscribers for a hospital's pending outbox events, as the worker would
 * (tests have no worker). Repeats until nothing is pending, since handlers publish too.
 */
export async function deliverEvents(tenantId) {
  const { registerSubscriptions } = await import('../../src/modules/index.js');
  const { OutboxEvent } = await import('../../src/core/events/outbox.model.js');
  const { subscribersFor } = await import('../../src/core/events/events.js');
  if (!subscriptionsRegistered) {
    registerSubscriptions();
    subscriptionsRegistered = true;
  }
  let delivered = 0;
  for (let round = 0; round < 5; round++) {
    const events = await runAsSystem(tenantId, () =>
      OutboxEvent.find({ tenantId, status: 'PENDING' }).sort({ createdAt: 1 }).lean().exec(),
    );
    if (!events.length) break;
    for (const ev of events) {
      for (const s of subscribersFor(ev.type))
        await runAsSystem(tenantId, () =>
          s.handler(ev.payload, { eventId: `${ev._id}:${s.name}`, type: ev.type }),
        );
      await runAsSystem(tenantId, () =>
        OutboxEvent.updateOne({ _id: ev._id }, { $set: { status: 'SENT' } }).exec(),
      );
      delivered += 1;
    }
  }
  return delivered;
}
