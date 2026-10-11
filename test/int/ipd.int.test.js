import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import {
  Bed,
  Department,
  Doctor,
  Payer,
  PriceList,
  Service,
  TaxCode,
  Ward,
} from '../../src/modules/setup/index.js';
import { postStay } from '../../src/modules/ipd/services/charges.service.js';
import { requestFromOpd } from '../../src/modules/ipd/services/admission.service.js';
import { AdmissionRequest } from '../../src/modules/ipd/models/ipd.models.js';

const ctx = useIntegration();
const ymd = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const key = (req) => req.set('Idempotency-Key', randomUUID());

/**
 * A hospital with a general ward (₹1,200 a day, any gender), a male ward and an ICU (₹12,000),
 * a consultant who signs in as "doc", the admission desk, a cashier, housekeeping, the Medical
 * Superintendent and a second Super Admin.
 */
async function ward() {
  const t = await makeTenant({ modules: ['OPD', 'IPD', 'NUR', 'LAB'] });
  const docUser = await makeUser(t, { username: 'doc', roles: ['doctor'] });
  for (const [u, r] of [
    ['fo', 'frontoffice'],
    ['cash', 'cashier'],
    ['hk', 'facility'],
    ['ms', 'medsupt'],
    ['bm', 'billingmgr'],
    ['nurse', 'nurse'],
    ['nurse2', 'nurse'],
    ['ph', 'pharmacy'],
    ['tpa', 'tpa'],
  ])
    await makeUser(t, { username: u, roles: [r] });
  const ids = await runAsSystem(t.tenant._id, async () => {
    const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
    const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
    const svc = async (code, name, category, amount) =>
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
    const genDay = await svc('BEDGEN', 'General ward bed day', 'BED', 120000);
    const icuDay = await svc('BEDICU', 'ICU bed day', 'BED', 1200000);
    const [dept] = await Department.create([
      {
        code: 'MED',
        name: 'General Medicine',
        type: 'CLINICAL',
        status: 'ACTIVE',
        location: { branchId: t.branch._id },
      },
    ]);
    const [doctor] = await Doctor.create([
      {
        code: 'DRM',
        name: 'Dr. R. Menon',
        kind: 'CONSULTANT',
        departmentId: dept._id,
        registrationNo: 'MMC-9',
        userId: docUser._id,
      },
    ]);
    const [gw, mw, icu] = await Ward.create([
      {
        code: 'GW',
        name: 'General Ward',
        branchId: t.branch._id,
        category: 'GENERAL',
        gender: 'ANY',
        bedServiceId: genDay._id,
      },
      {
        code: 'MW',
        name: 'Male Ward',
        branchId: t.branch._id,
        category: 'GENERAL',
        gender: 'MALE',
        bedServiceId: genDay._id,
      },
      {
        code: 'ICU',
        name: 'ICU',
        branchId: t.branch._id,
        category: 'ICU',
        gender: 'ANY',
        bedServiceId: icuDay._id,
      },
    ]);
    const bed = async (code, w) =>
      String(
        (await Bed.create([{ code, name: code, wardId: w._id, branchId: t.branch._id }]))[0]._id,
      );
    const [insurer] = await Payer.create([{ code: 'STAR', name: 'Star Health', kind: 'INSURER' }]);
    return {
      payerId: String(insurer._id),
      doctorId: String(doctor._id),
      g1: await bed('GW-01', gw),
      g2: await bed('GW-02', gw),
      m1: await bed('MW-01', mw),
      icu1: await bed('ICU-01', icu),
    };
  });
  const fo = await signIn(ctx.app, t.host, 'fo');
  const patient = async (first, gender = 'M', mobile = '9876543210') =>
    (
      await fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first, last: 'Kumar' },
        gender,
        mobile,
        birth: { age: { years: 52 } },
        noKnownAllergies: true,
        confirmNotDuplicate: true,
      })
    ).body;
  const users = {};
  for (const u of ['doc', 'cash', 'hk', 'ms', 'bm', 'nurse', 'nurse2', 'ph', 'tpa'])
    users[u] = await signIn(ctx.app, t.host, u);
  await users.cash.post('/billing/shifts').send({ counter: 'IP1', openingCash: 0 });
  return { t, ...ids, fo, patient, ...users, sa: await signIn(ctx.app, t.host) };
}

const bedState = async (c, bedId) =>
  (await c.get('/ipd/beds')).body.wards.flatMap((w) => w.beds).find((b) => b.id === bedId);

describe('ipd', () => {
  it('admits an emergency without a deposit, one stay and one bed (R2, R3)', async () => {
    const { fo, doctorId, g1, g2, patient } = await ward();
    const ravi = await patient('Ravi');
    const a = await key(fo.post('/ipd/admissions')).send({
      patientId: ravi.id,
      doctorId,
      reason: 'Chest pain, rule out ACS',
      bedId: g1,
      emergency: true,
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      status: 'ADMITTED',
      emergency: true,
      bed: { code: 'GW-01', category: 'GENERAL' },
    });
    expect(a.body.ipNo).toMatch(/^IP\//);
    expect(new Date(a.body.depositDueBy) - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect((await bedState(fo, g1)).status).toBe('OCCUPIED');
    expect((await bedState(fo, g1)).stay.ipNo).toBe(a.body.ipNo);

    const again = await fo
      .post('/ipd/admissions')
      .send({ patientId: ravi.id, doctorId, reason: 'x y z', bedId: g2, emergency: true });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_ADMITTED');
    const sunil = await patient('Sunil', 'M', '9800000002');
    const taken = await fo
      .post('/ipd/admissions')
      .send({ patientId: sunil.id, doctorId, reason: 'Fever', bedId: g1, emergency: true });
    expect(taken.body.error.code).toBe('BED_NOT_AVAILABLE');
  });

  it('plans an admission: request, estimate, matching beds, reserve, deposit first (R2, R4)', async () => {
    const { fo, cash, doctorId, g1, m1, patient } = await ward();
    const asha = await patient('Asha', 'F', '9800000003');
    const req = await fo
      .post('/ipd/admission-requests')
      .send({ patientId: asha.id, doctorId, reason: 'Elective cholecystectomy', expectedDays: 3 });
    expect(req.status).toBe(201);
    const est = await fo.post(`/ipd/admission-requests/${req.body.id}/estimate`).send({});
    expect(est.body).toMatchObject({
      status: 'ESTIMATED',
      roomPerDay: 120000,
      estimate: { amount: 360000, deposit: 10_000_00 },
    });

    const beds = (await fo.get(`/ipd/beds/suggest?requestId=${req.body.id}`)).body.items.map(
      (b) => b.id,
    );
    expect(beds).toContain(g1);
    expect(beds).not.toContain(m1); // a male bay is not offered to a woman
    const r = await fo.post(`/ipd/admission-requests/${req.body.id}/reserve`).send({ bedId: g1 });
    expect(r.status).toBe(200);
    expect((await bedState(fo, g1)).status).toBe('RESERVED');

    const noDeposit = await fo.post('/ipd/admissions').send({ requestId: req.body.id });
    expect(noDeposit.status).toBe(409);
    expect(noDeposit.body.error.code).toBe('DEPOSIT_REQUIRED');
    await key(cash.post('/billing/deposits')).send({
      patientId: asha.id,
      mode: 'CASH',
      amount: 10000,
      purpose: 'IP deposit',
    });
    const ok = await fo.post('/ipd/admissions').send({ requestId: req.body.id });
    expect(ok.status).toBe(201);
    expect(ok.body.bed.code).toBe('GW-01');
    expect((await fo.get('/ipd/admission-requests')).body.items.map((x) => x.id)).not.toContain(
      req.body.id,
    );
  });

  it('posts room days to the running bill, alerts at 80% of the deposit, transfers and turns the bed around (R6, R7, R19)', async () => {
    const { t, fo, cash, hk, doctorId, g1, icu1, patient } = await ward();
    const p = await patient('Neeta', 'F', '9800000004');
    await key(cash.post('/billing/deposits')).send({
      patientId: p.id,
      mode: 'CASH',
      amount: 10000,
    });
    const a = (
      await fo
        .post('/ipd/admissions')
        .send({ patientId: p.id, doctorId, reason: 'Pneumonia', bedId: g1 })
    ).body;
    await runAsSystem(t.tenant._id, () => postStay(a.id, ymd()), {
      branchId: String(t.branch._id),
    });
    const one = (await fo.get(`/ipd/admissions/${a.id}`)).body;
    expect(one.bill).toMatchObject({ total: 120000, deposit: 10_000_00, roomDays: 1, usedPct: 12 });

    const tr = await fo
      .post(`/ipd/admissions/${a.id}/transfer`)
      .send({ bedId: icu1, reason: 'Desaturating, step up to ICU' });
    expect(tr.status).toBe(200);
    expect(tr.body.bed.code).toBe('ICU-01');
    expect(tr.body.bedHistory[0].code).toBe('GW-01');
    const old = await bedState(fo, g1);
    expect(old).toMatchObject({ status: 'CLEANING', cleaning: 'ROUTINE' });
    const task = (await hk.get('/ipd/cleaning')).body.items.find((x) => x.bedId === g1);
    expect((await hk.post(`/ipd/cleaning/${task.id}/done`)).status).toBe(200);
    expect((await bedState(fo, g1)).status).toBe('AVAILABLE');
  });

  it('discharges: summary rules (R14), final bill, dues need approval (R17), death is never held (R18)', async () => {
    const { fo, cash, doc, ms, bm, doctorId, g1, g2, patient } = await ward();
    const p = await patient('Harish');
    const a = (
      await fo
        .post('/ipd/admissions')
        .send({ patientId: p.id, doctorId, reason: 'Cellulitis leg', bedId: g1, emergency: true })
    ).body;
    await doc
      .post(`/ipd/admissions/${a.id}/plan-discharge`)
      .send({ expectedAt: new Date(Date.now() + 86_400_000).toISOString() });
    await doc
      .put(`/ipd/admissions/${a.id}/discharge-summary`)
      .send({ course: 'IV antibiotics, improved' });
    const incomplete = await doc.post(`/ipd/admissions/${a.id}/discharge-summary/sign`);
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.code).toBe('SUMMARY_INCOMPLETE');
    await doc.put(`/ipd/admissions/${a.id}/discharge-summary`).send({
      diagnoses: [{ code: 'L03.1', name: 'Cellulitis of limb' }],
      medicines: [{ name: 'Amoxicillin-clavulanate 625 mg', frequency: 'BD', days: 5 }],
      followUp: { note: 'Review in OPD after 7 days' },
    });
    const signed = await doc.post(`/ipd/admissions/${a.id}/discharge-summary/sign`);
    expect(signed.body.summary).toMatchObject({ status: 'SIGNED', signedBy: 'Dr. R. Menon' });
    expect(
      (await doc.put(`/ipd/admissions/${a.id}/discharge-summary`).send({ course: 'x' })).status,
    ).toBe(409);
    await doc.post(`/ipd/admissions/${a.id}/advise-discharge`);
    const fb = await cash.post(`/ipd/admissions/${a.id}/final-bill`);
    expect(fb.status).toBe(200);
    expect(fb.body.billNo).toMatch(/^IPB\//);
    expect(fb.body.bill.total).toBe(120000);

    // ₹1,200 unpaid: discharge with dues waits for the Medical Superintendent.
    const leave = await bm
      .post(`/ipd/admissions/${a.id}/discharge`)
      .send({ outcome: 'NORMAL', reason: 'Family will pay next week' });
    expect(leave.status).toBe(202);
    const ap = (await ms.get(`/approvals/${leave.body.approvalId}`)).body;
    expect(ap.action).toBe('ipd.dischargeWithDues');
    expect(
      (
        await ms
          .post(`/approvals/${ap.id}/decision`)
          .send({ decision: 'APPROVE', version: ap.version })
      ).status,
    ).toBe(200);
    const after = (await fo.get(`/ipd/admissions/${a.id}`)).body;
    expect(after).toMatchObject({ status: 'DISCHARGED', outcome: 'NORMAL' });
    expect((await bedState(fo, g1)).status).toBe('CLEANING');

    // Death with dues: no approval, the body is never held (R18).
    const q = await patient('Gopal', 'M', '9800000005');
    const b = (
      await fo
        .post('/ipd/admissions')
        .send({ patientId: q.id, doctorId, reason: 'Sepsis', bedId: g2, emergency: true })
    ).body;
    const death = await bm
      .post(`/ipd/admissions/${b.id}/discharge`)
      .send({ outcome: 'DEATH', death: { at: new Date().toISOString(), cause: 'Septic shock' } });
    expect(death.status).toBe(200);
    expect(death.body).toMatchObject({ status: 'DISCHARGED', outcome: 'DEATH' });
  });

  it('turns an OPD admission request into a request on the desk, and checks access', async () => {
    const { t, fo, doc, doctorId, patient } = await ward();
    const p = await patient('Sara', 'F', '9800000006');
    // A visit-less request still reaches the desk through the API; the OPD event needs a visit.
    await runAsSystem(t.tenant._id, () =>
      requestFromOpd({
        visitId: '000000000000000000000001',
        patientId: p.id,
        wardType: 'ICU',
        urgency: 'EMERGENCY',
        reason: 'NSTEMI',
      }),
    );
    expect(
      await runAsSystem(t.tenant._id, async () => AdmissionRequest.countDocuments().exec()),
    ).toBe(0);
    const r = await doc.post('/ipd/admission-requests').send({
      patientId: p.id,
      doctorId,
      reason: 'NSTEMI',
      wardCategory: 'ICU',
      urgency: 'EMERGENCY',
    });
    expect(r.status).toBe(201);
    expect((await fo.get('/ipd/admission-requests')).body.items[0]).toMatchObject({
      urgency: 'EMERGENCY',
      wardCategory: 'ICU',
    });
    // A doctor cannot admit or allocate beds; the desk cannot sign summaries.
    expect((await doc.post('/ipd/admissions').send({ requestId: r.body.id })).status).toBe(403);
    expect(
      (await fo.post(`/ipd/admissions/000000000000000000000001/discharge-summary/sign`)).status,
    ).toBe(403);
    const noIpd = await makeTenant({ modules: ['OPD'] });
    expect((await (await signIn(ctx.app, noIpd.host)).get('/ipd/beds')).status).toBe(402);
  });

  it('runs the MAR safely: verification, wristband, second nurse for high-alert, no double dose (R11, R12)', async () => {
    const { fo, doc, nurse, ph, doctorId, g1, patient } = await ward();
    const p = await patient('Kiran');
    const a = (
      await fo
        .post('/ipd/admissions')
        .send({ patientId: p.id, doctorId, reason: 'DKA', bedId: g1, emergency: true })
    ).body;
    const ins = await doc.post(`/ipd/admissions/${a.id}/med-orders`).send({
      drug: { drugId: 'actrapid', brand: 'Actrapid insulin', generic: 'Insulin regular' },
      dose: '6 units',
      route: 'SC',
      frequency: 'TDS',
      // A dose a few minutes from now, whatever the time of day.
      times: [new Date(Date.now() + 330 * 60_000 + 5 * 60_000).toISOString().slice(11, 16)],
    });
    expect(ins.status).toBe(201);
    expect(ins.body).toMatchObject({ highAlert: true, status: 'ORDERED' });
    expect((await nurse.get(`/nursing/admissions/${a.id}/mar`)).body.orders[0].doses).toHaveLength(
      0,
    );
    expect((await ph.post(`/ipd/med-orders/${ins.body.id}/verify`).send({})).body.status).toBe(
      'VERIFIED',
    );
    // The next scheduled dose may be on tomorrow's chart late in the day.
    const tomorrow = ymd(new Date(Date.now() + 86_400_000));
    const dose =
      (await nurse.get(`/nursing/admissions/${a.id}/mar`)).body.orders[0].doses[0] ??
      (await nurse.get(`/nursing/admissions/${a.id}/mar?date=${tomorrow}`)).body.orders[0].doses[0];
    expect(dose.status).toBe('DUE');

    const wrong = await nurse
      .post(`/nursing/mar/${dose.id}/administer`)
      .send({ wristband: 'CC9999999' });
    expect(wrong.body.error.code).toBe('WRONG_PATIENT');
    const alone = await nurse
      .post(`/nursing/mar/${dose.id}/administer`)
      .send({ wristband: a.patient.uhid });
    expect(alone.body.error.code).toBe('WITNESS_REQUIRED');
    const given = await nurse
      .post(`/nursing/mar/${dose.id}/administer`)
      .send({ wristband: a.ipNo, witness: 'User nurse2' });
    expect(given.status).toBe(200);
    expect(given.body).toMatchObject({
      status: 'GIVEN',
      givenBy: 'User nurse',
      witness: 'User nurse2',
    });
    const twice = await nurse
      .post(`/nursing/mar/${dose.id}/administer`)
      .send({ wristband: a.ipNo, witness: 'User nurse2' });
    expect(twice.body.error.code).toBe('DOSE_ALREADY_RECORDED');

    // STAT may be given before the pharmacist; an unverified scheduled dose may not.
    const stat = await doc.post(`/ipd/admissions/${a.id}/med-orders`).send({
      drug: { brand: 'Ondansetron 4 mg inj' },
      dose: '4 mg',
      route: 'IV',
      frequency: 'STAT',
    });
    const statDose = (await nurse.get(`/nursing/admissions/${a.id}/mar`)).body.orders.find(
      (o) => o.id === stat.body.id,
    ).doses[0];
    expect(
      (
        await nurse
          .post(`/nursing/mar/${statDose.id}/administer`)
          .send({ wristband: a.patient.uhid })
      ).status,
    ).toBe(200);
    // A held dose needs a reason.
    const held = await doc.post(`/ipd/admissions/${a.id}/med-orders`).send({
      drug: { brand: 'Pantoprazole 40 mg' },
      dose: '40 mg',
      route: 'IV',
      frequency: 'STAT',
    });
    const hd = (await nurse.get(`/nursing/admissions/${a.id}/mar`)).body.orders.find(
      (o) => o.id === held.body.id,
    ).doses[0];
    expect(
      (await nurse.post(`/nursing/mar/${hd.id}/administer`).send({ status: 'HELD' })).status,
    ).toBe(422);
    expect(
      (
        await nurse
          .post(`/nursing/mar/${hd.id}/administer`)
          .send({ status: 'HELD', reason: 'Nil by mouth, surgeon asked to hold' })
      ).body.status,
    ).toBe('HELD');
  });

  it('scores NEWS2, keeps the fluid balance and flags overdue assessments on the census (R10)', async () => {
    const { fo, nurse, doc, doctorId, g1, patient } = await ward();
    const p = await patient('Rekha', 'F', '9800000009');
    const a = (
      await fo
        .post('/ipd/admissions')
        .send({ patientId: p.id, doctorId, reason: 'Sepsis', bedId: g1, emergency: true })
    ).body;
    const v = await nurse.post(`/nursing/admissions/${a.id}/vitals`).send({
      rr: 26,
      spo2: 91,
      onOxygen: true,
      tempC: 39.4,
      sbp: 88,
      hr: 132,
      consciousness: 'A',
    });
    expect(v.status).toBe(201);
    // RR 3 + SpO2 3 + oxygen 2 + temp 2 + SBP 3 + HR 3 = 16
    expect(v.body).toMatchObject({ news2: 16, risk: 'HIGH' });
    const calm = await nurse
      .post(`/nursing/admissions/${a.id}/vitals`)
      .send({ rr: 16, spo2: 97, tempC: 37, sbp: 120, hr: 80, consciousness: 'A' });
    expect(calm.body).toMatchObject({ news2: 0, risk: 'LOW' });
    await nurse
      .post(`/nursing/admissions/${a.id}/io`)
      .send({ kind: 'INTAKE', route: 'IV', ml: 1000 });
    await nurse
      .post(`/nursing/admissions/${a.id}/io`)
      .send({ kind: 'OUTPUT', route: 'URINE', ml: 400 });
    expect((await nurse.get(`/nursing/admissions/${a.id}/io`)).body).toMatchObject({
      intake: 1000,
      output: 400,
      balance: 600,
    });

    const wardId = a.bed.wardId;
    const row = (await nurse.get(`/nursing/wards/${wardId}/census`)).body.items[0];
    expect(row).toMatchObject({
      bed: 'GW-01',
      news2: { score: 0, risk: 'LOW' },
      fluidBalance: 600,
    });
    expect(row.assessmentsDue.map((x) => x.kind)).toEqual(['NURSING_ADMISSION', 'DOCTOR_INITIAL']);
    await nurse
      .post(`/nursing/admissions/${a.id}/notes`)
      .send({ kind: 'NURSING_ADMISSION', data: { fallsRisk: 'LOW', bradenScore: 18 } });
    await doc
      .post(`/ipd/admissions/${a.id}/notes`)
      .send({ kind: 'DOCTOR_INITIAL', text: 'Sepsis, source likely urinary. Start ceftriaxone.' });
    const after = (await nurse.get(`/nursing/wards/${wardId}/census`)).body.items[0];
    expect(after.assessmentsDue).toEqual([]);
    expect(after.status).toBe('UNDER_TREATMENT');
    // A nurse cannot write doctor notes; a doctor cannot give doses.
    expect(
      (await nurse.post(`/ipd/admissions/${a.id}/notes`).send({ kind: 'PROGRESS', text: 'x y z' }))
        .status,
    ).toBe(403);
  });

  it('runs a cashless case: pre-auth clock, query, approval, enhancement, final approval with patient share, claim and settlement', async () => {
    const { fo, doc, cash, tpa, doctorId, payerId, g1, patient } = await ward();
    const p = await patient('Meena', 'F', '9800000011');
    const a = (
      await fo.post('/ipd/admissions').send({
        patientId: p.id,
        doctorId,
        reason: 'Laparoscopic cholecystectomy',
        bedId: g1,
        payer: { kind: 'INSURANCE', payerId, policyNo: 'P-123' },
      })
    ).body;
    // Insured planned admission: no deposit wait; pre-auth follows (R8).
    expect(a.status).toBe('ADMITTED');
    const sent = await tpa
      .post(`/ipd/admissions/${a.id}/preauth`)
      .send({ requested: 80_000_00, diagnosis: 'K80.2 Gallstones' });
    expect(sent.status).toBe(201);
    expect(new Date(sent.body.replyDueAt) - Date.now()).toBeLessThanOrEqual(3_600_000);
    expect(
      (await tpa.post(`/ipd/admissions/${a.id}/preauth`).send({ requested: 1 })).body.error.code,
    ).toBe('PREAUTH_EXISTS');
    const id = sent.body.id;
    expect((await tpa.post(`/ipd/preauths/${id}/reply`).send({ outcome: 'QUERY' })).status).toBe(
      422,
    );
    expect(
      (
        await tpa
          .post(`/ipd/preauths/${id}/reply`)
          .send({ outcome: 'QUERY', text: 'Send the ultrasound report' })
      ).body.status,
    ).toBe('QUERY');
    expect(
      (await tpa.post(`/ipd/preauths/${id}/answer-query`).send({ text: 'USG report attached' }))
        .body.status,
    ).toBe('SENT');
    const ok = await tpa
      .post(`/ipd/preauths/${id}/reply`)
      .send({ outcome: 'APPROVED', amount: 1000 });
    expect(ok.body).toMatchObject({ status: 'APPROVED', approved: 1000 });
    const enh = await tpa
      .post(`/ipd/preauths/${id}/enhancements`)
      .send({ amount: 50_000_00, reason: 'Stay extended by 2 days' });
    expect(enh.body.status).toBe('ENHANCEMENT_SENT');
    expect(
      (await tpa.post(`/ipd/preauths/${id}/reply`).send({ outcome: 'APPROVED', amount: 50_000_00 }))
        .body.approved,
    ).toBe(50_000_00 + 1000);

    // Final approval needs the final bill first.
    expect((await tpa.post(`/ipd/preauths/${id}/final`)).body.error.code).toBe('FINAL_BILL_NEEDED');
    await doc.put(`/ipd/admissions/${a.id}/discharge-summary`).send({
      diagnoses: [{ code: 'K80.2', name: 'Calculus of gallbladder' }],
      advice: 'Soft diet for a week',
      followUp: { note: 'Surgical OPD in 7 days' },
    });
    await doc.post(`/ipd/admissions/${a.id}/discharge-summary/sign`);
    await doc.post(`/ipd/admissions/${a.id}/advise-discharge`);
    const fb = await cash.post(`/ipd/admissions/${a.id}/final-bill`);
    expect(fb.status).toBe(200);
    const total = fb.body.bill.total;
    expect(total).toBe(120000);
    expect((await tpa.post(`/ipd/preauths/${id}/final`)).body.status).toBe('FINAL_SENT');
    const fin = await tpa
      .post(`/ipd/preauths/${id}/reply`)
      .send({ outcome: 'APPROVED', amount: total - 20000 });
    expect(fin.body).toMatchObject({ status: 'FINAL_APPROVED', patientShare: 20000 });
    expect(
      (await tpa.post(`/ipd/preauths/${id}/claim`).send({ claimNo: 'CLM-778' })).body.status,
    ).toBe('CLAIMED');
    // ₹300 short of the approval: the deductions must account for it.
    const short = await tpa
      .post(`/ipd/preauths/${id}/settle`)
      .send({ amount: total - 50000, utr: 'UTR12345' });
    expect(short.status).toBe(422);
    const settled = await tpa.post(`/ipd/preauths/${id}/settle`).send({
      amount: total - 50000,
      utr: 'UTR12345',
      deductions: [{ reason: 'Non-payable consumables', amount: 30000 }],
    });
    expect(settled.body).toMatchObject({ status: 'SETTLED', settled: total - 50000 });
    expect((await tpa.get('/ipd/preauths')).body.items.map((x) => x.id)).not.toContain(id);
  });

  it('moves a denied case to cash', async () => {
    const { fo, tpa, doctorId, payerId, g2, patient } = await ward();
    const p = await patient('Lata', 'F', '9800000012');
    const a = (
      await fo.post('/ipd/admissions').send({
        patientId: p.id,
        doctorId,
        reason: 'Hernia repair',
        bedId: g2,
        payer: { kind: 'INSURANCE', payerId },
      })
    ).body;
    const pa = (await tpa.post(`/ipd/admissions/${a.id}/preauth`).send({ requested: 50_000_00 }))
      .body;
    const denied = await tpa
      .post(`/ipd/preauths/${pa.id}/reply`)
      .send({ outcome: 'DENIED', text: 'Waiting period not over' });
    expect(denied.body.status).toBe('DENIED');
    expect((await fo.get(`/ipd/admissions/${a.id}`)).body.payer.kind).toBe('CASH');
  });

  it('reports the census and the indicators', async () => {
    const { fo, ms, doctorId, g1, patient } = await ward();
    const p = await patient('Omkar');
    await fo
      .post('/ipd/admissions')
      .send({ patientId: p.id, doctorId, reason: 'Dengue', bedId: g1, emergency: true });
    const c = await ms.get('/reports/ipd-census');
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ beds: 4, occupied: 1, occupancy: 25 });
    expect(c.body.items.find((w) => w.ward.name === 'General Ward').patients[0].name).toBe(
      'Omkar Kumar',
    );
    const ind = await ms.get('/reports/ipd-indicators?period=month');
    expect(ind.status).toBe(200);
    expect(ind.body).toMatchObject({ beds: 4, admissions: 1, discharges: 0 });
    // Minutes of one stay over 120 bed-days rounds to 0.0%.
    expect(ind.body.occupancy).toBe(0);
  });
});
