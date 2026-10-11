import { describe, expect, it } from 'vitest';
import { sessionSchema } from '@hms/shared/schemas';
import {
  PASSWORD,
  client,
  cookieFrom,
  makeTenant,
  makeUser,
  signIn,
  totp,
  useIntegration,
} from '../helpers/int.js';
import { outbox } from '../../src/core/notify/notify.service.js';
import { AuditLog } from '../../src/core/audit/audit.model.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';

const ctx = useIntegration();

describe('password sign-in', () => {
  it('signs in, sets httpOnly cookies and returns the session', async () => {
    const t = await makeTenant();
    const c = client(ctx.app, t.host);
    const res = await c.post('/auth/login').send({ username: 'SuperAdmin', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(() => sessionSchema.parse(res.body)).not.toThrow();
    expect(res.body.user.roles[0]).toMatchObject({ code: 'superadmin', panel: 'superadmin' });
    expect(res.body.tenant.modules).toEqual(expect.arrayContaining(['CORE', 'OPD', 'IPD', 'LAB']));
    expect(res.body.branch.name).toBe('Main Branch');
    const cookies = res.headers['set-cookie'].join(';');
    expect(cookies).toMatch(/access_token=.+HttpOnly/);
    expect(cookies).toMatch(/refresh_token=.+Path=\/api\/v1\/auth/);
    const me = await c.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('superadmin');
  });

  it('accepts the mobile number as the username', async () => {
    const t = await makeTenant();
    const res = await client(ctx.app, t.host)
      .post('/auth/login')
      .send({ username: '+91 90000 00001', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown user, and audits both', async () => {
    const t = await makeTenant();
    const c = client(ctx.app, t.host);
    const wrong = await c
      .post('/auth/login')
      .send({ username: 'superadmin', password: 'nope-nope-1A' });
    const unknown = await c
      .post('/auth/login')
      .send({ username: 'ghost', password: 'nope-nope-1A' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    const failures = await runAsSystem(t.tenant._id, () =>
      AuditLog.countDocuments({ action: 'LOGIN_FAILED' }).exec(),
    );
    expect(failures).toBe(2);
    // The audit log shows them under sign-ins and in the day's exceptions.
    const admin = await signIn(ctx.app, t.host);
    const logins = await admin.get('/audit?actions=LOGIN,LOGIN_FAILED');
    expect(logins.body.items.map((e) => e.action).sort()).toEqual([
      'LOGIN',
      'LOGIN_FAILED',
      'LOGIN_FAILED',
    ]);
    expect((await admin.get('/audit?actions=NOT_AN_ACTION')).status).toBe(422);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const exc = (await admin.get(`/audit/exceptions?date=${today}`)).body;
    expect(exc.items.find((x) => x.kind === 'FAILED_LOGINS')).toMatchObject({ count: 2 });
    expect(exc.items.find((x) => x.kind === 'EXPORTS')).toMatchObject({ count: 0, example: null });
  });

  it('locks the account for 15 minutes after 5 wrong attempts', async () => {
    const t = await makeTenant();
    const c = client(ctx.app, t.host);
    const codes = [];
    for (let i = 0; i < 5; i++)
      codes.push(
        (await c.post('/auth/login').send({ username: 'superadmin', password: 'Wrong-pass-1' }))
          .status,
      );
    expect(codes).toEqual([401, 401, 401, 401, 423]);
    const right = await c.post('/auth/login').send({ username: 'superadmin', password: PASSWORD });
    expect(right.status).toBe(423);
    expect(right.body.error.message).toMatch(/15 minutes/);
  });

  it('still locks the account when wrong guesses arrive in parallel', async () => {
    const t = await makeTenant();
    const c = client(ctx.app, t.host);
    const guesses = await Promise.all(
      Array.from({ length: 8 }, () =>
        c.post('/auth/login').send({ username: 'superadmin', password: 'Wrong-pass-1' }),
      ),
    );
    expect(guesses.map((r) => r.status)).toContain(423);
    const right = await c.post('/auth/login').send({ username: 'superadmin', password: PASSWORD });
    expect(right.status).toBe(423);
  });

  it('never lets a user of one hospital sign in at another', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await makeUser(a, { username: 'onlyina' });
    const res = await client(ctx.app, b.host)
      .post('/auth/login')
      .send({ username: 'onlyina', password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('rejects an access token from another hospital', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const ca = await signIn(ctx.app, a.host);
    const token = cookieFrom(ca.loginRes, 'access_token');
    const res = await client(ctx.app, b.host)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('validates input with field details and refuses disabled users', async () => {
    const t = await makeTenant();
    const bad = await client(ctx.app, t.host).post('/auth/login').send({ username: 'a' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.map((d) => d.path)).toEqual(
      expect.arrayContaining(['username', 'password']),
    );
    await makeUser(t, { username: 'gone', status: 'DISABLED' });
    expect(
      (
        await client(ctx.app, t.host)
          .post('/auth/login')
          .send({ username: 'gone', password: PASSWORD })
      ).status,
    ).toBe(401);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the family when an old one is replayed', async () => {
    const t = await makeTenant();
    const c = await signIn(ctx.app, t.host);
    const first = cookieFrom(c.loginRes, 'refresh_token');
    const r1 = await c.post('/auth/refresh');
    expect(r1.status).toBe(200);
    const second = cookieFrom(r1, 'refresh_token');
    expect(second).not.toBe(first);
    // A thief replays the old token: everything in the family is revoked.
    const replay = await client(ctx.app, t.host)
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${first}`);
    expect(replay.status).toBe(401);
    const legit = await client(ctx.app, t.host)
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${second}`);
    expect(legit.status).toBe(401);
    const reuse = await runAsSystem(t.tenant._id, () =>
      AuditLog.countDocuments({ action: 'SESSION_REUSE_DETECTED' }).exec(),
    );
    expect(reuse).toBe(1);
  });

  it('logout revokes the access token immediately', async () => {
    const t = await makeTenant();
    const c = await signIn(ctx.app, t.host);
    const token = cookieFrom(c.loginRes, 'access_token');
    expect((await c.post('/auth/logout')).status).toBe(204);
    const after = await client(ctx.app, t.host)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it('answers 401 without a session', async () => {
    const t = await makeTenant();
    const res = await client(ctx.app, t.host).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('two-factor and OTP sign-in', () => {
  it('asks for the authenticator code when two-factor is on', async () => {
    const t = await makeTenant();
    const secret = 'JBSWY3DPEHPK3PXP';
    await makeUser(t, { username: 'billmgr', roles: ['billingmgr'], twoFactorSecret: secret });
    const c = client(ctx.app, t.host);
    const step1 = await c.post('/auth/login').send({ username: 'billmgr', password: PASSWORD });
    expect(step1.status).toBe(200);
    expect(step1.body).toEqual({ twoFactorRequired: true, challengeId: expect.any(String) });
    expect(step1.headers['set-cookie']).toBeUndefined();
    const bad = await c
      .post('/auth/2fa/verify')
      .send({ challengeId: step1.body.challengeId, code: '000000' });
    expect(bad.status).toBe(401);
    const good = await c
      .post('/auth/2fa/verify')
      .send({ challengeId: step1.body.challengeId, code: totp(secret) });
    expect(good.status).toBe(200);
    expect(good.body.user.username).toBe('billmgr');
  });

  it('forces privileged roles to enrol in two-factor before anything else', async () => {
    const t = await makeTenant({ settings: { twoFactorRoles: ['superadmin'] } });
    const c = await signIn(ctx.app, t.host);
    const me = await c.get('/auth/me');
    expect(me.body.user.twoFactorSetupRequired).toBe(true);
    const blocked = await c.get('/audit');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    const setup = await c.post('/auth/2fa/setup');
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect((await c.post('/auth/2fa/enable').send({ code: '123456' })).status).toBe(422);
    expect((await c.post('/auth/2fa/enable').send({ code: totp(setup.body.secret) })).status).toBe(
      200,
    );
    expect((await c.get('/audit')).status).toBe(200);
  });

  it('lets a Super Admin reset a lost two-factor device; the user enrols again', async () => {
    const t = await makeTenant({ settings: { twoFactorRoles: ['admin'] } });
    const adm = await makeUser(t, { username: 'adm1', roles: ['admin'] });
    const sa = await signIn(ctx.app, t.host);
    let c = await signIn(ctx.app, t.host, 'adm1');
    const setup = await c.post('/auth/2fa/setup');
    expect((await c.post('/auth/2fa/enable').send({ code: totp(setup.body.secret) })).status).toBe(
      200,
    );
    // An admin cannot reset two-factor; the Super Admin cannot reset their own.
    expect(
      (await c.post(`/users/${adm._id}/reset-two-factor`).send({ reason: 'Lost phone' })).status,
    ).toBe(403);
    expect(
      (await sa.post(`/users/${t.superAdmin._id}/reset-two-factor`).send({ reason: 'Lost phone' }))
        .status,
    ).toBe(409);
    const reset = await sa
      .post(`/users/${adm._id}/reset-two-factor`)
      .send({ reason: 'Phone lost on duty' });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    // At once: the open session can do nothing until two-factor is set up again, and it can
    // no longer be renewed; a new sign-in must enrol too.
    const blocked = await c.get('/audit');
    expect(blocked.body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    expect((await c.post('/auth/refresh')).status).toBe(401);
    c = await signIn(ctx.app, t.host, 'adm1');
    expect((await c.get('/auth/me')).body.user.twoFactorSetupRequired).toBe(true);
    const log = await runAsSystem(t.tenant._id, async () =>
      AuditLog.findOne({ entity: 'User', summary: /Two-factor sign-in reset/ })
        .lean()
        .exec(),
    );
    expect(log.summary).toMatch(/Phone lost on duty/);
  });

  it('signs in with an SMS code without revealing which numbers exist', async () => {
    const t = await makeTenant();
    await makeUser(t, { username: 'nurse1', roles: ['nurse'], mobile: '9123456780' });
    const c = client(ctx.app, t.host);
    const unknown = await c.post('/auth/otp/request').send({ mobile: '9999999999' });
    const known = await c.post('/auth/otp/request').send({ mobile: '9123456780' });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    const sms = outbox.filter((m) => m.to === '9123456780').at(-1);
    expect(sms.text).toMatch(/sign-in code/);
    expect(
      (await c.post('/auth/otp/verify').send({ mobile: '9123456780', code: '000000' })).status,
    ).toBe(401);
    const ok = await c.post('/auth/otp/verify').send({ mobile: '9123456780', code: sms.vars.code });
    expect(ok.status).toBe(200);
    expect(ok.body.user.username).toBe('nurse1');
    // A code works once.
    expect(
      (await c.post('/auth/otp/verify').send({ mobile: '9123456780', code: sms.vars.code })).status,
    ).toBe(401);
  });
});
