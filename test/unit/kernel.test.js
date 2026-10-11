import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import mongoose from 'mongoose';
import { loadEnv } from '../../src/config/env.js';
import { AppError, errorHandler } from '../../src/core/errors/index.js';
import { validate } from '../../src/core/http/validate.js';
import { authorize, requireModule } from '../../src/core/rbac/guards.js';
import { runInContext } from '../../src/core/tenancy/context.js';
import { subdomainOf } from '../../src/core/tenancy/tenant.registry.js';
import { decrypt, encrypt } from '../../src/core/security/crypto.js';
import { sanitise } from '../../src/core/audit/audit.service.js';
import { requestId } from '../../src/core/observability/http.js';

function appWith(ctx, ...mw) {
  const app = express();
  app.use(express.json(), requestId);
  app.use((req, _res, next) => runInContext({ tenantId: 't1', ...ctx }, () => next()));
  app.post('/x', ...mw, (req, res) => res.json({ ok: true, valid: req.valid }));
  app.use(errorHandler);
  return app;
}

describe('configuration', () => {
  it('refuses to start production without secrets', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', MONGO_URI: 'mongodb://x', REDIS_URL: 'redis://x' }),
    ).toThrow(/JWT_PRIVATE_KEY is required/);
  });
  it('generates keys outside production and secures cookies only in production', () => {
    const e = loadEnv({ NODE_ENV: 'test', MONGO_URI: 'mongodb://x', REDIS_URL: 'redis://x' });
    expect(e.JWT_PRIVATE_KEY).toMatch(/BEGIN PRIVATE KEY/);
    expect(e.COOKIE_SECURE).toBe(false);
  });
});

describe('errors and validation', () => {
  it('answers in the spec error format with the request id', async () => {
    const app = appWith({}, () => {
      throw new AppError(409, 'BED_NOT_AVAILABLE', 'Bed was just taken');
    });
    const res = await request(app).post('/x').set('x-request-id', 'req-12345678');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'BED_NOT_AVAILABLE',
        message: 'Bed was just taken',
        requestId: 'req-12345678',
      },
    });
  });

  it('maps Mongoose version conflicts to 409 and hides unknown errors', async () => {
    const vc = await request(
      appWith({}, () => {
        throw new mongoose.Error.VersionError({ _doc: { _id: 1 } }, 1, []);
      }),
    ).post('/x');
    expect(vc.body.error.code).toBe('VERSION_CONFLICT');
    const boom = await request(
      appWith({}, () => {
        throw new Error('db password is hunter2');
      }),
    ).post('/x');
    expect(boom.status).toBe(500);
    expect(boom.body.error.message).not.toMatch(/hunter2/);
  });

  it('returns 422 with field details', async () => {
    const app = appWith(
      {},
      validate({ body: z.object({ mobile: z.string().length(10, 'Must be 10 digits') }) }),
    );
    const res = await request(app).post('/x').send({ mobile: '123' });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([{ path: 'mobile', message: 'Must be 10 digits' }]);
  });
});

describe('guards', () => {
  it('402 for an unsubscribed module, CORE always allowed', async () => {
    const r = await request(appWith({ modules: new Set(['IPD']) }, requireModule('OPD'))).post(
      '/x',
    );
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe('MODULE_NOT_SUBSCRIBED');
    expect(
      (await request(appWith({ modules: new Set() }, requireModule('CORE'))).post('/x')).status,
    ).toBe(200);
  });

  it('403 without the permission, wildcards allowed', async () => {
    const denied = await request(
      appWith(
        { tenantId: null, permissions: new Set(['opd:visit:read']) },
        authorize('opd:visit:create'),
      ),
    ).post('/x');
    expect(denied.status).toBe(403);
    const allowed = await request(
      appWith({ permissions: new Set(['opd:*']) }, authorize('opd:visit:create')),
    ).post('/x');
    expect(allowed.status).toBe(200);
  });
});

describe('helpers', () => {
  it('resolves hospital sub-domains', () => {
    expect(subdomainOf('citycare.example.com', 'example.com')).toBe('citycare');
    expect(subdomainOf('demo.localhost:5173', 'localhost')).toBe('demo');
    expect(subdomainOf('a.b.example.com', 'example.com')).toBeNull();
    expect(subdomainOf('hospital.in', 'example.com')).toBeNull();
  });

  it('encrypts secrets with authentication', () => {
    const box = encrypt('JBSWY3DPEHPK3PXP');
    expect(box).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decrypt(box)).toBe('JBSWY3DPEHPK3PXP');
    const tampered = box.slice(0, -2) + (box.endsWith('A') ? 'BB' : 'AA');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('never stores secrets in the audit log', () => {
    expect(
      sanitise({ name: 'A', passwordHash: 'x', twoFactor: { secret: 's' }, nested: { otp: '1' } }),
    ).toEqual({
      name: 'A',
      passwordHash: '[redacted]',
      twoFactor: { secret: '[redacted]' },
      nested: { otp: '[redacted]' },
    });
  });
});

describe('request log redaction', () => {
  it('keeps paths and safe paging keys, masks searches and one-time links', async () => {
    const { redactUrl } = await import('../../src/core/observability/http.js');
    expect(redactUrl('/api/v1/patients?q=Ravi%20Kumar&mobile=9876543210&page=2')).toBe(
      '/api/v1/patients?q=[redacted]&mobile=[redacted]&page=2',
    );
    expect(redactUrl('/api/v1/auth/invite/abcDEF123456789012345')).toBe(
      '/api/v1/auth/invite/[redacted]',
    );
    expect(redactUrl('/api/v1/billing/bills/66aa')).toBe('/api/v1/billing/bills/66aa');
  });
});
