import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import { makeTenant, signIn, totp, useIntegration, cookieFrom } from '../helpers/int.js';
import { outbox } from '../../src/core/notify/notify.service.js';
import { redis } from '../../src/core/cache/redis.js';
import { hashPassword } from '../../src/core/auth/password.js';
import { encrypt } from '../../src/core/security/crypto.js';
import { Tenant } from '../../src/core/tenancy/tenant.model.js';
import { tenantRegistry } from '../../src/core/tenancy/tenant.registry.js';
import {
  PlatformInvoice,
  PlatformUser,
  Subscription,
  WebhookEvent,
} from '../../src/platform/models/platform.models.js';
import { runLifecycle } from '../../src/platform/services/subscription.service.js';

const ctx = useIntegration();
// The public signup limit is per IP; repeated local runs share Redis within the same minute.
beforeAll(async () => {
  const keys = await redis().keys('rl:signup:*');
  if (keys.length) await redis().del(...keys);
});
const DAY = 86_400_000;
const PASSWORD = 'Platform-Pass-42';
const CONSOLE = 'console.localhost';

let mobileSeq = 0;
const newMobile = () => `98${String(Date.now()).slice(-6)}${String(mobileSeq++).padStart(2, '0')}`;
const pub = () => {
  const agent = request(ctx.app);
  return {
    get: (p) => agent.get(`/api/public${p}`),
    post: (p) => agent.post(`/api/public${p}`),
  };
};

async function verifiedMobile(mobile = newMobile()) {
  expect((await pub().post('/signup/otp').send({ mobile })).status).toBe(202);
  const { code } = outbox.filter((m) => m.to === mobile && m.template === 'SIGNUP_OTP').at(-1).vars;
  const res = await pub().post('/signup/otp/verify').send({ mobile, code });
  expect(res.status).toBe(200);
  return { mobile, otpToken: res.body.otpToken };
}

const signupBody = (subdomain, { mobile, otpToken }) => ({
  contact: { name: 'Dr Meera Rao', email: `meera.${subdomain}@example.in`, mobile, otpToken },
  hospital: { name: 'Sunrise Hospital', city: 'Pune', beds: 40 },
  subdomain,
  plan: 'HOSPITAL',
  acceptTermsVersion: '2026-01',
});

async function consoleUser(roles = ['PLATFORM_SUPER_ADMIN']) {
  const secret = authenticator.generateSecret();
  const email = `ops${Date.now()}${mobileSeq++}@hms.example`;
  await PlatformUser.create({
    name: `Ops ${roles[0]}`,
    email,
    roles,
    passwordHash: await hashPassword(PASSWORD),
    twoFactor: { enabled: true, secret: encrypt(secret) },
  });
  const agent = request.agent(ctx.app);
  const step1 = await agent
    .post('/api/platform/auth/login')
    .set('Host', CONSOLE)
    .send({ email, password: PASSWORD });
  expect(step1.body).toMatchObject({ twoFactorRequired: true });
  const step2 = await agent
    .post('/api/platform/auth/2fa/verify')
    .set('Host', CONSOLE)
    .send({ challengeId: step1.body.challengeId, code: totp(secret) });
  expect(step2.status).toBe(200);
  const wrap = (m) => (p) => agent[m](`/api/platform${p}`).set('Host', CONSOLE);
  return { get: wrap('get'), post: wrap('post'), step2 };
}

/** A converted hospital: trial → plan chosen → invoice paid by bank transfer. */
async function paidHospital(body = { plan: 'CLINIC', cycle: 'MONTHLY' }) {
  const t = await makeTenant({ status: 'TRIAL', modules: ['OPD'] });
  const admin = await signIn(ctx.app, t.host);
  const inv = await admin.post('/subscription/convert').send(body);
  expect(inv.status).toBe(201);
  const finance = await consoleUser(['FINANCE']);
  const paid = await finance
    .post(`/invoices/${inv.body.id}/payments`)
    .send({ reference: 'UTR0001', amount: inv.body.total });
  expect(paid.body.status).toBe('PAID');
  return { t, admin, invoice: inv.body, finance };
}

async function setStatus(t, status, daysAgo) {
  await Tenant.updateOne(
    { _id: t.tenant._id },
    { $set: { status, statusChangedAt: new Date(Date.now() - daysAgo * DAY) } },
  );
  await tenantRegistry.invalidate(t.tenant);
}
const statusOf = async (t) => (await Tenant.findById(t.tenant._id).lean()).status;

describe('self-service signup', () => {
  it('checks the address, verifies the mobile and starts a 14-day trial', async () => {
    expect((await pub().get('/plans')).body.plans.HOSPITAL.monthly).toBe(35_000_00);
    expect((await pub().get('/subdomains/console')).body).toMatchObject({ available: false });
    expect((await pub().get('/subdomains/a')).body.available).toBe(false);

    const sub = `sunrise${Date.now().toString(36)}`;
    expect((await pub().get(`/subdomains/${sub}`)).body.available).toBe(true);

    const mobile = newMobile();
    await pub().post('/signup/otp').send({ mobile });
    const wrong = await pub().post('/signup/otp/verify').send({ mobile, code: '000000' });
    expect(wrong.status).toBe(401);
    const verified = await verifiedMobile(mobile);

    const forged = await pub()
      .post('/signup')
      .send(signupBody(sub, { mobile: newMobile(), otpToken: verified.otpToken }));
    expect(forged.body.error.code).toBe('TOKEN_INVALID');

    const res = await pub().post('/signup').send(signupBody(sub, verified));
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('TRIAL');
    expect(res.body.loginUrl).toMatch(
      new RegExp(`^http://${sub}\\.localhost:5173/welcome\\?token=`),
    );
    const tenant = await Tenant.findById(res.body.tenantId).lean();
    expect(tenant.modules.length).toBeGreaterThan(10);
    expect(Math.round((tenant.trialEndsAt - Date.now()) / DAY)).toBe(14);
    expect((await pub().get(`/subdomains/${sub}`)).body.available).toBe(false);

    // The first Super Admin sets a password from the one-time link, then signs in.
    const token = new URL(res.body.loginUrl).searchParams.get('token');
    const host = `${sub}.localhost`;
    const accept = await request(ctx.app)
      .post('/api/v1/auth/invite/accept')
      .set('Host', host)
      .send({ token, newPassword: 'Sunrise-Admin-77' });
    expect(accept.status).toBeLessThan(300);
    const admin = await signIn(ctx.app, host, 'superadmin', 'Sunrise-Admin-77');
    // A new hospital keeps the default: the Super Admin must turn on two-factor sign-in first.
    expect((await admin.get('/subscription')).body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    const setup = await admin.post('/auth/2fa/setup');
    expect(
      (await admin.post('/auth/2fa/enable').send({ code: totp(setup.body.secret) })).status,
    ).toBe(200);
    const subscription = (await admin.get('/subscription')).body;
    expect(subscription).toMatchObject({ status: 'TRIAL', plan: 'HOSPITAL', converted: false });
    expect(subscription.usage.users).toBe(1);

    // One trial per mobile number.
    const again = await pub()
      .post('/signup')
      .send(signupBody(`${sub}b`, await verifiedMobile(mobile)));
    expect(again.body.error.code).toBe('TRIAL_EXISTS');
  });
});

describe('subscription and platform invoices', () => {
  it('converts a trial: the plan starts when the invoice is paid', async () => {
    const t = await makeTenant({ status: 'TRIAL', modules: ['OPD'] });
    const admin = await signIn(ctx.app, t.host);
    const enterprise = await admin.post('/subscription/convert').send({ plan: 'ENTERPRISE' });
    expect(enterprise.status).toBe(422);

    const inv = await admin.post('/subscription/convert').send({ plan: 'CLINIC', cycle: 'ANNUAL' });
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({
      kind: 'CONVERSION',
      subtotal: 60_000_00,
      gst: 10_800_00,
      total: 70_800_00,
      status: 'ISSUED',
    });
    expect(inv.body.number).toMatch(/^PI\/\d{2}-\d{2}\/\d{6}$/);
    expect((await admin.post('/subscription/convert').send({ plan: 'CLINIC' })).status).toBe(201);

    const pdf = await admin.get(`/subscription/invoices/${inv.body.id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');

    const finance = await consoleUser(['FINANCE']);
    const short = await finance
      .post(`/invoices/${inv.body.id}/payments`)
      .send({ reference: 'UTR1', amount: 100 });
    expect(short.body.error.code).toBe('VALIDATION_FAILED');
    const paid = await finance
      .post(`/invoices/${inv.body.id}/payments`)
      .send({ reference: 'UTR778899', amount: inv.body.total });
    expect(paid.body.status).toBe('PAID');

    const s = (await admin.get('/subscription')).body;
    expect(s).toMatchObject({ status: 'ACTIVE', plan: 'CLINIC', cycle: 'ANNUAL', converted: true });
    expect(s.modules.map((m) => m.code).sort()).toEqual(['CORE', 'LAB', 'OPD', 'PHR']);
    expect(s.limits.users).toBe(15);
    expect(
      Math.round((new Date(s.currentPeriod.end) - new Date(s.currentPeriod.start)) / DAY),
    ).toBeGreaterThan(360);
    expect((await admin.get('/audit?entity=PlatformInvoice')).body.total).toBe(1);
    // A second conversion is refused once the plan runs.
    expect(
      (await admin.post('/subscription/convert').send({ plan: 'HOSPITAL' })).body.error.code,
    ).toBe('INVALID_STATE');
  });

  it('changes modules straight away during a trial (Core is implied)', async () => {
    const t = await makeTenant({ status: 'TRIAL', modules: ['OPD', 'NUR', 'IPD'] });
    const admin = await signIn(ctx.app, t.host);
    const preview = await admin
      .post('/subscription/preview')
      .send({ add: ['LAB'], remove: ['NUR'] });
    expect(preview.body.blockedBy).toEqual([]);
    expect(preview.body.effective.add).toBe('IMMEDIATE (trial)');
    const res = await admin.post('/subscription/changes').send({ add: ['LAB'], remove: ['NUR'] });
    expect(res.status).toBe(200);
    expect(res.body.subscription.modules.map((m) => m.code).sort()).toEqual([
      'CORE',
      'IPD',
      'LAB',
      'OPD',
    ]);
    const ipd = await admin.post('/subscription/preview').send({ remove: ['IPD'] });
    expect(ipd.body.blockedBy).toEqual([]);
  });

  it('prices an added module pro rata and switches it on when paid; removals wait for renewal', async () => {
    const { t, admin, finance } = await paidHospital();
    const blocked = await admin.post('/subscription/preview').send({ add: ['NUR'] });
    expect(blocked.body.blockedBy[0].message).toMatch(/needs/);

    const preview = await admin.post('/subscription/preview').send({ add: ['RAD'] });
    expect(preview.body.effective.add).toBe('ON_PAYMENT');
    const charge = preview.body.chargeNow;
    expect(charge.subtotal).toBeGreaterThan(0);
    expect(charge.subtotal).toBeLessThanOrEqual(2_500_00);
    expect(charge.gst).toBe(Math.round(charge.subtotal * 0.18));

    const change = await admin
      .post('/subscription/changes')
      .send({ add: ['RAD'], remove: ['PHR'] });
    expect(change.status).toBe(200);
    expect(change.body.invoice).toMatchObject({ kind: 'PRORATION', total: charge.total });
    expect(change.body.subscription.pending).toEqual([
      expect.objectContaining({ op: 'REMOVE', module: 'PHR' }),
    ]);
    expect(change.body.subscription.modules.map((m) => m.code)).not.toContain('RAD');

    await finance
      .post(`/invoices/${change.body.invoice.id}/payments`)
      .send({ reference: 'UTR2', amount: change.body.invoice.total });
    const after = (await admin.get('/subscription')).body;
    expect(after.modules.map((m) => m.code)).toContain('RAD');
    expect(after.modules.map((m) => m.code)).toContain('PHR');

    // Renewal: PHR goes, a new period invoice is issued and the hospital falls due.
    const sub = await Subscription.findOne({ tenantId: t.tenant._id });
    const end = new Date(Date.now() - 1000);
    sub.currentPeriod = { start: new Date(end.getTime() - 30 * DAY), end };
    await sub.save();
    const summary = await runLifecycle();
    expect(summary.renewed).toBeGreaterThanOrEqual(1);
    const renewed = (await admin.get('/subscription')).body;
    expect(renewed.modules.map((m) => m.code)).not.toContain('PHR');
    expect(renewed.pending).toEqual([]);
    expect(await PlatformInvoice.countDocuments({ tenantId: t.tenant._id, kind: 'PERIOD' })).toBe(
      1,
    );
    expect(await statusOf(t)).toBe('PAST_DUE');
  });
});

describe('subscription lifecycle', () => {
  it('moves an ended trial to read-only, then closes it after 30 days', async () => {
    const t = await makeTenant({ status: 'TRIAL' });
    await Tenant.updateOne(
      { _id: t.tenant._id },
      { $set: { trialEndsAt: new Date(Date.now() - 1000) } },
    );
    await runLifecycle();
    expect(await statusOf(t)).toBe('READ_ONLY');
    const admin = await signIn(ctx.app, t.host);
    expect((await admin.get('/users')).status).toBe(200);
    expect((await admin.post('/patients').send({})).body.error.code).toBe('TENANT_READ_ONLY');
    expect((await admin.post('/subscription/preview').send({ add: [] })).status).toBe(200);

    await setStatus(t, 'READ_ONLY', 31);
    await runLifecycle();
    expect(await statusOf(t)).toBe('CLOSED');
    const gone = await request(ctx.app).get('/api/v1/auth/me').set('Host', t.host);
    expect(gone.body.error.code).toBe('TENANT_NOT_FOUND');
  });

  it('walks an unpaid hospital through past due, read-only and suspended; payment restores it', async () => {
    const { t, finance } = await paidHospital();
    const sub = await Subscription.findOne({ tenantId: t.tenant._id });
    const end = new Date(Date.now() - 1000);
    sub.currentPeriod = { start: new Date(end.getTime() - 30 * DAY), end };
    await sub.save();

    await runLifecycle();
    expect(await statusOf(t)).toBe('PAST_DUE');
    await runLifecycle();
    expect(await statusOf(t)).toBe('PAST_DUE'); // 7 days of full access first
    await setStatus(t, 'PAST_DUE', 8);
    await runLifecycle();
    expect(await statusOf(t)).toBe('READ_ONLY');
    await setStatus(t, 'READ_ONLY', 16);
    await runLifecycle();
    expect(await statusOf(t)).toBe('SUSPENDED');

    // Suspended: sign-in and the subscription screen work, nothing else.
    const admin = await signIn(ctx.app, t.host);
    expect((await admin.get('/users')).body.error.code).toBe('TENANT_SUSPENDED');
    const s = (await admin.get('/subscription')).body;
    const due = s.invoices.find((i) => i.status === 'ISSUED');
    expect(due.kind).toBe('PERIOD');

    await finance
      .post(`/invoices/${due.id}/payments`)
      .send({ reference: 'UTR9', amount: due.total });
    expect(await statusOf(t)).toBe('ACTIVE');
    expect((await admin.get('/users')).status).toBe(200);
    expect((await admin.get('/audit?entity=Tenant')).body.total).toBeGreaterThanOrEqual(3);
  });

  it('reactivates a suspended hospital with unpaid invoices into payment due, not active', async () => {
    const { t } = await paidHospital();
    const sub = await Subscription.findOne({ tenantId: t.tenant._id });
    const end = new Date(Date.now() - 1000);
    sub.currentPeriod = { start: new Date(end.getTime() - 30 * DAY), end };
    await sub.save();
    await runLifecycle();
    await setStatus(t, 'SUSPENDED', 1);
    const sales = await consoleUser(['SALES']);
    const res = await sales
      .post(`/tenants/${t.tenant._id}/status`)
      .send({ action: 'REACTIVATE', reason: 'Owner promised payment this week' });
    expect(res.body.status).toBe('PAST_DUE');
  });
});

describe('platform console', () => {
  it('answers only on the console host and always asks for the second factor', async () => {
    const other = await request(ctx.app)
      .post('/api/platform/auth/login')
      .set('Host', 'demo.localhost')
      .send({});
    expect(other.status).toBe(404);

    await PlatformUser.create({
      name: 'No 2FA',
      email: 'no2fa@hms.example',
      passwordHash: await hashPassword(PASSWORD),
    });
    const no2fa = await request(ctx.app)
      .post('/api/platform/auth/login')
      .set('Host', CONSOLE)
      .send({ email: 'no2fa@hms.example', password: PASSWORD });
    expect(no2fa.body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    const wrong = await request(ctx.app)
      .post('/api/platform/auth/login')
      .set('Host', CONSOLE)
      .send({ email: 'no2fa@hms.example', password: 'nope' });
    expect(wrong.status).toBe(401);

    const anon = await request(ctx.app).get('/api/platform/tenants').set('Host', CONSOLE);
    expect(anon.status).toBe(401);

    const ops = await consoleUser();
    const cookie = cookieFrom(ops.step2, 'platform_token');
    expect(cookie).toBeTruthy();
    // A hospital session token is not a console token, and vice versa.
    const t = await makeTenant();
    const hospitalAdmin = await signIn(ctx.app, t.host);
    const hospitalToken = cookieFrom(hospitalAdmin.loginRes, 'access_token');
    const crossed = await request(ctx.app)
      .get('/api/platform/tenants')
      .set('Host', CONSOLE)
      .set('Authorization', `Bearer ${hospitalToken}`);
    expect(crossed.status).toBe(401);
    const reverse = await request(ctx.app)
      .get('/api/v1/auth/me')
      .set('Host', t.host)
      .set('Authorization', `Bearer ${cookie}`);
    expect(reverse.status).toBe(401);

    expect((await ops.get('/auth/me')).body.roles).toEqual(['PLATFORM_SUPER_ADMIN']);
  });

  it('lists hospitals and metrics, and limits each platform role', async () => {
    const { t } = await paidHospital();
    const ops = await consoleUser();
    const list = await ops.get(`/tenants?q=${t.tenant.subdomain}`);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ status: 'ACTIVE', plan: 'CLINIC' });
    const detail = await ops.get(`/tenants/${t.tenant._id}`);
    expect(detail.body.subscription).toMatchObject({ plan: 'CLINIC', converted: true });
    const m = (await ops.get('/metrics')).body;
    expect(m.mrr).toBeGreaterThanOrEqual(6_000_00);
    expect(m.arr).toBe(m.mrr * 12);

    const support = await consoleUser(['SUPPORT']);
    expect((await support.get('/tenants')).status).toBe(200);
    expect((await support.get('/metrics')).status).toBe(403);
    const inv = (await ops.get(`/invoices?tenantId=${t.tenant._id}`)).body.items[0];
    expect(
      (await support.post(`/invoices/${inv.id}/payments`).send({ reference: 'UTR5', amount: 1 }))
        .status,
    ).toBe(403);

    const sales = await consoleUser(['SALES']);
    const suspend = await sales
      .post(`/tenants/${t.tenant._id}/status`)
      .send({ action: 'SUSPEND', reason: 'Requested by the hospital owner' });
    expect(suspend.body.status).toBe('SUSPENDED');
    const admin = await signIn(ctx.app, t.host);
    expect((await admin.get('/users')).body.error.code).toBe('TENANT_SUSPENDED');
    const back = await sales
      .post(`/tenants/${t.tenant._id}/status`)
      .send({ action: 'REACTIVATE', reason: 'Owner confirmed' });
    expect(back.body.status).toBe('ACTIVE');
    const audit = (await admin.get('/audit?entity=Tenant')).body.items.map((a) => a.summary);
    expect(audit.some((s) => s.startsWith('Platform SUSPEND'))).toBe(true);
  });
});

describe('payment gateway webhook', () => {
  const sign = (body) => createHmac('sha256', 'test-webhook-secret').update(body).digest('hex');

  it('verifies the signature, pays the invoice once and ignores repeats', async () => {
    const t = await makeTenant({ status: 'TRIAL', modules: ['OPD'] });
    const admin = await signIn(ctx.app, t.host);
    const inv = (await admin.post('/subscription/convert').send({ plan: 'CLINIC' })).body;
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_TEST123', amount: inv.total, notes: { platformInvoice: inv.number } },
        },
      },
    });
    const post = (signature, eventId = 'evt_1') =>
      request(ctx.app)
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', `${eventId}-${t.tenant.subdomain}`)
        .send(body);

    expect((await post('bad')).status).toBe(400);
    expect((await post(sign(body))).body).toEqual({ ok: true });
    expect((await post(sign(body))).body).toEqual({ duplicate: true });
    const paid = await PlatformInvoice.findById(inv.id).lean();
    expect(paid).toMatchObject({
      status: 'PAID',
      payment: { provider: 'razorpay', reference: 'pay_TEST123' },
    });
    expect(await statusOf(t)).toBe('ACTIVE');
  });

  it('keeps a payment with the wrong amount for finance instead of retrying it', async () => {
    const t = await makeTenant({ status: 'TRIAL', modules: ['OPD'] });
    const admin = await signIn(ctx.app, t.host);
    const inv = (await admin.post('/subscription/convert').send({ plan: 'CLINIC' })).body;
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_SHORT', amount: 100, notes: { platformInvoice: inv.number } },
        },
      },
    });
    const post = () =>
      request(ctx.app)
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', sign(body))
        .set('x-razorpay-event-id', `evt_short_${t.tenant.subdomain}`)
        .send(body);
    expect((await post()).body).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect((await post()).body).toEqual({ duplicate: true });
    const stored = await WebhookEvent.findOne({
      eventId: `evt_short_${t.tenant.subdomain}`,
    }).lean();
    expect(stored.error).toMatch(/^VALIDATION_FAILED/);
    expect((await PlatformInvoice.findById(inv.id).lean()).status).toBe('ISSUED');
  });
});
