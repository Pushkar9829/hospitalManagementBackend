/**
 * Platform console demo: the demo hospital's subscription, two hospitals that signed up for a
 * trial (one converted to a paid plan, one still on trial) and their platform invoices.
 * The console sign-in uses the ops login and authenticator secret from the repo's git-ignored
 * .dev-login.txt (never printed).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { authenticator } from 'otplib';
import { redis } from '../../src/core/cache/redis.js';
import { ok } from './harness.js';

const CONSOLE = 'console.localhost';

function consoleLogin() {
  const text = readFileSync(resolve('..', '.dev-login.txt'), 'utf8');
  const email = text.match(/email\s+(\S+?),/)?.[1];
  const password = text.match(/email\s+\S+,\s*password\s+(\S+?),/)?.[1];
  const secret = text.match(/authenticator secret\s+([A-Z2-7]+)/)?.[1];
  if (!email || !password || !secret) throw new Error('Console login not found in .dev-login.txt');
  return { email, password, secret };
}

async function consoleClient(app) {
  const { email, password, secret } = consoleLogin();
  const agent = request.agent(app);
  const step1 = ok(
    await agent.post('/api/platform/auth/login').set('Host', CONSOLE).send({ email, password }),
  );
  ok(
    await agent
      .post('/api/platform/auth/2fa/verify')
      .set('Host', CONSOLE)
      .send({ challengeId: step1.challengeId, code: authenticator.generate(secret) }),
  );
  const wrap = (m) => (p) => agent[m](`/api/platform${p}`).set('Host', CONSOLE);
  return { get: wrap('get'), post: wrap('post'), put: wrap('put') };
}

/** Signs a hospital up for a trial. The SMS OTP step is stood in for by a verified-mobile token. */
async function signup(app, { subdomain, name, city, state, contact, mobile }) {
  const token = `otp_${randomBytes(18).toString('hex')}`;
  await redis().set(`signup:token:${token}`, mobile, 'EX', 600);
  const keys = await redis().keys('rl:signup:*');
  if (keys.length) await redis().del(...keys);
  return ok(
    await request(app)
      .post('/api/public/signup')
      .send({
        contact: { name: contact, email: `${subdomain}@example.in`, mobile, otpToken: token },
        hospital: { name, city, state, beds: 40 },
        subdomain,
        plan: 'HOSPITAL',
        acceptTermsVersion: '2026-01',
      }),
    202,
  );
}

export const sections = [
  [
    'demo subscription',
    async (h) => {
      const sa = await h.as('superadmin');
      const s = ok(await sa.get('/subscription'));
      return `${s.planName}, ${s.status}`;
    },
  ],
  [
    'trial signups',
    async (h) => {
      const con = await consoleClient(h.app);
      const list = ok(await con.get('/tenants?limit=50'));
      const have = new Set((list.items ?? []).map((t) => t.subdomain));
      const added = [];
      for (const s of [
        {
          subdomain: 'sunrise',
          name: 'Sunrise Hospital',
          city: 'Pune',
          state: 'Maharashtra',
          contact: 'Dr Meera Rao',
          mobile: '9822000101',
        },
        {
          subdomain: 'lotus',
          name: 'Lotus Multispeciality Clinic',
          city: 'Bengaluru',
          state: 'Karnataka',
          contact: 'Dr Kiran Shetty',
          mobile: '9845000202',
        },
      ]) {
        if (have.has(s.subdomain)) continue;
        await signup(h.app, s);
        added.push(s.subdomain);
      }
      return added.length ? `signed up ${added.join(', ')}` : 'skipped';
    },
  ],
  [
    'convert and pay',
    async (h) => {
      const con = await consoleClient(h.app);
      const list = ok(await con.get('/tenants?limit=50'));
      const sunrise = (list.items ?? []).find((t) => t.subdomain === 'sunrise');
      if (!sunrise) return 'no sunrise hospital';
      const invoices = ok(await con.get(`/invoices?tenantId=${sunrise.id}`)).items ?? [];
      if (invoices.some((i) => i.status === 'PAID')) return 'skipped';
      const inv =
        invoices.find((i) => i.status === 'ISSUED') ??
        ok(
          await con
            .post(`/tenants/${sunrise.id}/subscription`)
            .send({ plan: 'HOSPITAL', cycle: 'MONTHLY' }),
        );
      const paid = ok(
        await con
          .post(`/invoices/${inv.id}/payments`)
          .send({ reference: 'UTR2610110042', amount: inv.total }),
      );
      // Lotus gets an invoice for the clinic plan, still unpaid.
      const lotus = (list.items ?? []).find((t) => t.subdomain === 'lotus');
      if (lotus && !(ok(await con.get(`/invoices?tenantId=${lotus.id}`)).items ?? []).length)
        ok(
          await con
            .post(`/tenants/${lotus.id}/subscription`)
            .send({ plan: 'CLINIC', cycle: 'ANNUAL' }),
        );
      return `Sunrise invoice ${paid.number} paid`;
    },
  ],
];
