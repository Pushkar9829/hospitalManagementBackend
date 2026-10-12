import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeTenant, useIntegration } from '../helpers/int.js';

const ctx = useIntegration();

describe('CORS', () => {
  it('lets another origin call the API with cookies and answers the preflight', async () => {
    const t = await makeTenant();
    const origin = 'https://hms-demo.example.app';
    const pre = await request(ctx.app)
      .options('/api/v1/auth/login')
      .set('Host', t.host)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type, idempotency-key');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(origin);
    expect(pre.headers['access-control-allow-credentials']).toBe('true');
    expect(pre.headers['access-control-allow-headers']).toBe('content-type, idempotency-key');

    const res = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('Host', t.host)
      .set('Origin', origin)
      .send({ username: 'nobody', password: 'wrong-password-1' });
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });
});
