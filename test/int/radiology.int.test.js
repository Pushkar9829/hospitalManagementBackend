import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { outbox } from '../../src/core/notify/notify.service.js';
import { PriceList, Service, TaxCode } from '../../src/modules/setup/index.js';
import { sendScheduledSms } from '../../src/modules/radiology/index.js';
import { fromOpdVisit } from '../../src/modules/radiology/services/rad.service.js';

const ctx = useIntegration();
const key = (req) => req.set('Idempotency-Key', randomUUID());
const ymd = (d) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

async function rad() {
  const t = await makeTenant({ modules: ['OPD', 'IPD', 'RAD'] });
  for (const [u, r] of [
    ['r1', 'radiology'],
    ['r2', 'radiology'],
    ['fo', 'frontoffice'],
    ['cash', 'cashier'],
    ['doc', 'doctor'],
  ])
    await makeUser(t, { username: u, roles: [r] });
  const svc = await runAsSystem(t.tenant._id, async () => {
    const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
    const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
    const make = async (code, name, amount) =>
      String(
        (
          await Service.create([
            {
              code,
              name,
              category: 'RAD',
              taxCodeId: exempt._id,
              status: 'ACTIVE',
              isActive: true,
              rates: [{ priceListId: general._id, amount }],
            },
          ])
        )[0]._id,
      );
    return {
      cxr: await make('CXR', 'Chest X-ray PA view', 45000),
      usgob: await make('USGOB', 'Ultrasound obstetric', 150000),
      ct: await make('CTHC', 'CT head with contrast', 400000),
    };
  });
  const u = {};
  for (const n of ['r1', 'r2', 'fo', 'cash', 'doc']) u[n] = await signIn(ctx.app, t.host, n);
  await u.cash.post('/billing/shifts').send({ counter: 'RAD1', openingCash: 0 });
  const patient = async (first, gender = 'M', mobile = '9876543210') =>
    (
      await u.fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first, last: 'Rao' },
        gender,
        mobile,
        birth: { age: { years: 30 } },
        noKnownAllergies: true,
        confirmNotDuplicate: true,
      })
    ).body;
  const pay = async (billId, patientId) => {
    const draft = (await u.cash.get(`/billing/bills/${billId}`)).body;
    const bill = (
      await key(u.cash.post(`/billing/bills/${draft.id}/finalize`)).send({ version: draft.version })
    ).body;
    await key(u.cash.post('/billing/payments')).send({
      patientId,
      mode: 'CASH',
      amount: bill.totals.balance / 100,
      allocations: [{ billId: bill.id, amount: bill.totals.balance / 100 }],
    });
  };
  return { t, svc, patient, pay, ...u };
}

/** The first free slot tomorrow in the first room of the modality. */
async function firstSlot(client, modality) {
  const date = ymd(new Date(Date.now() + 86_400_000));
  const s = (await client.get(`/rad/slots?modality=${modality}&date=${date}`)).body;
  return { room: s.rooms[0].code, at: s.rooms[0].free[0], all: s.rooms[0].free };
}

describe('radiology', () => {
  it('walk-in X-ray: slots, schedule with prep SMS, pay first, perform, draft, sign-off by another radiologist, addendum', async () => {
    const R = await rad();
    const p = await R.patient('Arun');
    const order = await R.r1.post('/rad/orders').send({ patientId: p.id, studies: [R.svc.cxr] });
    expect(order.status).toBe(201);
    const study = order.body.items[0];
    expect(study).toMatchObject({
      status: 'ORDERED',
      modality: 'XRAY',
      accessionNo: expect.stringMatching(/^RAD\//),
    });

    const slot = await firstSlot(R.r1, 'XRAY');
    expect(slot.all.length).toBeGreaterThan(10);
    const booked = await R.r1
      .post(`/rad/studies/${study.id}/schedule`)
      .send({ room: slot.room, at: slot.at });
    expect(booked.body).toMatchObject({ status: 'SCHEDULED', room: 'XR1' });
    // The slot is gone for the next patient.
    const again = await firstSlot(R.r1, 'XRAY');
    expect(again.at).not.toBe(slot.at);
    const q2 = await R.patient('Bina', 'F', '9876500002');
    const other = (await R.r1.post('/rad/orders').send({ patientId: q2.id, studies: [R.svc.cxr] }))
      .body.items[0];
    const clash = await R.r1
      .post(`/rad/studies/${other.id}/schedule`)
      .send({ room: slot.room, at: slot.at });
    expect(clash.body.error.code).toBe('SLOT_TAKEN');
    const wrongRoom = await R.r1
      .post(`/rad/studies/${other.id}/schedule`)
      .send({ room: 'US1', at: slot.at });
    expect(wrongRoom.status).toBe(422);

    const before = outbox.length;
    await runAsSystem(R.t.tenant._id, () =>
      sendScheduledSms({
        mobile: '9876543210',
        study: 'Chest X-ray',
        at: slot.at,
        prep: null,
        room: 'X-ray room 1',
      }),
    );
    expect(outbox.slice(before)[0]).toMatchObject({ template: 'RAD_SCHEDULED' });

    const unpaid = await R.r1.post(`/rad/studies/${study.id}/arrive`);
    expect(unpaid.status).toBe(402);
    await R.pay(study.billId, p.id);
    expect((await R.r1.post(`/rad/studies/${study.id}/arrive`)).body.status).toBe('ARRIVED');
    expect(
      (
        await R.r1
          .put(`/rad/studies/${study.id}/report`)
          .send({ findings: 'x x x x x', impression: 'y y' })
      ).status,
    ).toBe(409);
    expect(
      (await R.r1.post(`/rad/studies/${study.id}/perform`).send({ techNotes: 'PA erect' })).body
        .status,
    ).toBe('PERFORMED');
    const master = (await R.r1.get('/rad/studies-master?modality=XRAY')).body.items[0];
    expect(master.template).toMatch(/Impression/);
    const draft = await R.r1
      .put(`/rad/studies/${study.id}/report`)
      .send({ findings: 'Both lung fields are clear.', impression: 'No significant abnormality.' });
    expect(draft.body).toMatchObject({ status: 'REPORTED', report: { draftBy: 'User r1' } });
    const self = await R.r1.post(`/rad/studies/${study.id}/sign`);
    expect(self.body.error.code).toBe('MAKER_CHECKER');
    const signed = await R.r2.post(`/rad/studies/${study.id}/sign`);
    expect(signed.body).toMatchObject({ status: 'SIGNED', signedBy: 'User r2' });
    expect(
      (
        await R.r1
          .put(`/rad/studies/${study.id}/report`)
          .send({ findings: 'z z z z z', impression: 'z z' })
      ).status,
    ).toBe(409);
    const add = await R.r2
      .post(`/rad/studies/${study.id}/addenda`)
      .send({ text: 'Compared with no prior films.' });
    expect(add.body.addenda).toHaveLength(1);

    // The doctor sees the report only once signed.
    const mine = (await R.doc.get(`/rad/patients/${p.id}/studies`)).body.items[0];
    expect(mine.report).toMatchObject({ impression: 'No significant abnormality.' });
    const otherView = (await R.doc.get(`/rad/patients/${q2.id}/studies`)).body.items[0];
    expect(otherView.report).toBeNull();
    expect((await R.doc.post(`/rad/studies/${study.id}/acknowledge`)).body.acknowledgedBy).toBe(
      'User doc',
    );
  });

  it('safety: contrast consent and creatinine, PCPNDT Form F before obstetric ultrasound and its register', async () => {
    const R = await rad();
    const p = await R.patient('Chetan');
    const ct = (
      await R.r1
        .post('/rad/orders')
        .send({ patientId: p.id, studies: [R.svc.ct], priority: 'STAT' })
    ).body.items[0];
    expect(ct.contrast).toBe(true);
    // STAT: no payment wait.
    expect((await R.r1.post(`/rad/studies/${ct.id}/arrive`)).body.status).toBe('ARRIVED');
    expect((await R.r1.post(`/rad/studies/${ct.id}/perform`).send({})).body.error.code).toBe(
      'CONTRAST_CHECK_NEEDED',
    );
    expect(
      (await R.r1.post(`/rad/studies/${ct.id}/contrast`).send({ consent: false, creatinine: 1.0 }))
        .status,
    ).toBe(422);
    const high = await R.r1
      .post(`/rad/studies/${ct.id}/contrast`)
      .send({ consent: true, creatinine: 2.1 });
    expect(high.status).toBe(422);
    const ok = await R.r1.post(`/rad/studies/${ct.id}/contrast`).send({
      consent: true,
      creatinine: 2.1,
      overrideReason: 'Suspected bleed; benefit outweighs risk',
    });
    expect(ok.body.contrastCheck).toMatchObject({ creatinine: 2.1, consent: true });
    expect((await R.r1.post(`/rad/studies/${ct.id}/perform`).send({})).body.status).toBe(
      'PERFORMED',
    );

    const w = await R.patient('Deepa', 'F', '9876500003');
    const ob = (
      await R.r1
        .post('/rad/orders')
        .send({ patientId: w.id, studies: [R.svc.usgob], priority: 'STAT' })
    ).body.items[0];
    await R.r1.post(`/rad/studies/${ob.id}/arrive`);
    expect((await R.r1.post(`/rad/studies/${ob.id}/perform`).send({})).body.error.code).toBe(
      'FORM_F_NEEDED',
    );
    const lmp = ymd(new Date(Date.now() - 20 * 7 * 86_400_000));
    const noDecl = await R.r1
      .post(`/rad/studies/${ob.id}/form-f`)
      .send({ lmp, indication: 'Anomaly scan', declaration: false, patientSigned: true });
    expect(noDecl.status).toBe(422);
    const f = await R.r1
      .post(`/rad/studies/${ob.id}/form-f`)
      .send({ lmp, indication: 'Anomaly scan', declaration: true, patientSigned: true });
    expect(f.body.formF).toMatchObject({ weeks: 20, indication: 'Anomaly scan' });
    expect((await R.r1.post(`/rad/studies/${ob.id}/perform`).send({})).body.status).toBe(
      'PERFORMED',
    );
    const reg = (await R.r1.get('/rad/form-f')).body;
    expect(reg.items).toEqual([
      expect.objectContaining({
        weeks: 20,
        patient: expect.objectContaining({ name: 'Deepa Rao' }),
      }),
    ]);
  });

  it('OPD orders reach the worklist; counts by stage; cancel before start', async () => {
    const R = await rad();
    const p = await R.patient('Esha', 'F');
    const visitId = '65f000000000000000000002';
    const n = await runAsSystem(R.t.tenant._id, () =>
      fromOpdVisit({
        visitId,
        patientId: p.id,
        orders: [
          { code: 'CXR', serviceId: R.svc.cxr, priority: 'ROUTINE' },
          { code: 'CBC', serviceId: null },
        ],
      }),
    );
    expect(n).toBe(1);
    const rows = (await R.r1.get(`/rad/studies?visitId=${visitId}`)).body.items;
    expect(rows).toEqual([expect.objectContaining({ source: 'OPD', code: 'CXR' })]);
    expect((await R.r1.get('/rad/studies/counts')).body).toMatchObject({ schedule: 1 });
    const c = await R.doc
      .post(`/rad/studies/${rows[0].id}/cancel`)
      .send({ reason: 'Ordered by mistake' });
    expect(c.body.status).toBe('CANCELLED');
    expect((await R.r1.get('/rad/studies/counts')).body).toMatchObject({ schedule: 0 });
  });
});
