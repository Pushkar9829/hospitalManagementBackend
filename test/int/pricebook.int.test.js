import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import { makeTenant, signIn, totp, useIntegration } from '../helpers/int.js';
import { hashPassword } from '../../src/core/auth/password.js';
import { encrypt } from '../../src/core/security/crypto.js';
import { Tenant } from '../../src/core/tenancy/tenant.model.js';
import { PlatformUser } from '../../src/platform/models/platform.models.js';

const ctx = useIntegration();
const PASSWORD = 'Platform-Pass-42';
const CONSOLE = 'console.localhost';
let seq = 0;

async function consoleUser(roles = ['PLATFORM_SUPER_ADMIN']) {
  const secret = authenticator.generateSecret();
  const email = `book${Date.now()}${seq++}@hms.example`;
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
  await agent
    .post('/api/platform/auth/2fa/verify')
    .set('Host', CONSOLE)
    .send({ challengeId: step1.body.challengeId, code: totp(secret) });
  const wrap = (m) => (p) => agent[m](`/api/platform${p}`).set('Host', CONSOLE);
  return { get: wrap('get'), post: wrap('post'), put: wrap('put') };
}

const modulesOf = async (t) =>
  (await Tenant.findById(t.tenant._id).lean()).modules.map((m) => m.code).sort();

describe('price book in the console', () => {
  it('plans are created and edited in the console; hospitals buy them and follow their modules', async () => {
    const ops = await consoleUser();
    const code = `DIAG${Date.now().toString(36).slice(-5).toUpperCase()}`;
    const book = (await ops.get('/plans')).body;
    expect(book.plans.map((p) => p.code)).toEqual(
      expect.arrayContaining(['CLINIC', 'HOSPITAL', 'ENTERPRISE']),
    );
    expect(book.modules.find((m) => m.code === 'LAB')).toMatchObject({ unit: 'BRANCH' });

    const support = await consoleUser(['SUPPORT']);
    expect((await support.get('/plans')).status).toBe(200);
    const sales = await consoleUser(['SALES']);
    const body = {
      code,
      name: 'Diagnostics centre',
      description: 'OPD with lab and radiology',
      monthly: 9_000_00,
      modules: ['OPD', 'LAB', 'RAD'],
      limits: { users: 20, branches: 1, beds: 0, storageGb: 50 },
    };
    expect((await sales.post('/plans').send(body)).status).toBe(403);
    const bad = await ops.post('/plans').send({ ...body, modules: ['NUR'] });
    expect(bad.body.error.code).toBe('DEPENDENCY_MISSING');
    const made = await ops.post('/plans').send(body);
    expect(made.status).toBe(201);
    const plan = made.body.plans.find((p) => p.code === code);
    expect(plan).toMatchObject({
      name: 'Diagnostics centre',
      modules: ['CORE', 'OPD', 'LAB', 'RAD'],
      hospitals: 0,
    });
    expect((await ops.post('/plans').send(body)).body.error.code).toBe('PLAN_EXISTS');
    const pub = (await request(ctx.app).get('/api/public/plans')).body;
    expect(pub.plans[code]).toMatchObject({ monthly: 9_000_00 });

    // A hospital buys the new plan: the invoice and its modules come from the console's plan.
    const t = await makeTenant({ status: 'TRIAL', modules: ['OPD'] });
    const admin = await signIn(ctx.app, t.host);
    const inv = await admin.post('/subscription/convert').send({ plan: code });
    expect(inv.status).toBe(201);
    expect(inv.body.total).toBe(Math.round(9_000_00 * 1.18));
    const finance = await consoleUser(['FINANCE']);
    await finance
      .post(`/invoices/${inv.body.id}/payments`)
      .send({ reference: 'UTR9001', amount: inv.body.total });
    expect(await modulesOf(t)).toEqual(['CORE', 'LAB', 'OPD', 'RAD']);
    const mine = (await admin.get('/subscription')).body;
    expect(mine).toMatchObject({
      plan: code,
      planName: 'Diagnostics centre',
      limits: expect.objectContaining({ users: 20 }),
    });

    // Pharmacy added to the plan and applied to hospitals already on it.
    let current = (await ops.get('/plans')).body;
    const stale = current.docVersion;
    const edit = await ops.put(`/plans/${code}`).send({
      modules: ['OPD', 'LAB', 'RAD', 'PHR'],
      limits: { users: 25, branches: 1, beds: 0, storageGb: 50 },
      applyToExisting: true,
      version: current.docVersion,
    });
    expect(edit.status).toBe(200);
    expect(edit.body.moved).toBe(1);
    expect(await modulesOf(t)).toEqual(['CORE', 'LAB', 'OPD', 'PHR', 'RAD']);
    expect((await Tenant.findById(t.tenant._id).lean()).limits.users).toBe(25);
    const conflict = await ops.put(`/plans/${code}`).send({ name: 'Old view', version: stale });
    expect(conflict.body.error.code).toBe('VERSION_CONFLICT');

    // Taken off sale: hidden from the pricing page, refused for new hospitals, kept for this one.
    current = (await ops.get('/plans')).body;
    await ops.put(`/plans/${code}`).send({ isActive: false, version: current.docVersion });
    expect((await request(ctx.app).get('/api/public/plans')).body.plans[code]).toBeUndefined();
    const t2 = await makeTenant({ status: 'TRIAL', modules: ['OPD'] });
    const admin2 = await signIn(ctx.app, t2.host);
    const refused = await admin2.post('/subscription/convert').send({ plan: code });
    expect(refused.status).toBe(422);
    expect((await admin.get('/subscription')).body.plan).toBe(code);
    expect((await ops.get('/plans')).body.plans.find((p) => p.code === code)).toMatchObject({
      isActive: false,
      hospitals: 1,
    });

    // A module's own price and the trial settings.
    current = (await ops.get('/plans')).body;
    const lab = current.modules.find((m) => m.code === 'LAB');
    const priced = await ops
      .put('/module-prices/LAB')
      .send({ monthly: lab.monthly, version: current.docVersion });
    expect(priced.body.modules.find((m) => m.code === 'LAB').monthly).toBe(lab.monthly);
    const off = await ops
      .put('/price-settings')
      .send({ trialPlan: code, version: priced.body.docVersion });
    expect(off.status).toBe(422);
  });
});
