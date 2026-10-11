import { describe, expect, it } from 'vitest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { outbox, sendSms } from '../../src/core/notify/notify.service.js';

const ctx = useIntegration();

describe('Hospital settings: print, messages, integrations, security, export', () => {
  it('rewords messages within the placeholders and uses the new wording', async () => {
    const t = await makeTenant();
    await makeUser(t, { username: 'adm', roles: ['admin'] });
    const sa = await signIn(ctx.app, t.host);
    const adm = await signIn(ctx.app, t.host, 'adm');

    // Print defaults (admin can read, not change)
    const p0 = (await sa.get('/settings/print')).body;
    expect(p0).toMatchObject({ paperSize: 'A4', showLogo: true });
    const p1 = await sa.put('/settings/print').send({
      version: p0.version,
      paperSize: 'A5',
      showLogo: false,
      headerNote: 'NABH accredited',
      footerNote: 'Thank you',
    });
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect(p1.body).toMatchObject({ paperSize: 'A5', headerNote: 'NABH accredited' });
    expect((await adm.get('/settings/print')).status).toBe(200);
    expect((await adm.get('/settings/security')).status).toBe(403);

    // Messages
    const m0 = (await sa.get('/settings/messages')).body;
    const welcome = m0.items.find((m) => m.code === 'PATIENT_WELCOME');
    expect(welcome.placeholders).toEqual(['{hospital}', '{uhid}']);
    const bad = await sa
      .put('/settings/messages/PATIENT_WELCOME')
      .send({ version: m0.version, en: 'Welcome to {hospital}! Show this at the desk.' });
    expect(bad.status).toBe(422);
    const ok = await sa.put('/settings/messages/PATIENT_WELCOME').send({
      version: m0.version,
      en: 'Namaste from {hospital}. Your UHID is {uhid}.',
      dltId: '1107160000000000001',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ customised: true, enabled: true });
    const m1 = (await sa.get('/settings/messages')).body;
    expect(
      (
        await sa
          .put('/settings/messages/LOGIN_OTP')
          .send({ version: m1.version, en: '{code} for {hospital}', enabled: false })
      ).status,
    ).toBeGreaterThanOrEqual(404);

    const before = outbox.length;
    await runAsSystem(t.tenant._id, () =>
      sendSms({
        to: '9876543210',
        template: 'PATIENT_WELCOME',
        vars: { hospital: 'City Care', uhid: 'CC0001' },
      }),
    );
    expect(outbox[before].text).toBe('Namaste from City Care. Your UHID is CC0001.');
    const reset = await sa
      .post('/settings/messages/PATIENT_WELCOME/reset')
      .send({ version: m1.version });
    expect(reset.body.customised).toBe(false);
  });

  it('saves integrations without secrets, sets the security policy, exports CSV', async () => {
    const t = await makeTenant();
    await makeUser(t, { username: 'adm', roles: ['admin'] });
    const sa = await signIn(ctx.app, t.host);
    const adm = await signIn(ctx.app, t.host, 'adm');

    const i0 = (await sa.get('/settings/integrations')).body;
    expect(i0.items.find((i) => i.key === 'sms').configured).toBe(false);
    expect(
      (
        await sa.put('/settings/integrations').send({
          version: i0.version,
          key: 'sms',
          config: { provider: 'MSG91', senderId: 'citycr' },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await sa.put('/settings/integrations').send({
          version: i0.version,
          key: 'sms',
          config: { provider: 'MSG91', apiKey: 'secret' },
        })
      ).status,
    ).toBe(422);
    const i1 = await sa
      .put('/settings/integrations')
      .send({ version: i0.version, key: 'sms', config: { provider: 'MSG91', senderId: 'CITYCR' } });
    expect(i1.status, JSON.stringify(i1.body)).toBe(200);
    expect(i1.body.items.find((i) => i.key === 'sms')).toMatchObject({
      configured: true,
      config: { senderId: 'CITYCR' },
    });

    // Export
    expect((await adm.get('/settings/export/users')).status).toBe(403);
    const users = await sa.get('/settings/export/users');
    expect(users.status, JSON.stringify(users.body)).toBe(200);
    expect(users.body.csv.split('\n')[0]).toBe('Name,Username,Roles,Status,Last sign-in');
    expect(users.body.count).toBe(2);
    const audit = (await sa.get('/audit?actions=EXPORT')).body;
    expect((audit.items ?? []).some((a) => a.action === 'EXPORT')).toBe(true);
    // Security: Super Admin always stays on two-factor
    expect((await adm.get('/settings/security')).status).toBe(403);
    const s = await sa
      .put('/settings/security')
      .send({ twoFactorRoles: ['accounts'], idleTimeoutMin: 20 });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.twoFactorRoles.sort()).toEqual(['accounts', 'superadmin']);
    expect(s.body.idleTimeoutMin).toBe(20);
    // The new policy applies at once: this Super Admin has not set up two-factor yet.
    expect((await sa.get('/settings/print')).body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
  });
});
