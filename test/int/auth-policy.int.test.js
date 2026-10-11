import { describe, expect, it } from 'vitest';
import {
  client,
  cookieFrom,
  makeTenant,
  makeUser,
  PASSWORD,
  signIn,
  useIntegration,
} from '../helpers/int.js';
import { outbox } from '../../src/core/notify/notify.service.js';
import { runAsSystem, runInContext } from '../../src/core/tenancy/context.js';
import { setPassword } from '../../src/core/auth/auth.service.js';
import { idle } from '../../src/core/auth/idle.js';
import { scopeFilter } from '../../src/core/rbac/scope.js';
import { Session } from '../../src/core/auth/models/session.model.js';

const ctx = useIntegration();

describe('password policy', () => {
  it('needs 3 of 4 character classes and refuses the last 5 passwords', async () => {
    const t = await makeTenant();
    const c = await signIn(ctx.app, t.host);
    const weak = await c
      .post('/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'alllowercase1' });
    expect(weak.status).toBe(422);
    const ok = await c
      .post('/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'Second-pass-22' });
    expect(ok.status).toBe(204);
    const back = await c
      .post('/auth/password')
      .send({ currentPassword: 'Second-pass-22', newPassword: PASSWORD });
    expect(back.status).toBe(422);
    expect(back.body.error.details[0].message).toMatch(/last 5/);
  });

  it('forces a password change after an admin reset', async () => {
    const t = await makeTenant();
    const user = await makeUser(t, { username: 'resetme', roles: ['doctor'] });
    await runAsSystem(t.tenant._id, () =>
      setPassword(user._id, 'Temporary-pass-1', { mustChange: true }),
    );
    const c = await signIn(ctx.app, t.host, 'resetme', 'Temporary-pass-1');
    expect(c.loginRes.body.user.mustChangePassword).toBe(true);
    expect((await c.get('/approvals')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(
      (
        await c
          .post('/auth/password')
          .send({ currentPassword: 'Temporary-pass-1', newPassword: 'My-own-pass-77' })
      ).status,
    ).toBe(204);
    expect((await c.get('/approvals')).status).toBe(200);
  });

  it('resets a forgotten password with an SMS code and unlocks the account', async () => {
    const t = await makeTenant();
    await makeUser(t, { username: 'forgetful', roles: ['nurse'], mobile: '9111111111' });
    const c = client(ctx.app, t.host);
    for (let i = 0; i < 5; i++)
      await c.post('/auth/login').send({ username: 'forgetful', password: 'Wrong-pass-1' });
    expect(
      (await c.post('/auth/login').send({ username: 'forgetful', password: PASSWORD })).status,
    ).toBe(423);
    const unknown = await c.post('/auth/password/forgot').send({ username: 'nobody' });
    const known = await c.post('/auth/password/forgot').send({ username: 'forgetful' });
    expect([unknown.status, known.status]).toEqual([202, 202]);
    expect(unknown.body).toEqual(known.body);
    const sms = outbox
      .filter((m) => m.to === '9111111111' && m.template === 'PASSWORD_RESET_OTP')
      .at(-1);
    expect(
      (
        await c
          .post('/auth/password/reset')
          .send({ username: 'forgetful', code: '000000', newPassword: 'Brand-new-pass-5' })
      ).status,
    ).toBe(401);
    const reset = await c
      .post('/auth/password/reset')
      .send({ username: 'forgetful', code: sms.vars.code, newPassword: 'Brand-new-pass-5' });
    expect(reset.status).toBe(204);
    expect(
      (await c.post('/auth/login').send({ username: 'forgetful', password: 'Brand-new-pass-5' }))
        .status,
    ).toBe(200);
  });
});

describe('sessions', () => {
  it('refuses to refresh a session that has been idle too long', async () => {
    const t = await makeTenant();
    const c = await signIn(ctx.app, t.host);
    expect((await c.post('/auth/refresh')).status).toBe(200);
    const familyId = (
      await runAsSystem(t.tenant._id, () =>
        Session.findOne({}).sort({ createdAt: -1 }).lean().exec(),
      )
    ).familyId;
    await idle.clear(String(t.tenant._id), familyId);
    const res = await c.post('/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_IDLE');
  });

  it('background polling does not keep a session alive', async () => {
    const t = await makeTenant();
    const c = await signIn(ctx.app, t.host);
    const familyId = (await runAsSystem(t.tenant._id, () => Session.findOne({}).lean().exec()))
      .familyId;
    await idle.clear(String(t.tenant._id), familyId);
    expect((await c.get('/approvals/count').set('x-background', '1')).status).toBe(200);
    expect(await idle.isActive(String(t.tenant._id), familyId)).toBe(false);
    await c.get('/approvals/count');
    expect(await idle.isActive(String(t.tenant._id), familyId)).toBe(true);
  });

  it('signs a cashier out of the older device when they sign in on a second one', async () => {
    const t = await makeTenant();
    await makeUser(t, { username: 'till1', roles: ['cashier'] });
    const first = await signIn(ctx.app, t.host, 'till1');
    const firstRefresh = cookieFrom(first.loginRes, 'refresh_token');
    await signIn(ctx.app, t.host, 'till1');
    const res = await client(ctx.app, t.host)
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${firstRefresh}`);
    expect(res.status).toBe(401);
  });
});

describe('data scopes', () => {
  const ctxFor = (scope, extra = {}) => ({
    tenantId: 'x',
    userId: '6650aa000000000000000001',
    branchId: '6650bb000000000000000001',
    permissions: new Set(['billing:bill:read']),
    scope,
    ...extra,
  });
  const f = { own: 'createdBy', department: 'departmentId', branch: 'branchId' };

  it('narrows records to own, department, branch or all', () => {
    expect(runInContext(ctxFor('all'), () => scopeFilter(f))).toEqual({});
    expect(String(runInContext(ctxFor('own'), () => scopeFilter(f)).createdBy)).toBe(
      '6650aa000000000000000001',
    );
    expect(String(runInContext(ctxFor('branch'), () => scopeFilter(f)).branchId)).toBe(
      '6650bb000000000000000001',
    );
    const dept = runInContext(
      ctxFor('department', { departmentIds: ['6650cc000000000000000001'] }),
      () => scopeFilter(f),
    );
    expect(dept.departmentId.$in.map(String)).toEqual(['6650cc000000000000000001']);
    expect(runInContext(ctxFor('department'), () => scopeFilter(f)).departmentId.$in).toEqual([]);
    expect(
      runInContext(ctxFor('own'), () => scopeFilter({ branch: 'branchId' })).branchId,
    ).toBeDefined();
    expect(
      runInContext(ctxFor('own', { permissions: new Set(['*']) }), () => scopeFilter(f)),
    ).toEqual({});
  });
});
