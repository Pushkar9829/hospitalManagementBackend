import { describe, expect, it } from 'vitest';
import mongoose, { Schema } from 'mongoose';
import { z } from 'zod';
import { client, makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { defineRoutes } from '../../src/core/http/route.js';
import {
  PLATFORM_MODELS,
  defineModel,
  updateVersioned,
  withTransaction,
} from '../../src/core/db/model.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { AuditLog } from '../../src/core/audit/audit.model.js';
import { Tenant } from '../../src/core/tenancy/tenant.model.js';
import { provisionTenant } from '../../src/core/tenancy/provision.js';
import { tenantRegistry } from '../../src/core/tenancy/tenant.registry.js';
import { documentNumber, nextNumber, nextUhid } from '../../src/core/sequences/sequence.service.js';
import { OutboxEvent } from '../../src/core/events/outbox.model.js';
import { publish, subscribe } from '../../src/core/events/events.js';
import { relayOnce } from '../../src/core/events/relay.js';

const Note = defineModel(
  'TestNote',
  new Schema({ text: String, amount: Number }).index({ tenantId: 1, text: 1 }),
);

const opdRoutes = () => [
  defineRoutes({
    module: 'OPD',
    basePath: '/test-opd',
    routes: [
      {
        method: 'get',
        path: '/visits',
        permission: 'opd:visit:read',
        audit: null,
        summary: 'test',
        handler: () => ({ ok: true }),
      },
      {
        method: 'post',
        path: '/notes',
        permission: 'opd:visit:create',
        audit: 'CREATE',
        summary: 'test',
        idempotent: 'optional',
        status: 201,
        schema: { body: z.object({ text: z.string().min(1) }) },
        handler: async (req) => {
          const n = await Note.create({ text: req.valid.body.text });
          return { id: String(n._id) };
        },
      },
    ],
  }),
];

const ctx = useIntegration({ extraRouters: opdRoutes });
const as = (t, fn) => runAsSystem(t.tenant._id, fn);

describe('tenant isolation', () => {
  it('scopes every query to the current hospital and blocks cross-tenant access', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const noteA = await as(a, () => Note.create({ text: 'a-only', amount: 1 }));
    await as(b, () => Note.create({ text: 'b-only', amount: 2 }));
    expect(await as(b, async () => Note.findById(noteA._id))).toBeNull();
    expect(await as(b, async () => Note.countDocuments())).toBe(1);
    expect(
      await as(b, async () =>
        Note.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
      ),
    ).toEqual([{ _id: null, total: 2 }]);
    const upd = await as(b, async () => Note.updateMany({}, { $set: { text: 'x' } }));
    expect(upd.modifiedCount).toBe(1);
    await expect(as(b, async () => Note.find({ tenantId: a.tenant._id }))).rejects.toThrow(
      /Cross-tenant/,
    );
    await expect(Note.find({}).exec()).rejects.toThrow(/No request context/);
  });

  it('refuses $lookup joins that could read another hospital', async () => {
    const t = await makeTenant();
    await as(t, async () => {
      const byId = Note.aggregate([
        { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'u' } },
      ]);
      await expect(byId.exec()).resolves.toBeInstanceOf(Array);
      const byCode = Note.aggregate([
        { $lookup: { from: 'roles', localField: 'text', foreignField: 'code', as: 'r' } },
      ]);
      await expect(byCode.exec()).rejects.toThrow(/must join on _id or match tenantId/);
      const scoped = Note.aggregate([
        {
          $lookup: {
            from: 'roles',
            let: { c: '$text' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ['$code', '$$c'] }, { $eq: ['$tenantId', t.tenant._id] }],
                  },
                },
              },
              { $match: { tenantId: t.tenant._id } },
            ],
            as: 'r',
          },
        },
      ]);
      await expect(scoped.exec()).resolves.toBeInstanceOf(Array);
    });
  });

  it('provisions a hospital all-or-nothing', async () => {
    const subdomain = `broken${Date.now().toString(36)}`;
    await expect(
      provisionTenant({
        name: 'Broken',
        subdomain,
        admin: { name: 'X', username: 'BAD USER NAME', password: 'Whatever-123' },
      }),
    ).rejects.toThrow(/username/);
    expect(await Tenant.exists({ subdomain })).toBeNull();
  });

  it('every tenant collection index starts with tenantId', () => {
    for (const [name, model] of Object.entries(mongoose.models)) {
      if (PLATFORM_MODELS.has(name) || name === 'OutboxEvent' || !model.schema.path('tenantId'))
        continue;
      for (const [fields, opts] of model.schema.indexes()) {
        if (opts?.expireAfterSeconds !== undefined) continue;
        expect(Object.keys(fields)[0], `${name} ${JSON.stringify(fields)}`).toBe('tenantId');
      }
    }
  });

  it('answers 404 for an unknown hospital and 402 for suspended or read-only ones', async () => {
    expect((await client(ctx.app, 'nobody.localhost').get('/auth/me')).body.error.code).toBe(
      'TENANT_NOT_FOUND',
    );
    const t = await makeTenant();
    const c = await signIn(ctx.app, t.host);
    await Tenant.updateOne({ _id: t.tenant._id }, { $set: { status: 'READ_ONLY' } });
    await tenantRegistry.invalidate(t.tenant);
    expect((await c.get('/auth/me')).status).toBe(200);
    const write = await c.post('/test-opd/notes').send({ text: 'x' });
    expect(write.status).toBe(402);
    expect(write.body.error.code).toBe('TENANT_READ_ONLY');
    await Tenant.updateOne({ _id: t.tenant._id }, { $set: { status: 'SUSPENDED' } });
    await tenantRegistry.invalidate(t.tenant);
    expect((await c.get('/audit')).body.error.code).toBe('TENANT_SUSPENDED');
    // Staff can still sign in, so the Super Admin can reach the subscription page and pay.
    expect((await c.get('/auth/me')).status).toBe(200);
  });
});

describe('module gate and permissions', () => {
  it('402 when the module is not subscribed, 403 without permission (audited), 200 with it', async () => {
    const noOpd = await makeTenant({ modules: ['IPD'] });
    const c1 = await signIn(ctx.app, noOpd.host);
    expect((await c1.get('/test-opd/visits')).body.error.code).toBe('MODULE_NOT_SUBSCRIBED');

    const t = await makeTenant({ modules: ['OPD'] });
    await makeUser(t, { username: 'cook', roles: ['kitchen'] });
    const cook = await signIn(ctx.app, t.host, 'cook');
    const denied = await cook.get('/test-opd/visits');
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/opd:visit:read/);
    expect(await as(t, async () => AuditLog.countDocuments({ action: 'ACCESS_DENIED' }))).toBe(1);

    await makeUser(t, { username: 'frontdesk', permissions: ['opd:visit:*'] });
    const fo = await signIn(ctx.app, t.host, 'frontdesk');
    expect((await fo.get('/test-opd/visits')).status).toBe(200);
    expect((await fo.post('/test-opd/notes').send({ text: '' })).status).toBe(422);
    expect((await fo.post('/test-opd/notes').send({ text: 'ok' })).status).toBe(201);
  });

  it('rejects a branch the user does not belong to', async () => {
    const t = await makeTenant();
    await makeUser(t, { username: 'doc' });
    const c = await signIn(ctx.app, t.host, 'doc');
    const res = await c
      .get('/auth/me')
      .set('x-branch-id', new mongoose.Types.ObjectId().toString());
    expect(res.status).toBe(403);
  });
});

describe('data plugins', () => {
  it('rolls back a nested transaction when the outer one fails', async () => {
    const t = await makeTenant();
    await expect(
      as(t, () =>
        withTransaction(async () => {
          await withTransaction(() => Note.create([{ text: 'inner', amount: 1 }]));
          throw new Error('outer fails');
        }),
      ),
    ).rejects.toThrow('outer fails');
    expect(await as(t, () => Note.countDocuments({ text: 'inner' }).exec())).toBe(0);
  });

  it('audits create and update with before/after values and the user', async () => {
    const t = await makeTenant();
    const note = await as(t, () => Note.create({ text: 'v1', amount: 10 }));
    await as(t, async () => {
      const n = await Note.findById(note._id);
      n.text = 'v2';
      await n.save();
    });
    const log = await as(t, async () =>
      AuditLog.find({ entity: 'TestNote', entityId: String(note._id) })
        .sort({ at: 1 })
        .lean(),
    );
    expect(log.map((l) => l.action)).toEqual(['CREATE', 'UPDATE']);
    expect(log[1].before).toEqual({ text: 'v1' });
    expect(log[1].after).toEqual({ text: 'v2' });
    await expect(
      as(t, async () => AuditLog.updateMany({}, { $set: { action: 'X' } })),
    ).rejects.toThrow(/append-only/);
  });

  it('detects concurrent edits with the version field', async () => {
    const t = await makeTenant();
    const note = await as(t, () => Note.create({ text: 'v1' }));
    await as(t, async () => {
      const first = await Note.findById(note._id);
      const second = await Note.findById(note._id);
      first.text = 'from desk 1';
      await first.save();
      second.text = 'from desk 2';
      await expect(second.save()).rejects.toThrow(mongoose.Error.VersionError);
      await expect(updateVersioned(Note, note._id, 0, { text: 'stale' })).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
      });
      const fresh = await updateVersioned(Note, note._id, first.version, { text: 'ok' });
      expect(fresh.text).toBe('ok');
    });
  });

  it('hides soft-deleted records unless asked', async () => {
    const t = await makeTenant();
    await as(t, async () => {
      const n = await Note.create({ text: 'to delete' });
      await n.softDelete();
      expect(await Note.findById(n._id)).toBeNull();
      expect(await Note.findById(n._id).setOptions({ withDeleted: true })).not.toBeNull();
    });
  });
});

describe('numbering', () => {
  it('never hands out the same number twice under concurrency', async () => {
    const t = await makeTenant();
    const numbers = await as(t, () =>
      Promise.all(Array.from({ length: 40 }, () => nextNumber('OP', { fy: '26-27' }))),
    );
    expect(new Set(numbers).size).toBe(40);
    expect(Math.max(...numbers)).toBe(40);
    const other = await makeTenant();
    expect(await runAsSystem(other.tenant._id, () => nextNumber('OP', { fy: '26-27' }))).toBe(1);
  });

  it('formats bill numbers and UHIDs', async () => {
    const t = await makeTenant();
    await as(t, async () => {
      expect(await documentNumber('OP', { perBranch: false, date: new Date('2026-10-09') })).toBe(
        'OP/26-27/000001',
      );
      expect(await nextUhid()).toBe('CC0000001');
    });
  });

  it('rolls numbers back with the transaction', async () => {
    const t = await makeTenant();
    await as(t, async () => {
      await expect(
        withTransaction(async () => {
          await nextNumber('IP', { fy: '26-27' });
          throw new Error('admission failed');
        }),
      ).rejects.toThrow('admission failed');
      expect(await nextNumber('IP', { fy: '26-27' })).toBe(1);
    });
  });
});

describe('domain events', () => {
  it('stores events only when the transaction commits, then relays them once per subscriber', async () => {
    const t = await makeTenant();
    await as(t, async () => {
      await withTransaction(async () => {
        await Note.create([{ text: 'committed' }]);
        await publish('test.noted', { text: 'committed' });
      });
      await expect(
        withTransaction(async () => {
          await publish('test.noted', { text: 'rolled back' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });
    const events = await OutboxEvent.find({ tenantId: t.tenant._id, type: 'test.noted' }).lean();
    expect(events.map((e) => e.payload.text)).toEqual(['committed']);

    subscribe('test.noted', 'test-handler', () => {});
    const added = [];
    const fakeQueue = { addBulk: async (jobs) => added.push(...jobs) };
    await relayOnce(fakeQueue);
    const mine = added.filter((j) => j.data.tenantId === String(t.tenant._id));
    expect(mine).toHaveLength(1);
    expect(mine[0].opts.jobId).toBe(`${events[0]._id}__test-handler`);
    expect((await OutboxEvent.findById(events[0]._id).lean()).status).toBe('SENT');
  });
});
