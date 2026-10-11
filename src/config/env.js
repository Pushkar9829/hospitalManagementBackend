import { z } from 'zod';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    ROOT_DOMAIN: z.string().default('localhost'),
    /** Web address of a hospital for links in SMS and e-mail; {subdomain} is replaced. */
    WEB_URL_TEMPLATE: z.string().default('http://{subdomain}.localhost:5173'),
    /**
     * Proxy hops in front of the API. Production (CloudFront -> ALB) is 2, so req.ip is the real
     * client; 0 locally so a spoofed X-Forwarded-For cannot dodge rate limits.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    JWT_PRIVATE_KEY: z.string().default(''),
    JWT_PUBLIC_KEY: z.string().default(''),
    /** 32-byte key (base64) for encrypting secrets at rest, e.g. TOTP secrets. */
    DATA_ENCRYPTION_KEY: z.string().default(''),
    ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(12),
    IDLE_TIMEOUT_MIN: z.coerce.number().int().min(5).max(120).default(15),
    COOKIE_SECURE: bool.optional(),
    /** none: messages are dropped (a deployment without an SMS gateway yet). */
    SMS_PROVIDER: z.enum(['console', 'none', 'msg91']).default('console'),
    /** The platform company that invoices hospitals (spec 3.5: GST invoice with its GSTIN). */
    PLATFORM_LEGAL_NAME: z.string().default('HMS Cloud Private Limited'),
    PLATFORM_GSTIN: z.string().default(''),
    PLATFORM_STATE: z.string().default('Maharashtra'),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
    AWS_REGION: z.string().default('ap-south-1'),
    S3_DOCS_BUCKET: z.string().default(''),
    /**
     * Where uploaded files live: s3 (AWS), mongo (GridFS in the same database, for hosts
     * without S3 such as Render) or local (development disk).
     */
    STORAGE_DRIVER: z.enum(['s3', 'mongo', 'local']).optional(),
    /** Run the outbox relay and scheduled jobs inside the API process (single-service hosting). */
    RUN_WORKER: bool.optional(),
    /**
     * Hospital (sub-domain) to serve when the address matches none, e.g. a demo deployment on a
     * vercel.app address. Leave empty for normal multi-hospital hosting.
     */
    DEFAULT_TENANT: z.string().default(''),
    /** Requests per minute per user (spec: 600). Raise only on a load-test copy. */
    /** Error tracking (Sentry). Empty: off. */
    SENTRY_DSN: z.string().default(''),
    API_RATE_LIMIT: z.coerce.number().int().min(60).max(1_000_000).default(600),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    ENABLE_API_DOCS: bool.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== 'production') return;
    if (v.TRUST_PROXY === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'Set TRUST_PROXY in production (2 behind Vercel + Render, or CloudFront + ALB)',
      });
    for (const k of ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'DATA_ENCRYPTION_KEY']) {
      if (!v[k])
        ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required in production` });
    }
    if ((v.STORAGE_DRIVER ?? 's3') === 's3' && !v.S3_DOCS_BUCKET)
      ctx.addIssue({
        code: 'custom',
        path: ['S3_DOCS_BUCKET'],
        message: 'S3_DOCS_BUCKET is required in production (or set STORAGE_DRIVER=mongo)',
      });
    if (v.STORAGE_DRIVER === 'local')
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'Local disk storage is for development only',
      });
  });

const here = dirname(fileURLToPath(import.meta.url));
const keyDir = resolve(here, '../../.keys');

/**
 * Development and test get a generated RS256 key pair and data key so the API starts with no
 * secrets. Development keeps them in apps/api/.keys (git-ignored) so sessions survive restarts.
 */
function devSecrets(nodeEnv) {
  const file = resolve(keyDir, 'dev-secrets.json');
  if (nodeEnv === 'development' && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const secrets = { privateKey, publicKey, dataKey: randomBytes(32).toString('base64') };
  if (nodeEnv === 'development') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  }
  return secrets;
}

export function loadEnv(source = process.env) {
  // Hosting dashboards (Atlas, Render) name it MONGODB_URI; both names work.
  const input = { ...source, MONGO_URI: source.MONGO_URI || source.MONGODB_URI };
  const parsed = Env.safeParse(input);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  const v = { ...parsed.data };
  const unescape = (s) => s.replace(/\\n/g, '\n');
  v.JWT_PRIVATE_KEY = unescape(v.JWT_PRIVATE_KEY);
  v.JWT_PUBLIC_KEY = unescape(v.JWT_PUBLIC_KEY);
  if (!v.JWT_PRIVATE_KEY || !v.JWT_PUBLIC_KEY || !v.DATA_ENCRYPTION_KEY) {
    const s = devSecrets(v.NODE_ENV);
    v.JWT_PRIVATE_KEY ||= s.privateKey;
    v.JWT_PUBLIC_KEY ||= s.publicKey;
    v.DATA_ENCRYPTION_KEY ||= s.dataKey;
  }
  if (Buffer.from(v.DATA_ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  }
  v.COOKIE_SECURE ??= v.NODE_ENV === 'production';
  v.ENABLE_API_DOCS ??= v.NODE_ENV !== 'production';
  v.STORAGE_DRIVER ??= v.NODE_ENV === 'production' ? 's3' : 'local';
  v.RUN_WORKER ??= false;
  v.isProd = v.NODE_ENV === 'production';
  v.isTest = v.NODE_ENV === 'test';
  return Object.freeze(v);
}

/** Validated configuration. The process crashes on boot if it is wrong. */
export const env = loadEnv();
