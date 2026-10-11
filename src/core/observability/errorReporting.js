import { env } from '../../config/env.js';
import { logger } from './logger.js';

/**
 * Error tracking (Sentry), on only when SENTRY_DSN is set. Patient data never leaves: request
 * bodies, cookies, headers and query strings are dropped before an event is sent; an event
 * carries the error, its stack, the request id and the hospital id.
 */
let sentry = null;

function scrub(event) {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
  }
  delete event.user;
  return event;
}

export async function initErrorReporting(service) {
  if (!env.SENTRY_DSN || sentry) return;
  try {
    const S = await import('@sentry/node');
    S.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      serverName: service,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: scrub,
    });
    sentry = S;
    logger.info({ service }, 'Error reporting on');
  } catch (err) {
    logger.warn({ err }, 'Error reporting could not start');
  }
}

/** Sends an unexpected error (5xx, crashed job) with its request id and hospital. */
export function reportError(err, { requestId, tenantId, job } = {}) {
  if (!sentry) return;
  sentry.captureException(err, {
    tags: { requestId, tenantId, job },
  });
}
