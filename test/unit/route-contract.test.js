import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineRoutes } from '../../src/core/http/route.js';
import { buildOpenApi, routeRegistry } from '../../src/core/http/openapi.js';
import { createApp } from '../../src/app.js';

const ok = {
  method: 'get',
  path: '/x',
  permission: 'opd:visit:read',
  audit: null,
  summary: 'x',
  handler: () => ({}),
};

describe('route contract', () => {
  it('rejects routes that do not declare module, permission, audit or summary', () => {
    expect(() => defineRoutes({ module: 'NOPE', routes: [ok] })).toThrow(/unknown module/);
    expect(() =>
      defineRoutes({ module: 'OPD', routes: [{ ...ok, permission: undefined }] }),
    ).toThrow(/permission/);
    expect(() => defineRoutes({ module: 'OPD', routes: [{ ...ok, permission: 'self' }] })).toThrow(
      /permission/,
    );
    const { audit: _a, ...noAudit } = ok;
    expect(() => defineRoutes({ module: 'OPD', routes: [noAudit] })).toThrow(/audit/);
    expect(() => defineRoutes({ module: 'OPD', routes: [{ ...ok, audit: 'MAYBE' }] })).toThrow(
      /audit/,
    );
    expect(() => defineRoutes({ module: 'OPD', routes: [{ ...ok, summary: '' }] })).toThrow(
      /summary/,
    );
    expect(() => defineRoutes({ module: 'OPD', routes: [{ ...ok, method: 'post' }] })).toThrow(
      /body or params/,
    );
  });

  it('every route in the app declares its module, permission and audit action', () => {
    createApp();
    expect(routeRegistry.length).toBeGreaterThan(10);
    for (const r of routeRegistry) {
      expect(r.module, r.fullPath).toBeTruthy();
      expect(r.permission.length, r.fullPath).toBeGreaterThan(0);
      expect('audit' in r, r.fullPath).toBe(true);
    }
  });

  it('documents every route in OpenAPI 3.1', () => {
    defineRoutes({
      module: 'OPD',
      basePath: '/demo',
      routes: [
        {
          ...ok,
          method: 'post',
          audit: 'CREATE',
          idempotent: 'required',
          schema: { params: z.object({ id: z.string() }), body: z.object({ amount: z.number() }) },
          path: '/:id',
        },
      ],
    });
    const doc = buildOpenApi();
    expect(doc.openapi).toBe('3.1.0');
    const op = doc.paths['/demo/{id}'].post;
    expect(op.parameters.map((p) => p.name)).toEqual(
      expect.arrayContaining(['id', 'Idempotency-Key']),
    );
    expect(op.requestBody.content['application/json'].schema.properties.amount.type).toBe('number');
    expect(doc.paths['/auth/login'].post.summary).toMatch(/Sign in/);
  });
});
