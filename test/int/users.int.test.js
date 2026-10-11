import { describe, expect, it } from 'vitest';
import { client, makeTenant, makeUser, PASSWORD, signIn, useIntegration } from '../helpers/int.js';
import { outbox } from '../../src/core/notify/notify.service.js';
import { Tenant } from '../../src/core/tenancy/tenant.model.js';
import { Role } from '../../src/core/auth/models/role.model.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { syncSystemRoles } from '../../src/core/tenancy/provision.js';

const ctx = useIntegration();

async function hospital(opts) {
  const t = await makeTenant(opts);
  await makeUser(t, { username: 'hadmin', roles: ['admin'] });
  return { t, admin: await signIn(ctx.app, t.host, 'hadmin'), sa: await signIn(ctx.app, t.host) };
}

async function approve(sa, approvalId) {
  const a = await sa.get(`/approvals/${approvalId}`);
  return sa
    .post(`/approvals/${approvalId}/decision`)
    .send({ decision: 'APPROVE', version: a.body.version });
}

const staff = (t, extra) => ({
  name: 'Anjali Menon',
  username: 'anjali',
  mobile: '9123400001',
  roleCodes: ['nurse'],
  branchIds: [String(t.branch._id)],
  onboarding: { mode: 'INVITE' },
  ...extra,
});

describe('staff logins', () => {
  it('invites a nurse by SMS; the link sets the first password once', async () => {
    const { t, admin } = await hospital();
    const res = await admin.post('/users').send(staff(t));
    expect(res.status).toBe(201);
    expect(res.body.user.status).toBe('INVITED');
    const sms = outbox.filter((m) => m.to === '9123400001' && m.template === 'USER_INVITE').at(-1);
    const token = new URL(sms.vars.link).searchParams.get('token');
    expect(sms.vars.link).toMatch(
      new RegExp(`^http://${t.tenant.subdomain}\\.localhost:5173/welcome`),
    );
    const pub = client(ctx.app, t.host);
    expect((await pub.get(`/auth/invite/${token}`)).body).toMatchObject({ username: 'anjali' });
    expect(
      (await pub.post('/auth/login').send({ username: 'anjali', password: PASSWORD })).status,
    ).toBe(401);
    expect(
      (await pub.post('/auth/invite/accept').send({ token, newPassword: 'Ward-two-nurse-1' }))
        .status,
    ).toBe(200);
    expect(
      (await pub.post('/auth/invite/accept').send({ token, newPassword: 'Ward-two-nurse-2' }))
        .status,
    ).toBe(410);
    expect(
      (await pub.post('/auth/login').send({ username: 'anjali', password: 'Ward-two-nurse-1' }))
        .status,
    ).toBe(200);
  });

  it('holds a privileged login until the Super Admin approves; a temporary password must be changed', async () => {
    const { t, admin, sa } = await hospital();
    const res = await admin.post('/users').send(
      staff(t, {
        username: 'rahulm',
        mobile: '9123400002',
        roleCodes: ['billingmgr'],
        onboarding: { mode: 'TEMP_PASSWORD', temporaryPassword: 'Temp-billing-01' },
      }),
    );
    expect(res.status).toBe(202);
    expect(res.body.user.status).toBe('PENDING_APPROVAL');
    expect(
      (
        await client(ctx.app, t.host)
          .post('/auth/login')
          .send({ username: 'rahulm', password: 'Temp-billing-01' })
      ).status,
    ).toBe(401);
    expect((await approve(sa, res.body.approvalId)).body.status).toBe('APPLIED');
    const first = await client(ctx.app, t.host)
      .post('/auth/login')
      .send({ username: 'rahulm', password: 'Temp-billing-01' });
    expect(first.status).toBe(200);
    expect(first.body.user.mustChangePassword).toBe(true);
  });

  it('keeps current roles until a newly added privileged role is approved', async () => {
    const { t, admin, sa } = await hospital();
    const u = await makeUser(t, { username: 'cash1', roles: ['cashier'] });
    const before = (await admin.get(`/users/${u._id}`)).body;
    const res = await admin.put(`/users/${u._id}`).send({
      name: before.name,
      roleCodes: ['cashier', 'billingmgr'],
      branchIds: before.branchIds,
      version: before.version,
    });
    expect(res.status).toBe(202);
    expect(res.body.user.roles.map((r) => r.code)).toEqual(['cashier']);
    expect(res.body.user.pendingRoleCodes).toEqual(['cashier', 'billingmgr']);
    await approve(sa, res.body.approvalId);
    const after = (await admin.get(`/users/${u._id}`)).body;
    expect(after.roles.map((r) => r.code).sort()).toEqual(['billingmgr', 'cashier']);
    expect(after.pendingRoleCodes).toBeUndefined();
  });

  it('accepts system roles stored before roles had a status (role sync backfills it)', async () => {
    const { t, admin } = await hospital();
    await runAsSystem(t.tenant._id, () =>
      Role.collection.updateMany(
        { tenantId: t.tenant._id, isSystem: true },
        { $unset: { status: '' } },
      ),
    );
    expect((await admin.post('/users').send(staff(t))).status).toBe(422);
    await runAsSystem(t.tenant._id, () => syncSystemRoles());
    expect((await admin.post('/users').send(staff(t))).status).toBe(201);
  });

  it('enforces the plan user limit', async () => {
    const { t, admin } = await hospital();
    await Tenant.updateOne({ _id: t.tenant._id }, { $set: { 'limits.users': 2 } });
    const res = await admin.post('/users').send(staff(t));
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('LIMIT_REACHED');
  });

  it('protects Super Admins: admins cannot change them and the last one stays active', async () => {
    const { t, admin, sa } = await hospital();
    const saUser = (await sa.get('/auth/me')).body.user;
    const me = (await sa.get(`/users/${saUser.id}`)).body;
    expect(
      (
        await admin
          .post(`/users/${saUser.id}/deactivate`)
          .send({ version: me.version, reason: 'test' })
      ).status,
    ).toBe(403);
    const second = await makeUser(t, { username: 'sa2', roles: ['superadmin'] });
    const sa2 = await signIn(ctx.app, t.host, 'sa2');
    expect(
      (
        await sa2
          .post(`/users/${saUser.id}/deactivate`)
          .send({ version: me.version, reason: 'Left the hospital' })
      ).status,
    ).toBe(200);
    const s2 = (await sa2.get(`/users/${second._id}`)).body;
    expect(
      (
        await sa2
          .post(`/users/${second._id}/deactivate`)
          .send({ version: s2.version, reason: 'x x' })
      ).body.error.code,
    ).toBe('INVALID_STATE');
    expect(t).toBeTruthy();
  });

  it('caps Super Admins at three', async () => {
    const { t, sa } = await hospital();
    await makeUser(t, { username: 'sa2', roles: ['superadmin'] });
    await makeUser(t, { username: 'sa3', roles: ['superadmin'] });
    const res = await sa.post('/users').send(
      staff(t, {
        roleCodes: ['superadmin'],
        onboarding: { mode: 'TEMP_PASSWORD', temporaryPassword: 'Temp-super-0001' },
      }),
    );
    expect(res.body.error.code).toBe('SUPER_ADMIN_LIMIT');
  });

  it('unlocks, resets with a forced change, and signs out everywhere', async () => {
    const { t, admin } = await hospital();
    const u = await makeUser(t, { username: 'doc7', roles: ['doctor'] });
    const c = client(ctx.app, t.host);
    for (let i = 0; i < 5; i++)
      await c.post('/auth/login').send({ username: 'doc7', password: 'Wrong-pass-9' });
    expect(
      (await c.post('/auth/login').send({ username: 'doc7', password: PASSWORD })).status,
    ).toBe(423);
    expect((await admin.get(`/users/${u._id}`)).body.lockedUntil).toBeTruthy();
    await admin.post(`/users/${u._id}/unlock`);
    const session = await signIn(ctx.app, t.host, 'doc7');
    expect(
      (
        await admin
          .post(`/users/${u._id}/reset-password`)
          .send({ temporaryPassword: 'Reset-by-admin-1' })
      ).status,
    ).toBe(200);
    expect((await session.post('/auth/refresh')).status).toBe(401);
    const again = await c
      .post('/auth/login')
      .send({ username: 'doc7', password: 'Reset-by-admin-1' });
    expect(again.body.user.mustChangePassword).toBe(true);
  });
});

describe('custom roles', () => {
  it('copies a system role and applies permissions only after approval', async () => {
    const { t, admin, sa } = await hospital();
    const catalog = (await admin.get('/roles/permissions')).body;
    expect(catalog.find((g) => g.module === 'LAB').permissions).toContain(
      'approvals:lab-result-release:l1',
    );
    expect(
      (
        await admin.post('/roles').send({
          code: 'seniorcash',
          name: 'Senior cashier',
          clonedFrom: 'cashier',
          permissions: ['*'],
          scope: 'branch',
        })
      ).status,
    ).toBe(422);
    const created = await admin.post('/roles').send({
      code: 'seniorcash',
      name: 'Senior cashier',
      clonedFrom: 'cashier',
      permissions: ['billing:*', 'patients:patient:read', 'approvals:billing-discount:l1'],
      scope: 'branch',
      maxSessions: 1,
    });
    expect(created.status).toBe(202);
    expect(created.body.role.status).toBe('PENDING_APPROVAL');
    const pendingUse = await admin.post('/users').send(staff(t, { roleCodes: ['seniorcash'] }));
    expect(pendingUse.status).toBe(422);
    await approve(sa, created.body.approvalId);
    const role = (await admin.get('/roles')).body.find((r) => r.code === 'seniorcash');
    expect(role).toMatchObject({
      status: 'ACTIVE',
      permissions: ['approvals:billing-discount:l1', 'billing:*', 'patients:patient:read'],
    });

    const user = await admin.post('/users').send(
      staff(t, {
        username: 'seniorc',
        mobile: '9123400003',
        roleCodes: ['seniorcash'],
        onboarding: { mode: 'TEMP_PASSWORD', temporaryPassword: 'Temp-cashier-01' },
      }),
    );
    expect(user.status).toBe(201);
    expect(
      (await admin.post(`/roles/${role.id}/deactivate`).send({ version: role.version })).body.error
        .code,
    ).toBe('ROLE_IN_USE');
    const system = (await admin.get('/roles')).body.find((r) => r.code === 'cashier');
    expect(
      (
        await admin
          .put(`/roles/${system.id}`)
          .send({ name: 'Cashier plus', permissions: [], scope: 'all', version: system.version })
      ).body.error.code,
    ).toBe('SYSTEM_ROLE');
  });
});
