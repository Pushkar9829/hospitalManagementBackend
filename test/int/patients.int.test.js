import { describe, expect, it } from 'vitest';
import { deliverEvents, makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { outbox } from '../../src/core/notify/notify.service.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { sendWelcomeSms } from '../../src/modules/patients/index.js';
import { CommsPreference } from '../../src/modules/crm/models/crm.models.js';

const ctx = useIntegration();

async function desk() {
  const t = await makeTenant();
  await makeUser(t, { username: 'fo1', roles: ['frontoffice'] });
  await makeUser(t, { username: 'hadmin', roles: ['admin'] });
  return {
    t,
    fo: await signIn(ctx.app, t.host, 'fo1'),
    admin: await signIn(ctx.app, t.host, 'hadmin'),
  };
}

const ravi = (extra = {}) => ({
  registrationType: 'FULL',
  name: { title: 'Mr', first: 'Ravi', last: 'Kumar' },
  gender: 'M',
  mobile: '9876543210',
  birth: { dob: '1979-05-14' },
  address: { line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pin: '411001' },
  ids: [{ type: 'AADHAAR', number: '1234 5678 4321' }],
  allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'MODERATE' }],
  emergencyContact: { name: 'Sunita Kumar', relation: 'Wife', mobile: '9876500000' },
  ...extra,
});

describe('patient registration', () => {
  it('gives a permanent UHID, never stores Aadhaar in full, and sends a welcome SMS', async () => {
    const { t, fo } = await desk();
    const res = await fo.post('/patients').send(ravi());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      uhid: 'CC0000001',
      age: expect.stringMatching(/^\d+Y$/),
      toComplete: [],
    });
    expect(res.body.ids[0].number).toBe('XXXX XXXX 4321');
    const raw = await runAsSystem(t.tenant._id, async () =>
      (await import('../../src/modules/patients/index.js')).Patient.findById(res.body.id).lean(),
    );
    expect(JSON.stringify(raw)).not.toContain('123456784321');
    await runAsSystem(t.tenant._id, () =>
      sendWelcomeSms({ mobile: '9876543210', uhid: 'CC0000001', language: 'hi' }),
    );
    expect(outbox.at(-1).text).toMatch(/CC0000001/);
  });

  it('registers quickly with age only and lists what is still missing', async () => {
    const { fo } = await desk();
    const res = await fo.post('/patients').send({
      registrationType: 'QUICK',
      name: { first: 'Seema' },
      gender: 'F',
      mobile: '9811111111',
      birth: { age: { years: 52 } },
    });
    expect(res.status).toBe(201);
    expect(res.body.dobEstimated).toBe(true);
    expect(res.body.age).toBe('52Y');
    expect(res.body.toComplete).toEqual([
      'address',
      'emergencyContact',
      'ids',
      'allergiesRecorded',
    ]);
  });

  it('warns about likely duplicates, but not about family members sharing a mobile', async () => {
    const { fo } = await desk();
    await fo.post('/patients').send(ravi());
    const dupe = await fo
      .post('/patients')
      .send(ravi({ name: { first: 'Ravi', last: 'Kumaar' }, ids: [] }));
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('POSSIBLE_DUPLICATE');
    expect(dupe.body.error.details[0]).toMatchObject({ uhid: 'CC0000001' });
    const sameAadhaar = await fo
      .post('/patients')
      .send(ravi({ name: { first: 'R', last: 'K' }, mobile: '9000000001' }));
    expect(sameAadhaar.status).toBe(409);
    const confirmed = await fo
      .post('/patients')
      .send(ravi({ name: { first: 'Ravi', last: 'Kumaar' }, ids: [], confirmNotDuplicate: true }));
    expect(confirmed.status).toBe(201);
    const wife = await fo.post('/patients').send(
      ravi({
        name: { title: 'Mrs', first: 'Sunita', last: 'Kumar' },
        gender: 'F',
        ids: [],
        birth: { dob: '1982-02-02' },
      }),
    );
    expect(wife.status).toBe(201);
  });

  it('applies the senior-citizen and guardian rules', async () => {
    const { fo } = await desk();
    const senior = await fo.post('/patients').send(ravi({ category: 'SENIOR', ids: [] }));
    expect(senior.status).toBe(422);
    expect(senior.body.error.details[0].path).toBe('category');
    const child = await fo.post('/patients').send(
      ravi({
        name: { title: 'Master', first: 'Ishan', last: 'Kumar' },
        birth: { dob: '2022-03-01' },
        ids: [],
        mobile: '9822222222',
      }),
    );
    expect(child.body.error.details.map((d) => d.path)).toContain('guardian');
    const ok = await fo.post('/patients').send(
      ravi({
        name: { title: 'Master', first: 'Ishan', last: 'Kumar' },
        birth: { dob: '2022-03-01' },
        ids: [],
        mobile: '9822222222',
        guardian: { name: 'Priya Kumar', relation: 'Mother', mobile: '9822222222' },
      }),
    );
    expect(ok.status).toBe(201);
    expect(ok.body.age).toBe('4Y');
  });

  it('accepts all eight blood groups', async () => {
    const { fo } = await desk();
    const res = await fo
      .post('/patients')
      .send(ravi({ bloodGroup: 'AB-', ids: [], mobile: '9833333333' }));
    expect(res.status).toBe(201);
    expect(res.body.bloodGroup).toBe('AB-');
  });
});

describe('search, profile and updates', () => {
  it('finds patients by UHID, mobile and name prefixes', async () => {
    const { fo } = await desk();
    await fo.post('/patients').send(ravi());
    expect((await fo.get('/patients?q=CC0000001')).body.items[0].name).toBe('Mr Ravi Kumar');
    expect((await fo.get('/patients?q=98765')).body.total).toBe(1);
    expect((await fo.get('/patients?q=rav kum')).body.total).toBe(1);
    expect((await fo.get('/patients?q=kumar ravi')).body.total).toBe(1);
    expect((await fo.get('/patients?q=sana')).body.total).toBe(0);
  });

  it('logs who opened a record, once per 10 minutes', async () => {
    const { fo, admin } = await desk();
    const p = (await fo.post('/patients').send(ravi())).body;
    await fo.get(`/patients/${p.id}`);
    await fo.get(`/patients/${p.id}`);
    const log = await admin.get(`/audit?entity=Patient&entityId=${p.id}&action=VIEW`);
    expect(log.body.total).toBe(1);
  });

  it('updates with the version, keeps the Aadhaar hash, and needs permission', async () => {
    const { t, fo } = await desk();
    const p = (await fo.post('/patients').send(ravi())).body;
    const {
      id,
      uhid,
      age,
      toComplete,
      status,
      registeredAt,
      registrationType,
      dobEstimated,
      mergedInto,
      ...rest
    } = p;
    const body = {
      ...rest,
      birth: { dob: p.dob },
      name: { title: 'Mr', first: 'Ravi', last: 'Kumar' },
      ids: p.ids.map(({ type, number }) => ({ type, number })),
      bloodGroup: 'O-',
    };
    const updated = await fo.put(`/patients/${p.id}`).send(body);
    expect(updated.status).toBe(200);
    expect(updated.body.bloodGroup).toBe('O-');
    expect((await fo.put(`/patients/${p.id}`).send(body)).body.error.code).toBe('VERSION_CONFLICT');
    const again = await fo
      .post('/patients')
      .send(ravi({ name: { first: 'Someone', last: 'Else' }, mobile: '9000000002' }));
    expect(again.status).toBe(409);
    await makeUser(t, { username: 'cook', roles: ['kitchen'] });
    const cook = await signIn(ctx.app, t.host, 'cook');
    expect((await cook.get(`/patients/${p.id}`)).status).toBe(403);
    expect(
      [id, uhid, age, toComplete, status, registeredAt, registrationType, dobEstimated, mergedInto]
        .length,
    ).toBe(9);
  });
});

describe('merging UHIDs', () => {
  it('merges after Hospital Admin approval, keeping every allergy on the survivor', async () => {
    const { fo, admin } = await desk();
    const a = (await fo.post('/patients').send(ravi())).body;
    const b = (
      await fo.post('/patients').send(
        ravi({
          name: { first: 'Ravi', last: 'Kumaar' },
          ids: [],
          allergies: [{ substance: 'Sulfa drugs', severity: 'SEVERE' }],
          confirmNotDuplicate: true,
        }),
      )
    ).body;
    const req = await fo
      .post('/patients/merge')
      .send({ survivorId: a.id, mergedId: b.id, reason: 'Same person, registered twice' });
    expect(req.status).toBe(202);
    const appr = await admin.get(`/approvals/${req.body.approvalId}`);
    expect(
      (
        await admin
          .post(`/approvals/${req.body.approvalId}/decision`)
          .send({ decision: 'APPROVE', version: appr.body.version })
      ).body.status,
    ).toBe('APPLIED');
    const survivor = (await fo.get(`/patients/${a.id}`)).body;
    expect(survivor.allergies.map((x) => x.substance).sort()).toEqual([
      'Penicillin',
      'Sulfa drugs',
    ]);
    const merged = (await fo.get(`/patients/${b.id}`)).body;
    expect(merged).toMatchObject({
      status: 'MERGED',
      mergedInto: a.id,
      mergedIntoUhid: 'CC0000001',
    });
    expect((await fo.get('/patients?q=kumaar')).body.total).toBe(0);
    const tl = (await fo.get(`/patients/${a.id}/timeline`)).body;
    expect(tl.map((x) => x.type)).toEqual(['MERGED', 'REGISTERED']);
  });

  it('keeps consents: recorded with how and until when, withdrawn with a reason; messaging follows', async () => {
    const t = await makeTenant({ modules: ['OPD', 'CRM'] });
    await makeUser(t, { username: 'fo1', roles: ['frontoffice'] });
    const fo = await signIn(ctx.app, t.host, 'fo1');
    const p = (await fo.post('/patients').send(ravi())).body;
    const given = await fo.post(`/patients/${p.id}/consents`).send({
      type: 'WHATSAPP',
      channel: 'REGISTRATION_FORM',
    });
    expect(given.status).toBe(201);
    const old = await fo.post(`/patients/${p.id}/consents`).send({
      type: 'ADMISSION',
      channel: 'TABLET_SIGNATURE',
      validUntil: '2020-01-31',
      scope: 'Admission IP/19-20/000004',
    });
    const list = (await fo.get(`/patients/${p.id}/consents`)).body.items;
    expect(list.map((c) => [c.type, c.status])).toEqual(
      expect.arrayContaining([
        ['WHATSAPP', 'ACTIVE'],
        ['ADMISSION', 'EXPIRED'],
      ]),
    );
    expect(old.body.status).toBe('EXPIRED');
    const out = await fo
      .post(`/patients/${p.id}/consents/${given.body.id}/withdraw`)
      .send({ version: given.body.version, reason: 'Patient asked on phone' });
    expect(out.body).toMatchObject({
      status: 'WITHDRAWN',
      withdrawReason: 'Patient asked on phone',
    });
    expect(
      (
        await fo
          .post(`/patients/${p.id}/consents/${given.body.id}/withdraw`)
          .send({ version: out.body.version, reason: 'again' })
      ).status,
    ).toBe(409);
    await deliverEvents(t.tenant._id);
    const pref = await runAsSystem(t.tenant._id, () =>
      CommsPreference.findOne({ mobile: '9876543210' }).lean().exec(),
    );
    expect(pref).toMatchObject({ whatsapp: false, sms: true });
  });
});
