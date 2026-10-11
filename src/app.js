import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { httpLogger, requestId } from './core/observability/http.js';
import { errorHandler, notFoundHandler } from './core/errors/index.js';
import { tenantResolver } from './core/tenancy/tenantResolver.js';
import { authenticate } from './core/auth/authenticate.js';
import { authPublicRoutes, authRoutes } from './core/auth/auth.routes.js';
import { approvalRoutes, approvalRuleRoutes } from './core/approvals/approval.routes.js';
import { auditRoutes } from './core/audit/audit.routes.js';
import { apiLimiter, loginLimiters, signupLimiter } from './core/security/rateLimit.js';
import { API_DOCS, buildOpenApi } from './core/http/openapi.js';
import { redis } from './core/cache/redis.js';
import { mountModules, mountPublicModules } from './modules/index.js';
import { fileRoutes, localStorageRouter } from './core/files/files.routes.js';
import { servesFiles } from './core/files/storage.js';
import {
  consoleRouter,
  hospitalSubscriptionRoutes,
  publicRouter,
  webhookRouter,
} from './platform/routes.js';

/**
 * Middleware chain from the spec, section "Request lifecycle".
 * `extraRouters` lets tests mount routes defined with defineRoutes().
 */
export function createApp({ extraRouters = [] } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY); // CloudFront -> ALB
  app.set('query parser', 'extended');

  app.use(requestId);
  app.use(httpLogger);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })); // API returns JSON only
  // Files kept by the API (local disk, or MongoDB on hosts without S3) stream raw bytes, so the
  // signed upload and download URLs sit before the JSON parser.
  if (servesFiles()) app.use(localStorageRouter());
  // Gateway webhooks are signed over the raw body.
  app.use('/api/webhooks', webhookRouter());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Liveness/readiness for the load balancer: no tenant, no auth.
  app.get('/api/health', async (_req, res) => {
    const db = mongoose.connection.readyState === 1;
    const cache = await redis()
      .ping()
      .then((r) => r === 'PONG')
      .catch(() => false);
    res
      .status(db && cache ? 200 : 503)
      .json({ status: db && cache ? 'ok' : 'degraded', db, cache });
  });

  if (env.ENABLE_API_DOCS) {
    app.get('/api/docs/openapi.json', (_req, res) => res.json(buildOpenApi()));
    for (const [name, doc] of Object.entries(API_DOCS))
      app.get(`/api/docs/${name}.json`, (_req, res) => res.json(buildOpenApi(doc)));
    app.use(
      '/api/docs',
      swaggerUi.serve,
      swaggerUi.setup(null, {
        swaggerOptions: {
          urls: Object.entries(API_DOCS).map(([name, d]) => ({
            name: d.title,
            url: `/api/docs/${name}.json`,
          })),
        },
      }),
    );
  }

  // SaaS platform: public signup (marketing site) and the operator console.
  app.use('/api/public', signupLimiter(), publicRouter());
  app.use('/api/platform/auth/login', loginLimiters());
  app.use('/api/platform/auth/2fa/verify', loginLimiters());
  app.use('/api/platform', consoleRouter());

  const v1 = express.Router();
  v1.use(tenantResolver);
  for (const path of [
    '/auth/login',
    '/auth/2fa/verify',
    '/auth/otp/request',
    '/auth/otp/verify',
    '/auth/password/forgot',
    '/auth/password/reset',
    '/auth/invite/accept',
    // Patient-facing: portal sign-in and the feedback link.
    '/portal/auth/otp',
    '/portal/auth/verify',
    '/feedback',
  ])
    v1.use(path, loginLimiters());
  v1.use(authPublicRoutes);
  v1.use(mountPublicModules());
  v1.use(authenticate);
  v1.use(apiLimiter());
  v1.use(authRoutes);
  v1.use(approvalRoutes);
  v1.use(approvalRuleRoutes);
  v1.use(auditRoutes);
  v1.use(fileRoutes);
  v1.use(hospitalSubscriptionRoutes);
  v1.use(mountModules());
  for (const r of extraRouters) v1.use(r);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
