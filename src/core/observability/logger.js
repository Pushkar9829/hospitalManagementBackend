import pino from 'pino';
import { env } from '../../config/env.js';

/** Pretty logs in development when pino-pretty is installed (it is not in the production image). */
function prettyTransport() {
  if (env.NODE_ENV !== 'development') return undefined;
  try {
    import.meta.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { singleLine: true } };
  } catch {
    return undefined;
  }
}

/**
 * Structured JSON logs (CloudWatch in production). Patient clinical data and secrets must never
 * be logged: these paths are redacted as a safety net.
 */
export const logger = pino({
  level: env.isTest ? (process.env.TEST_LOG ?? 'silent') : env.LOG_LEVEL,
  base: { service: 'hms-api' },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.newPassword',
      '*.currentPassword',
      '*.otp',
      '*.secret',
      '*.token',
    ],
    censor: '[redacted]',
  },
  transport: prettyTransport(),
});
