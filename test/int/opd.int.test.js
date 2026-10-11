import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  client,
  deliverEvents,
  makeTenant,
  makeUser,
  signIn,
  useIntegration,
} from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Department, Doctor, PriceList, Service, TaxCode } from '../../src/modules/setup/index.js';
import { DoctorSchedule } from '../../src/modules/opd/models/opd.models.js';
import { Bill } from '../../src/modules/billing/index.js';

const ctx = useIntegration();

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const ymd = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const tomorrow = () => ymd(new Date(Date.now() + 86_400_000));
const key = (req) => req.set('Idempotency-Key', randomUUID());

/**
 * A hospital with a Cardiology OPD: Dr. Meera (a doctor login), consultation and follow-up
 * services, two lab tests, a session every day 08:00 to 20:00 and the desk, nurse, cashier.
 */
async function opd({ modules = ['OPD', 'IPD', 'LAB'] } = {}) {
  const t = await makeTenant({ modules });
  const doc = await makeUser(t, { username: 'meera', roles: ['doctor'] });
  await makeUser(t, { username: 'fo', roles: ['frontoffice'] });
  await makeUser(t, { username: 'nurse', roles: ['nurse'] });
  await makeUser(t, { username: 'cash', roles: ['cashier'] });
  await makeUser(t, { username: 'clinic', roles: ['clinic'] });
  await makeUser(t, { username: 'sa2', roles: ['superadmin'] });
  const data = await runAsSystem(t.tenant._id, async () => {
    const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
    const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
    const [dept] = await Department.create([
      {
        code: 'CARD',
        name: 'Cardiology',
        type: 'CLINICAL',
        status: 'ACTIVE',
        location: { branchId: t.branch._id },
      },
    ]);
    const service = async (code, name, category, amount) =>
      (
        await Service.create([
          {
            code,
            name,
            category,
            taxCodeId: exempt._id,
            status: 'ACTIVE',
            isActive: true,
            rates: [{ priceListId: general._id, amount }],
          },
        ])
      )[0];
    const cons = await service('CONSMI', 'Consultation Dr. Meera', 'CONSULTATION', 80000);
    const fu = await service('CONSMIF', 'Follow-up Dr. Meera', 'CONSULTATION', 50000);
    await service('LIPID', 'Lipid profile', 'LAB', 65000);
    await service('ECG', 'ECG 12-lead', 'PROCEDURE', 30000);
    const [doctor] = await Doctor.create([
      {
        code: 'DMI',
        name: 'Dr. Meera Iyer',
        kind: 'CONSULTANT',
        departmentId: dept._id,
        registrationNo: 'MMC-1',
        userId: doc._id,
        consultationServiceId: cons._id,
      },
    ]);
    await DoctorSchedule.create([
      {
        doctorId: doctor._id,
        week: DAYS.map((day) => ({
          day,
          sessions: [
            {
              start: '08:00',
              end: '20:00',
              room: '12',
              slotNew: 10,
              slotFollowUp: 5,
              max: 72,
              overbook: 0,
              online: true,
              tele: true,
            },
          ],
        })),
        feeServices: { NEW: cons._id, FOLLOW_UP: fu._id, TELE: cons._id },
        followUp: { days: 15, visits: 1 },
      },
    ]);
    return { doctorId: String(doctor._id), consId: String(cons._id) };
  });
  const sa = await signIn(ctx.app, t.host);
  const fo = await signIn(ctx.app, t.host, 'fo');
  const patient = async (first, extra = {}) =>
    (
      await fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first, last: 'Kumar' },
        gender: 'M',
        mobile: extra.mobile ?? '9876543210',
        birth: { age: { years: 47 } },
        allergies: extra.allergies ?? [],
        noKnownAllergies: !extra.allergies,
        confirmNotDuplicate: true,
      })
    ).body;
  // Cardiology needs vitals before the doctor (rule R12).
  await sa.put('/opd/settings').send({
    booking: {
      bookAheadDays: 30,
      latestBeforeMin: 60,
      holdMin: 5,
      maxFuturePerDoctor: 2,
      walkInEvery: 3,
      lateGraceMin: 15,
      prepayOnline: 'OPTIONAL',
      triageRequired: ['Cardiology'],
    },
  });
  return {
    t,
    ...data,
    patient,
    sa,
    fo,
    nurse: await signIn(ctx.app, t.host, 'nurse'),
    doc: await signIn(ctx.app, t.host, 'meera'),
    cash: await signIn(ctx.app, t.host, 'cash'),
    clinic: await signIn(ctx.app, t.host, 'clinic'),
    // Maker-checker: a second Super Admin decides what the first one asks for.
    checker: await signIn(ctx.app, t.host, 'sa2'),
  };
}

describe('opd', () => {
  it('books a slot, refuses the same slot twice with the next free time, and caps future bookings (R1, R17)', async () => {
    const { fo, doctorId, patient } = await opd();
    const ravi = await patient('Ravi');
    const date = tomorrow();
    const a = await key(fo.post('/opd/appointments')).send({
      patientId: ravi.id,
      doctorId,
      date,
      time: '10:00',
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      status: 'BOOKED',
      date,
      time: '10:00',
      fee: { amount: 80000, paid: false },
    });
    expect(a.body.apptNo).toMatch(/^AP\//);

    const sunil = await patient('Sunil', { mobile: '9800000001' });
    const clash = await fo
      .post('/opd/appointments')
      .send({ patientId: sunil.id, doctorId, date, time: '10:00' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SLOT_TAKEN');
    expect(clash.body.error.details[0].nextFree).toBe('10:10');

    await fo.post('/opd/appointments').send({ patientId: ravi.id, doctorId, date, time: '11:00' });
    const third = await fo
      .post('/opd/appointments')
      .send({ patientId: ravi.id, doctorId, date, time: '12:00' });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('TOO_MANY_BOOKINGS');

    const slots = await fo.get(`/opd/slots?date=${date}`);
    const cell = slots.body.cells.find((c) => c.doctorId === doctorId);
    expect(cell.slots.find((s) => s.time === '10:00')).toMatchObject({
      status: 'BOOKED',
      patientName: 'Ravi Kumar',
    });
    expect(cell.slots.find((s) => s.time === '10:10').status).toBe('FREE');
  });

  it('runs the OPD journey: check-in, triage, the doctor’s queue, consultation with checks, R13 and signing (R14)', async () => {
    const { t, fo, nurse, doc, doctorId, patient } = await opd();
    const ravi = await patient('Ravi', {
      allergies: [{ substance: 'Penicillin', severity: 'SEVERE' }],
    });
    const booked = (
      await fo.post('/opd/appointments').send({ patientId: ravi.id, doctorId, time: '08:00' })
    ).body;
    const ci = await key(fo.post(`/opd/appointments/${booked.id}/check-in`)).send({
      detailsConfirmed: true,
    });
    expect(ci.status).toBe(200);
    expect(ci.body.token).toMatchObject({ no: 'T-01', room: '12' });
    expect(ci.body.next).toBe('BILLING');
    const visitId = ci.body.visit.id;
    expect(ci.body.visit.stage).toBe('WAITING');

    // Nurse: triage queue, then vitals (a red flag needs a reason).
    const tq = await nurse.get('/opd/queue?stage=triage');
    expect(tq.body.items.map((q) => q.visitId)).toContain(visitId);
    expect((await nurse.post(`/opd/visits/${visitId}/start-triage`)).body.stage).toBe('IN_TRIAGE');
    const red = await nurse
      .post(`/opd/visits/${visitId}/vitals`)
      .send({ bp: '148/92', priority: 'RED' });
    expect(red.status).toBe(422);
    const v = await nurse.post(`/opd/visits/${visitId}/vitals`).send({
      bp: '148/92',
      pulse: 84,
      weightKg: 78,
      heightCm: 172,
      complaint: 'Chest tightness on stairs',
      priority: 'AMBER',
    });
    expect(v.body).toMatchObject({ stage: 'TRIAGED', status: 'TRIAGE_DONE', priority: 'AMBER' });
    expect(v.body.vitals.bmi).toBe(26.4);

    // Doctor: own queue, call in, consult.
    const dq = await doc.get('/opd/queue?doctorId=me&stage=doctor');
    expect(dq.body.items[0]).toMatchObject({ visitId, token: 'T-01', stage: 'TRIAGED' });
    expect((await doc.post(`/opd/visits/${visitId}/call`)).body.stage).toBe('WITH_DOCTOR');
    const visit = await doc.get(`/opd/visits/${visitId}`);
    expect(visit.body.triageRequired).toBe(true);
    expect(visit.body.patient.allergies).toEqual(['Penicillin']);

    const mox = (await doc.get('/opd/formulary?q=amox')).body.items[0];
    const saved = await doc.put(`/opd/visits/${visitId}/consultation`).send({
      examination: 'Chest clear',
      rx: [
        {
          drugId: mox.id,
          brand: mox.brand,
          generic: mox.generic,
          dose: '1 cap',
          frequency: 'TDS',
          days: 5,
          route: 'Oral',
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.checks.allergy).toEqual([{ drug: mox.brand, allergy: 'PENICILLIN' }]);
    expect(saved.body.status).toBe('DRAFT');

    const lipid = (await doc.get('/opd/orderables?q=lipid')).body.items[0];
    expect(lipid).toMatchObject({ code: 'LIPID', type: 'LAB', price: 65000 });

    const noDx = await doc.post(`/opd/visits/${visitId}/complete`).send({ rx: [] });
    expect(noDx.status).toBe(422);
    expect(noDx.body.error.code).toBe('NO_DIAGNOSIS');

    const done = await doc.post(`/opd/visits/${visitId}/complete`).send({
      rx: [],
      diagnoses: [{ code: 'I10', name: 'Essential (primary) hypertension' }],
      orders: [{ ...lipid, priority: 'ROUTINE' }],
    });
    expect(done.status).toBe(200);
    expect(done.body.consultation).toMatchObject({ status: 'SIGNED', signedBy: 'User meera' });
    expect(done.body.visit).toMatchObject({ stage: 'DONE', status: 'ORDERS_PENDING' });
    expect((await fo.get(`/opd/appointments/${booked.id}`)).body.status).toBe('COMPLETED');

    const edit = await doc
      .put(`/opd/visits/${visitId}/consultation`)
      .send({ advice: 'Walk daily' });
    expect(edit.status).toBe(409);
    const add = await doc
      .post(`/opd/visits/${visitId}/addenda`)
      .send({ text: 'ECG reviewed: normal sinus rhythm.' });
    expect(add.body.addenda).toHaveLength(1);

    const charges = await doc.get(`/opd/visits/${visitId}/charges`);
    expect(charges.body.total).toBe(80000 + 65000);

    // The patient record's sections come from the modules that hold them.
    await deliverEvents(t.tenant._id); // the lipid order reaches the lab
    expect((await fo.get('/patients/registered-today')).body.items.map((x) => x.id)).toContain(
      ravi.id,
    );
    const visits = (await doc.get(`/patients/${ravi.id}/visits`)).body;
    expect(visits.items).toEqual([
      expect.objectContaining({
        doctor: 'Dr. Meera Iyer',
        diagnosis: 'I10 Essential (primary) hypertension',
      }),
    ]);
    const reports = (await doc.get(`/patients/${ravi.id}/reports`)).body.items;
    expect(reports).toEqual([
      expect.objectContaining({ name: 'Lipid profile', kind: 'LAB', flag: null }),
    ]);
    expect((await doc.get(`/patients/${ravi.id}/admissions`)).body.items).toEqual([]);
    const summary = (await doc.get(`/patients/${ravi.id}/summary`)).body;
    expect(summary).toMatchObject({
      opdVisits: 1,
      ipdStays: 0,
      conditions: ['Essential (primary) hypertension'],
      admission: null,
    });
    expect((await doc.get('/patients/000000000000000000000000/visits')).status).toBe(404);
    expect((await doc.get('/abdm/scan-share')).body).toMatchObject({ items: [], connected: false });
  });

  it('closes a clinic visit: bill, payment and receipt; needs an open shift', async () => {
    const { t, clinic, doctorId, patient } = await opd();
    const p = await patient('Asha');
    const walkIn = await key(clinic.post('/opd/appointments')).send({
      patientId: p.id,
      doctorId,
      channel: 'WALK_IN',
    });
    expect(walkIn.status).toBe(201);
    expect(walkIn.body.token.no).toBe('W-01');
    const visitId = walkIn.body.visit.id;
    await clinic
      .post(`/opd/visits/${visitId}/complete`)
      .send({ diagnoses: [{ code: 'R50.9', name: 'Fever' }] });

    const noShift = await clinic.post(`/opd/visits/${visitId}/close`).send({ mode: 'CASH' });
    expect(noShift.status).toBe(409);
    expect(noShift.body.error.code).toBe('SHIFT_REQUIRED');

    await clinic.post('/billing/shifts').send({ counter: 'CL1', openingCash: 0 });
    const closed = await key(clinic.post(`/opd/visits/${visitId}/close`)).send({
      mode: 'CASH',
      outputs: ['PRINT_RX'],
    });
    expect(closed.status).toBe(200);
    expect(closed.body.receipt).toMatchObject({ amount: 80000, mode: 'CASH' });
    expect(closed.body.receipt.no).toBeTruthy();
    expect(closed.body.visit.status).toBe('CLOSED');
    // The bill names the consulting doctor's login, so doctor payouts include the visit.
    const docUserId = await runAsSystem(t.tenant._id, async () =>
      String((await Doctor.findById(doctorId).lean()).userId),
    );
    const bill = await runAsSystem(t.tenant._id, () =>
      Bill.findOne({ billNo: closed.body.receipt.billNo }).lean().exec(),
    );
    expect(String(bill.doctorUserId)).toBe(docUserId);
    const again = await clinic.post(`/opd/visits/${visitId}/close`).send({ mode: 'CASH' });
    expect(again.status).toBe(409);
  });

  it('makes a follow-up free with the same doctor inside the window (R4)', async () => {
    const { clinic, fo, doctorId, patient } = await opd();
    const p = await patient('Neeta');
    const first = (
      await clinic.post('/opd/appointments').send({ patientId: p.id, doctorId, channel: 'WALK_IN' })
    ).body;
    await clinic
      .post(`/opd/visits/${first.visit.id}/complete`)
      .send({ diagnoses: [{ code: 'M17.1', name: 'Knee OA' }] });
    const fu = await fo
      .post('/opd/appointments')
      .send({ patientId: p.id, doctorId, date: tomorrow(), time: '09:00', visitType: 'FOLLOW_UP' });
    expect(fu.status).toBe(201);
    expect(fu.body.fee).toMatchObject({
      amount: 0,
      label: 'FREE_FOLLOW_UP',
      freeDay: 1,
      window: 15,
    });
    // Only one free follow-up per paid visit.
    const fu2 = await fo
      .post('/opd/appointments')
      .send({ patientId: p.id, doctorId, date: tomorrow(), time: '09:30', visitType: 'FOLLOW_UP' });
    expect(fu2.body.fee).toMatchObject({ amount: 50000, label: null });
  });

  it('sends a fee change and cancellation rules for approval, and applies them when approved', async () => {
    const { sa, checker, doctorId } = await opd();
    const before = (await sa.get(`/opd/schedules/${doctorId}`)).body;
    expect(before.fees).toEqual({ NEW: 80000, FOLLOW_UP: 50000, TELE: 80000 });
    const change = await sa.put(`/opd/schedules/${doctorId}`).send({ fees: { FOLLOW_UP: 45000 } });
    expect(change.status).toBe(202);
    expect(change.body.approvalId).toBeTruthy();
    expect(change.body.fees.FOLLOW_UP).toBe(50000);
    const a = (await checker.get(`/approvals/${change.body.approvalId}`)).body;
    expect(a.action).toBe('billing.tariffChange');
    const d = await checker
      .post(`/approvals/${a.id}/decision`)
      .send({ decision: 'APPROVE', version: a.version });
    expect(d.status).toBe(200);
    expect((await sa.get(`/opd/schedules/${doctorId}`)).body.fees.FOLLOW_UP).toBe(45000);

    const cancellation = {
      freeUntilHours: 6,
      keepPercent: 40,
      noShowAfterMin: 30,
      noShowRefund: 'CREDIT',
      prepayAfterNoShows: 3,
      prepayWindowDays: 90,
      hospitalChange: 'FULL_REFUND_OR_FREE_RESCHEDULE',
    };
    const c = await sa.put('/opd/settings').send({ cancellation });
    expect(c.status).toBe(202);
    expect((await sa.get('/opd/settings')).body.cancellation.freeUntilHours).toBe(4);
    const ca = (await checker.get(`/approvals/${c.body.approvalId}`)).body;
    await checker
      .post(`/approvals/${ca.id}/decision`)
      .send({ decision: 'APPROVE', version: ca.version });
    const after = (await sa.get('/opd/settings')).body;
    expect(after.cancellation).toMatchObject({ freeUntilHours: 6, keepPercent: 40 });
    expect(after.pending).toBeNull();
  });

  it('checks access: module (402), role (403) and another hospital’s ids (404)', async () => {
    const a = await opd();
    const p = await a.patient('Ravi');
    const booked = (
      await a.fo
        .post('/opd/appointments')
        .send({ patientId: p.id, doctorId: a.doctorId, time: '08:30' })
    ).body;
    const visitId = (await a.fo.post(`/opd/appointments/${booked.id}/check-in`).send({})).body.visit
      .id;

    expect(
      (await a.nurse.put(`/opd/visits/${visitId}/consultation`).send({ advice: 'x' })).status,
    ).toBe(403);
    expect(
      (
        await a.nurse
          .post('/opd/appointments')
          .send({ patientId: p.id, doctorId: a.doctorId, time: '09:00' })
      ).status,
    ).toBe(403);

    const b = await opd();
    expect((await b.doc.get(`/opd/visits/${visitId}`)).status).toBe(404);
    expect((await b.fo.get(`/opd/appointments/${booked.id}`)).status).toBe(404);

    const noOpd = await makeTenant({ modules: ['LAB'] });
    const sa = await signIn(ctx.app, noOpd.host);
    expect((await sa.get('/opd/queue')).status).toBe(402);
  });

  it('cancels with the refund rule (R9), marks no-shows and reports the day', async () => {
    const { fo, sa, doctorId, patient } = await opd();
    const p = await patient('Kiran');
    const b = (
      await fo
        .post('/opd/appointments')
        .send({ patientId: p.id, doctorId, date: tomorrow(), time: '15:00' })
    ).body;
    const c = await fo.post(`/opd/appointments/${b.id}/cancel`).send({ reason: 'Travelling' });
    expect(c.body).toMatchObject({ appointment: { status: 'CANCELLED' }, refund: null });
    // The slot is free again once cancelled.
    const again = await fo
      .post('/opd/appointments')
      .send({ patientId: p.id, doctorId, date: tomorrow(), time: '15:00' });
    expect(again.status).toBe(201);
    // Today's booking that never arrives.
    const today = (
      await fo.post('/opd/appointments').send({ patientId: p.id, doctorId, time: '08:20' })
    ).body;
    expect((await fo.post(`/opd/appointments/${today.id}/no-show`)).body.status).toBe('NO_SHOW');

    const w = await sa.get('/reports/opd-wait-times?period=week');
    expect(w.status).toBe(200);
    expect(w.body.kpis).toMatchObject({ noShows: 1 });
    expect(w.body.targets.waitToDoctorMin).toBe(30);
    const perf = await sa.get('/reports/opd-doctor-performance?period=week');
    expect(perf.body.items[0].doctor.name).toBe('Dr. Meera Iyer');
  });
  it('shows the queue on a TV with its display key, and stops when the key is revoked', async () => {
    const O = await opd();
    const { sa, fo, nurse } = O;
    const p = await O.patient('Ravi');
    const a = (
      await key(fo.post('/opd/appointments')).send({
        patientId: p.id,
        doctorId: O.doctorId,
        visitType: 'NEW',
        channel: 'WALK_IN',
      })
    ).body;
    await fo.post(`/opd/appointments/${a.id}/check-in`).send({ detailsConfirmed: true });
    void nurse;
    // Register the TV: the key is shown once; the list never shows it again.
    const made = await sa.post('/opd/display-keys').send({ name: 'Waiting hall TV' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.key).toMatch(/^tv_/);
    const list = (await sa.get('/opd/display-keys')).body.items;
    expect(list).toEqual([
      expect.objectContaining({ name: 'Waiting hall TV', last4: made.body.key.slice(-4) }),
    ]);
    expect(JSON.stringify(list)).not.toContain(made.body.key);
    // The TV: no sign-in, just the key. Tokens and rooms only.
    const tv = client(ctx.app, O.t.host);
    const shown = await tv.get('/opd/queue/display/tv').set('X-Display-Key', made.body.key);
    expect(shown.status, JSON.stringify(shown.body)).toBe(200);
    expect(shown.body).toMatchObject({ title: 'OPD', rooms: expect.any(Array) });
    expect(JSON.stringify(shown.body)).not.toContain('Ravi');
    expect((await tv.get('/opd/queue/display/tv').set('X-Display-Key', 'tv_wrong')).status).toBe(
      401,
    );
    expect((await tv.get('/opd/queue/display/tv')).status).toBe(401);
    // A desk user cannot register TVs.
    expect((await fo.post('/opd/display-keys').send({ name: 'x TV' })).status).toBe(403);
    // Revoked: the key stops at once.
    expect((await sa.post(`/opd/display-keys/${made.body.id}/revoke`)).status).toBe(200);
    expect((await tv.get('/opd/queue/display/tv').set('X-Display-Key', made.body.key)).status).toBe(
      401,
    );
  });
});
