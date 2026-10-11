import { describe, expect, it } from 'vitest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';

const ctx = useIntegration();

async function desk() {
  const t = await makeTenant();
  await makeUser(t, { username: 'fo', roles: ['frontoffice'] });
  await makeUser(t, { username: 'nurse', roles: ['nurse'] });
  const fo = await signIn(ctx.app, t.host, 'fo');
  const patient = async (first, mobile = '9876543210') =>
    (
      await fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first, last: 'Kumar' },
        gender: 'M',
        mobile,
        birth: { age: { years: 47 } },
        noKnownAllergies: true,
        confirmNotDuplicate: true,
      })
    ).body;
  return { t, fo, patient, nurse: await signIn(ctx.app, t.host, 'nurse') };
}

describe('front office', () => {
  it('issues counter tokens and calls them in order', async () => {
    const { fo } = await desk();
    const counters = (await fo.get('/front-office/counters')).body.items;
    const billing = counters.find((c) => c.name === 'Billing 1');
    expect(billing).toMatchObject({ prefix: 'B-', current: null, waiting: 0 });
    const t1 = await fo.post('/front-office/tokens').send({ counterId: billing.id, name: 'Ravi' });
    const t2 = await fo.post('/front-office/tokens').send({ counterId: billing.id });
    expect(t1.status).toBe(201);
    expect([t1.body.no, t2.body.no, t2.body.ahead]).toEqual(['B-001', 'B-002', 1]);
    expect((await fo.post(`/front-office/counters/${billing.id}/call-next`)).body.current).toBe(
      'B-001',
    );
    expect((await fo.post(`/front-office/counters/${billing.id}/call-next`)).body.current).toBe(
      'B-002',
    );
    const empty = await fo.post(`/front-office/counters/${billing.id}/call-next`);
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe('QUEUE_EMPTY');
    const now = (await fo.get('/front-office/counters')).body.items.find(
      (c) => c.id === billing.id,
    );
    expect(now).toMatchObject({ current: 'B-002', waiting: 0 });
  });

  it('logs enquiries and summarises the day', async () => {
    const { fo } = await desk();
    await fo.post('/front-office/enquiries').send({
      caller: 'Meena J.',
      topic: 'Knee replacement package cost',
      category: 'PACKAGE',
      channel: 'PHONE',
      outcome: 'LEAD',
    });
    await fo.post('/front-office/enquiries').send({
      caller: 'Arif',
      topic: 'Cardiologist on Saturday',
      category: 'DOCTOR',
      channel: 'WALK_IN',
      outcome: 'BOOKED',
    });
    await fo.post('/front-office/enquiries').send({
      topic: 'Visiting hours ICU',
      category: 'VISITING',
      channel: 'PHONE',
      outcome: 'ANSWERED',
    });
    const list = await fo.get('/front-office/enquiries');
    expect(list.body.total).toBe(3);
    const sum = (await fo.get('/front-office/enquiries/summary?days=7')).body.items[0];
    expect(sum).toMatchObject({ enquiries: 3, booked: 1, leads: 1 });
  });

  it('issues passes with one attendant at a time, marks out and keeps the visitor log', async () => {
    const { fo, patient, nurse } = await desk();
    const ravi = await patient('Ravi');
    const att = await fo.post('/front-office/passes').send({
      patientId: ravi.id,
      type: 'ATTENDANT',
      bed: 'W2-204-B',
      visitor: { name: 'Sunita Kumar', relation: 'Wife' },
    });
    expect(att.status).toBe(201);
    expect(att.body).toMatchObject({ status: 'INSIDE', type: 'ATTENDANT', bed: 'W2-204-B' });
    expect(att.body.qr).toHaveLength(16);
    const second = await fo
      .post('/front-office/passes')
      .send({ patientId: ravi.id, type: 'ATTENDANT', visitor: { name: 'Raj Kumar' } });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ATTENDANT_LIMIT');
    expect((await fo.post(`/front-office/passes/${att.body.id}/out`)).body.status).toBe('OUT');
    expect(
      (
        await fo
          .post('/front-office/passes')
          .send({ patientId: ravi.id, type: 'ATTENDANT', visitor: { name: 'Raj Kumar' } })
      ).status,
    ).toBe(201);
    expect((await fo.get('/front-office/visitor-log')).body.total).toBe(2);
    // A nurse cannot issue passes.
    expect(
      (
        await nurse
          .post('/front-office/passes')
          .send({ patientId: ravi.id, type: 'VISITOR', visitor: { name: 'X Y' } })
      ).status,
    ).toBe(403);
  });
});
