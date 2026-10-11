import { z } from 'zod';

/** Every route registered through defineRoutes(), used to build the OpenAPI document. */
export const routeRegistry = [];

const jsonSchema = (schema) => {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  } catch {
    return {};
  }
};

/** One document per mount point: /api/v1 (hospital), /api/public (signup), /api/platform (console). */
export const API_DOCS = Object.freeze({
  v1: { mount: '/api/v1', title: 'Hospital Management System API' },
  public: { mount: '/api/public', title: 'Public signup API' },
  platform: { mount: '/api/platform', title: 'Platform console API' },
});

export function buildOpenApi({
  mount = '/api/v1',
  title = 'Hospital Management System API',
  version = '1.0.0',
} = {}) {
  const paths = {};
  for (const r of routeRegistry) {
    if ((r.mount ?? '/api/v1') !== mount) continue;
    const path = r.fullPath.replace(/:(\w+)/g, '{$1}');
    const params = [];
    for (const [where, schema] of [
      ['path', r.schema.params],
      ['query', r.schema.query],
    ]) {
      const props = schema ? (jsonSchema(schema).properties ?? {}) : {};
      for (const [name, s] of Object.entries(props))
        params.push({ name, in: where, required: where === 'path', schema: s });
    }
    if (r.idempotent)
      params.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: r.idempotent === 'required',
        schema: { type: 'string' },
      });
    paths[path] ??= {};
    paths[path][r.method] = {
      summary: r.summary,
      tags: [r.module],
      description: [
        `Module: ${r.module}`,
        `Permission: ${[].concat(r.permission).join(' or ')}`,
        r.audit ? `Audited as ${r.audit}` : null,
      ]
        .filter(Boolean)
        .join('. '),
      parameters: params,
      ...(r.schema.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: jsonSchema(r.schema.body) } },
            },
          }
        : {}),
      responses: {
        [r.status ?? 200]: {
          description: 'OK',
          ...(r.schema.response
            ? { content: { 'application/json': { schema: jsonSchema(r.schema.response) } } }
            : {}),
        },
        default: {
          description: 'Error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title, version },
    servers: [{ url: mount }],
    paths,
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { path: { type: 'string' }, message: { type: 'string' } },
                  },
                },
                requestId: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}
