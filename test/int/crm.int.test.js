import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { deliverEvents, signIn, useIntegration } from '../helpers/int.js';
import { wardHospital } from '../helpers/ward.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Patient } from '../../src/modules/patients/index.js';
import { ReferralSource, Service } from '../../src/modules/setup/index.js';

const ctx = useIntegration();
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

async function hospital() {
  const h = await wardHospital(ctx, {
    modules: ['CRM'],
    users: [
      ['crm', 'crm'],
      ['cash', 'cashier'],
    ],
    services: [['CONS', 'Consultation', 'CONSULTATION', 50000]],
  });
  h.crm = await signIn(ctx.app, h.t.host, 'crm');
  h.cash = await signIn(ctx.app, h.t.host, 'cash');
  return h;
}

/** A finalised OP bill for the patient (the cashier's shift is opened once). */
async function finalBill(h, patientId) {
  await h.cash.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
  const svc = await runAsSystem(h.t.tenant._id, async () =>
    String((await Service.findOne({ code: 'CONS' }).lean())._id),
  );
  const draft = (
    await h.cash.post('/billing/bills').send({ patientId, lines: [{ serviceId: svc }] })
  ).body;
  return (await h.cash.post(`/billing/bills/${draft.id}/finalize`).send({ version: draft.version }))
    .body;
}

describe('CRM (Phase 6)', () => {
  it('logs a call that opens a lead, follows it up and converts it on admission', async () => {
    const h = await hospital();
    const ravi = await h.patient('Ravi');
    const call = await h.crm.post('/crm/enquiries').send({
      mobile: ravi.mobile,
      name: 'Ravi Kumar',
      topic: 'PACKAGE',
      notes: 'Asked about knee replacement cost',
      lead: { interest: 'Knee replacement', department: 'Orthopaedics' },
    });
    expect(call.status, JSON.stringify(call.body)).toBe(201);
    const lead = call.body.lead;
    expect(lead).toMatchObject({ stage: 'NEW', source: 'CALL', patientId: ravi.id });
    expect(lead.leadNo).toMatch(/^LD\//);

    const look = (await h.crm.get(`/crm/lookup?mobile=${ravi.mobile}`)).body;
    expect(look.patients.map((p) => p.id)).toEqual([ravi.id]);
    expect(look.leads).toHaveLength(1);
    expect(look.enquiries[0].topic).toBe('PACKAGE');

    expect((await h.crm.patch(`/crm/leads/${lead.id}`).send({ stage: 'LOST' })).status).toBe(422);
    const counselled = await h.crm.patch(`/crm/leads/${lead.id}`).send({
      stage: 'COUNSELLED',
      note: 'Shared the package estimate',
      estimate: 285_000_00,
      nextFollowUp: today(),
    });
    expect(counselled.body).toMatchObject({ stage: 'COUNSELLED', due: true });
    expect((await h.crm.get('/crm/leads?due=true')).body.items).toHaveLength(1);

    const stay = await h.admit('Ravi', 'GW-01', 'M', ravi);
    await deliverEvents(h.t.tenant._id);
    const after = (await h.crm.get('/crm/leads?stage=CONVERTED')).body.items[0];
    expect(after).toMatchObject({ id: lead.id, convertedRef: stay.ipNo });
  });

  it('runs a camp with screening, follow-up leads and its ROI', async () => {
    const h = await hospital();
    const camp = await h.crm.post('/crm/camps').send({
      name: 'Diabetes screening, Kothrud',
      date: today(),
      venue: 'Community hall',
      screenings: ['BP', 'RBS', 'BMI'],
      cost: 15_000_00,
    });
    expect(camp.status).toBe(201);
    await h.crm.post(`/crm/camps/${camp.body.id}/registrations`).send({
      name: 'Suresh Pawar',
      mobile: '9811122233',
      age: 58,
      gender: 'M',
      results: { BP: '156/98', RBS: 232 },
      advice: 'See a physician',
      followUp: true,
      interest: 'Diabetes consultation',
    });
    await h.crm.post(`/crm/camps/${camp.body.id}/registrations`).send({
      name: 'Asha Kale',
      mobile: '9811122244',
      results: { BP: '120/80', RBS: 98 },
    });
    const rep = (await h.crm.get(`/crm/camps/${camp.body.id}/report`)).body;
    expect(rep).toMatchObject({
      registered: 2,
      followUps: 1,
      leads: 1,
      converted: 0,
      revenue: 0,
      roi: -100,
    });
    expect((await h.crm.get('/crm/leads?source=CAMP')).body.items[0].interest).toBe(
      'Diabetes consultation',
    );
  });

  it('sends a campaign only to patients who have not opted out', async () => {
    const h = await hospital();
    const a = await h.patient('Anil');
    const b = await h.patient('Bina', 'F');
    await h.patient('Chetan');
    await runAsSystem(h.t.tenant._id, () =>
      Patient.updateMany(
        { _id: { $in: [a.id, b.id] } },
        { $set: { chronicConditions: ['Diabetes'] } },
      ).exec(),
    );
    await h.crm.post('/crm/preferences').send({ mobile: b.mobile, optOut: true });
    const audience = { conditions: ['diabetes'] };
    expect((await h.crm.post('/crm/campaigns/preview').send(audience)).body).toEqual({
      reach: 1,
      optedOut: 1,
    });
    const c = await h.crm.post('/crm/campaigns').send({
      name: 'HbA1c reminder',
      text: 'Your HbA1c test is due. Book at the lab counter or call us.',
      audience,
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const sent = await h.crm.post(`/crm/campaigns/${c.body.id}/send`);
    expect(sent.body).toMatchObject({ status: 'SENT', sent: 1, skippedOptOut: 1 });
    expect((await h.crm.post(`/crm/campaigns/${c.body.id}/send`)).status).toBe(409);
  });

  it('sells a family card whose wallet pays at the billing counter', async () => {
    const h = await hospital();
    const holder = await h.patient('Meena', 'F');
    const child = await h.patient('Riya', 'F');
    const plan = await h.crm.post('/crm/plans').send({
      code: 'gold',
      name: 'Gold family card',
      price: 1_999_00,
      maxMembers: 4,
      discountPct: 10,
      freeVisits: 2,
      walletCredit: 500_00,
    });
    expect(plan.status).toBe(201);
    const card = await h.crm.post('/crm/memberships').send({
      planCode: 'GOLD',
      holderId: holder.id,
      memberIds: [child.id],
      paymentRef: 'OP/26-27/000101',
    });
    expect(card.status, JSON.stringify(card.body)).toBe(201);
    expect(card.body).toMatchObject({ status: 'ACTIVE', wallet: 500_00, freeVisitsLeft: 2 });
    expect(
      (
        await h.crm.post('/crm/memberships').send({
          planCode: 'GOLD',
          holderId: child.id,
          paymentRef: 'X-1',
        })
      ).body.error.code,
    ).toBe('ALREADY_MEMBER');
    expect((await h.cash.get(`/crm/members/${child.id}`)).body.membership.cardNo).toBe(
      card.body.cardNo,
    );
    const fv = await h.crm
      .post(`/crm/memberships/${card.body.id}/free-visit`)
      .send({ patientId: child.id, ref: 'OPD' });
    expect(fv.body.freeVisitsLeft).toBe(1);

    // The child's ₹500 bill: ₹300 from the card wallet, then more than is left is refused
    const bill = await finalBill(h, child.id);
    const pay = (amount, reference = card.body.cardNo) =>
      h.cash
        .post('/billing/payments')
        .set('Idempotency-Key', randomUUID())
        .send({
          patientId: child.id,
          mode: 'WALLET',
          amount,
          reference,
          allocations: [{ billId: bill.id, amount }],
        });
    const ok = await pay(300);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await pay(200, 'MEM/26-27/999999')).status).toBe(422);
    expect((await pay(250)).status).toBe(422); // only ₹200 left on the card
    const cardNow = (await h.crm.get(`/crm/memberships?q=${encodeURIComponent(card.body.cardNo)}`))
      .body.items[0];
    expect(cardNow.wallet).toBe(200_00);
    expect(cardNow.ledger.map((l) => l.kind)).toEqual(['CREDIT', 'FREE_VISIT', 'DEBIT']);
  });

  it('reports referral partners with the agreed fee and sends the statement', async () => {
    const h = await hospital();
    const src = await runAsSystem(h.t.tenant._id, async () =>
      String(
        (
          await ReferralSource.create([{ code: 'DRSHAH', name: 'Dr. Shah Clinic', kind: 'DOCTOR' }])
        )[0]._id,
      ),
    );
    const p = await h.patient('Kiran');
    await runAsSystem(h.t.tenant._id, () =>
      Patient.updateOne({ _id: p.id }, { $set: { 'referral.sourceId': src } }).exec(),
    );
    await finalBill(h, p.id);
    await h.crm.put('/crm/referrals/agreements').send({ referralSourceId: src, feePct: 10 });
    const month = today().slice(0, 7);
    const r = (await h.crm.get(`/crm/referrals?month=${month}`)).body.items.find(
      (x) => x.id === src,
    );
    expect(r).toMatchObject({ newPatients: 1, revenue: 500_00, feePct: 10, fee: 50_00 });
    const st = (await h.crm.post('/crm/referrals/statements').send({ month })).body.items;
    expect(st).toHaveLength(1);
    const sent = await h.crm.post(`/crm/referrals/statements/${st[0].id}/send`);
    expect(sent.body.status).toBe('SENT');
    const rep = (await h.crm.get(`/crm/report?from=${today()}&to=${today()}`)).body;
    expect(rep).toMatchObject({ leads: 0, activeMemberships: 0 });
  });
});
