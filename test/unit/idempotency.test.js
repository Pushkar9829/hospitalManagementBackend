import { afterAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { idempotency } from '../../src/core/security/idempotency.js';
import { runInContext } from '../../src/core/tenancy/context.js';
import { closeRedis } from '../../src/core/cache/redis.js';
import { errorHandler } from '../../src/core/errors/index.js';

afterAll(() => closeRedis());

function billingApp(tenantId = `t-${randomUUID()}`) {
  let bills = 0;
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => runInContext({ tenantId, userId: 'u1' }, () => next()));
  app.post('/bills', idempotency({ required: true }), async (req, res) => {
    await new Promise((r) => setTimeout(r, 50));
    bills += 1;
    res
      .status(201)
      .json({ billNo: `OP/26-27/${String(bills).padStart(6, '0')}`, amount: req.body.amount });
  });
  app.use(errorHandler);
  return { app, count: () => bills };
}

describe('Idempotency-Key', () => {
  it('replays the first result instead of creating a second bill', async () => {
    const { app: ctxApp, count } = billingApp();
    const key = randomUUID();
    const first = await request(ctxApp)
      .post('/bills')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });
    const again = await request(ctxApp)
      .post('/bills')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(count()).toBe(1);
  });

  it('rejects reuse of a key for a different request, and missing keys when required', async () => {
    const { app: ctxApp } = billingApp();
    const key = randomUUID();
    await request(ctxApp).post('/bills').set('Idempotency-Key', key).send({ amount: 100 });
    const other = await request(ctxApp)
      .post('/bills')
      .set('Idempotency-Key', key)
      .send({ amount: 999 });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await request(ctxApp).post('/bills').send({ amount: 1 })).status).toBe(400);
  });

  it('answers 409 while the same request is still running', async () => {
    const { app: ctxApp, count } = billingApp();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      request(ctxApp).post('/bills').set('Idempotency-Key', key).send({ amount: 5 }),
      request(ctxApp).post('/bills').set('Idempotency-Key', key).send({ amount: 5 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(count()).toBe(1);
  });
});
