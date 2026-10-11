import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { client, cookieFrom, signIn, useIntegration } from '../helpers/int.js';
import { wardHospital } from '../helpers/ward.js';
import { redis } from '../../src/core/cache/redis.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { LabItem } from '../../src/modules/lab/index.js';
import { DoctorSchedule } from '../../src/modules/opd/models/opd.models.js';
import { Doctor, Service } from '../../src/modules/setup/index.js';

const ctx = useIntegration();
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const tomorrow = () => new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);

/** A hospital where Ravi and his wife share a mobile, with a consulting doctor. */
async function setup() {
  const h = await wardHospital(ctx, {
    modules: ['LAB'],
    services: [['CONSRM', 'Consultation Dr. Menon', 'CONSULTATION', 60000]],
  });
  const ravi = await h.patient('Ravi');
  const sunita = (
    await h.fo.post('/patients').send({
      registrationType: 'QUICK',
      name: { first: 'Sunita', last: 'Kumar' },
      gender: 'F',
      mobile: ravi.mobile,
      birth: { age: { years: 41 } },
      category: 'GENERAL',
      confirmNotDuplicate: true,
    })
  ).body;
  const other = await h.patient('Outsider');
  await runAsSystem(h.t.tenant._id, async () => {
    const cons = await Service.findOne({ code: 'CONSRM' }).lean();
    await Doctor.updateOne(
      { _id: h.ids.doctorId },
      { $set: { consultationServiceId: cons._id } },
    ).exec();
    await DoctorSchedule.create([
      {
        doctorId: h.ids.doctorId,
        week: DAYS.map((day) => ({
          day,
          sessions: [
            {
              start: '09:00',
              end: '13:00',
              room: '4',
              slotNew: 15,
              slotFollowUp: 10,
              max: 30,
              overbook: 0,
              online: true,
            },
          ],
        })),
        feeServices: { NEW: cons._id, FOLLOW_UP: cons._id, TELE: cons._id },
        followUp: { days: 15, visits: 1 },
      },
    ]);
    const [testId] = [h.ids.doctorId]; // any ObjectId stands in for the test master here
    await LabItem.create([
      {
        orderNo: 'LAB/26-27/000101',
        orderedAt: new Date(),
        source: 'OPD',
        patient: { id: ravi.id, uhid: ravi.uhid, name: 'Ravi Kumar' },
        testId,
        code: 'FBS',
        name: 'Fasting blood sugar',
        status: 'RELEASED',
        releasedAt: new Date(),
        results: [
          {
            code: 'FBS',
            name: 'Glucose, fasting',
            value: '132',
            unit: 'mg/dL',
            range: '70-100',
            flag: 'H',
          },
        ],
      },
      {
        orderNo: 'LAB/26-27/000101',
        orderedAt: new Date(),
        source: 'OPD',
        patient: { id: ravi.id, uhid: ravi.uhid, name: 'Ravi Kumar' },
        testId,
        code: 'HIV',
        name: 'HIV 1 and 2 antibodies',
        sensitive: true,
        status: 'RELEASED',
        releasedAt: new Date(),
        results: [{ code: 'HIV', name: 'HIV', value: 'Non-reactive' }],
      },
    ]);
  });
  return { ...h, ravi, sunita, other };
}

/** Signs in on the portal with a known code (the SMS goes to the console provider in tests). */
async function portalLogin(h, mobile) {
  const c = client(ctx.app, h.t.host);
  expect((await c.post('/portal/auth/otp').send({ mobile })).status).toBe(200);
  const code = '424242';
  await redis().set(
    `portal-otp:${h.t.tenant._id}:${mobile}`,
    JSON.stringify({
      hash: createHash('sha256').update(`${mobile}:${code}`).digest('hex'),
      attempts: 0,
    }),
    'EX',
    300,
  );
  const ok = await c.post('/portal/auth/verify').send({ mobile, code });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  return { c, me: ok.body, token: cookieFrom(ok, 'portal_token') };
}

describe('Patient portal (Phase 6)', () => {
  it('signs a family in by code and shows only its own records', async () => {
    const h = await setup();
    const anon = client(ctx.app, h.t.host);
    expect((await anon.get('/portal/me')).status).toBe(401);
    // the same answer for an unknown number (no probing)
    expect((await anon.post('/portal/auth/otp').send({ mobile: '9999999999' })).body).toEqual({
      expiresInSec: 300,
    });
    expect(
      (await anon.post('/portal/auth/verify').send({ mobile: h.ravi.mobile, code: '000000' }))
        .status,
    ).toBe(401);

    const { c, me, token } = await portalLogin(h, h.ravi.mobile);
    expect(token).toBeTruthy();
    expect(me.patients.map((p) => p.name).sort()).toEqual(['Ravi Kumar', 'Sunita Kumar']);
    expect(me.newReports).toBe(1); // the sensitive test is not counted

    const rep = (await c.get(`/portal/patients/${h.ravi.id}/reports`)).body;
    expect(rep.lab).toHaveLength(1);
    expect(rep.lab[0].tests.map((t) => t.code)).toEqual(['FBS']);
    expect(rep.lab[0].tests[0].results[0]).toMatchObject({ value: '132', flag: 'H' });
    expect(rep.lab[0].inPerson).toEqual(['HIV 1 and 2 antibodies']);
    // another patient's records are not reachable
    expect((await c.get(`/portal/patients/${h.other.id}/reports`)).status).toBe(404);

    // a portal token is never a staff session
    const staffWithPortal = await client(ctx.app, h.t.host)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(staffWithPortal.status).toBe(401);

    expect((await c.post('/portal/auth/logout')).status).toBe(200);
    expect((await c.get('/portal/me')).status).toBe(401);
  });

  it('shows the stay with its running bill, bills due, and books a visit', async () => {
    const h = await setup();
    const stay = await h.admit('Ravi', 'PW-01', 'M', h.ravi);
    const { c } = await portalLogin(h, h.ravi.mobile);
    const s = (await c.get('/portal/stay')).body.stay;
    expect(s).toMatchObject({
      ipNo: stay.ipNo,
      ward: 'Private Wing',
      bed: 'PW-01',
      consultant: 'Dr. R. Menon',
    });
    expect(s.bill.total).toBeGreaterThanOrEqual(0);

    const b = (await c.get('/portal/bills')).body;
    expect(b).toMatchObject({ onlinePayment: false });

    const slots = (await c.get(`/portal/slots?date=${tomorrow()}`)).body;
    expect(slots.doctors[0]).toMatchObject({ name: 'Dr. R. Menon', fee: 60000 });
    const time = slots.doctors[0].times[0];
    const booked = await c.post('/portal/appointments').send({
      patientId: h.sunita.id,
      doctorId: slots.doctors[0].id,
      date: tomorrow(),
      time,
    });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    const appts = (await c.get('/portal/appointments')).body.items;
    expect(appts[0]).toMatchObject({ patient: 'Sunita Kumar', time });
    // the desk sees it as a portal booking
    const fo = await signIn(ctx.app, h.t.host, 'fo');
    const desk = (await fo.get(`/opd/appointments?date=${tomorrow()}`)).body.items;
    expect(desk.find((a) => a.id === appts[0].id)?.channel).toBe('PORTAL');
    // cannot book for someone not on this mobile
    expect(
      (
        await c.post('/portal/appointments').send({
          patientId: h.other.id,
          doctorId: slots.doctors[0].id,
          date: tomorrow(),
          time: slots.doctors[0].times[1],
        })
      ).status,
    ).toBe(404);
    const cancelled = await c.post(`/portal/appointments/${appts[0].id}/cancel`);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect((await c.get('/portal/appointments')).body.items).toEqual([]);
  });
});
