import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { client, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { wardHospital } from '../helpers/ward.js';
import { encrypt, decrypt } from '../../src/modules/pmjay/nhcx/jwe.js';
import { claimResponse } from '../../src/modules/pmjay/nhcx/fhir.js';

const ctx = useIntegration();

/** A hospital on IPD + PM-JAY with a TPA desk (Ayushman Mitra), a cashier, a doctor and packages. */
async function pmjayHospital() {
  const h = await wardHospital(ctx, {
    modules: ['PMJ'],
    users: [
      ['tpa', 'tpa'],
      ['cash', 'cashier'],
      ['bm', 'billingmgr'],
    ],
  });
  const tpa = await signIn(ctx.app, h.t.host, 'tpa');
  const cash = await signIn(ctx.app, h.t.host, 'cash');
  const doc = await signIn(ctx.app, h.t.host, 'doc');
  const bm = await signIn(ctx.app, h.t.host, 'bm');
  const sa = await signIn(ctx.app, h.t.host);
  await cash.post('/billing/shifts').send({ counter: 'IP1', openingCash: 0 });
  const chole = (
    await sa.post('/pmjay/packages').send({
      code: 'sg039a',
      name: 'Laparoscopic cholecystectomy',
      specialty: 'General Surgery',
      rate: 22_800_00,
      stayDays: 3,
      documents: { preauth: ['USG abdomen report'], claim: ['Histopathology report'] },
    })
  ).body;
  const fever = (
    await sa.post('/pmjay/packages').send({
      code: 'MG001A',
      name: 'Acute febrile illness',
      specialty: 'General Medicine',
      rate: 1_800_00,
      preauthRequired: false,
    })
  ).body;
  const reserved = (
    await sa.post('/pmjay/packages').send({
      code: 'SG100A',
      name: 'Public-only package',
      specialty: 'General Surgery',
      rate: 5_000_00,
      reservedForPublic: true,
    })
  ).body;
  return { ...h, tpa, cash, doc, bm, sa, chole, fever, reserved };
}

const doc = (c, id, stage, name) =>
  c.post(`/pmjay/cases/${id}/documents`).send({ stage, name, fileId: randomUUID() });

async function discharge(h, admissionId) {
  await h.doc.put(`/ipd/admissions/${admissionId}/discharge-summary`).send({
    diagnoses: [{ code: 'K80.2', name: 'Gallstones' }],
    medicines: [{ name: 'Paracetamol 650 mg', frequency: 'SOS', days: 3 }],
    followUp: { note: 'Review after 7 days' },
  });
  await h.doc.post(`/ipd/admissions/${admissionId}/discharge-summary/sign`);
  await h.doc.post(`/ipd/admissions/${admissionId}/advise-discharge`);
  const fb = await h.cash.post(`/ipd/admissions/${admissionId}/final-bill`);
  expect(fb.status).toBe(200);
  // Cashless: nothing is owed by the patient, so no Medical Superintendent approval (R17).
  const out = await h.bm
    .post(`/ipd/admissions/${admissionId}/discharge`)
    .send({ outcome: 'NORMAL' });
  expect(out.status).toBe(200);
  expect(out.body.status).toBe('DISCHARGED');
  return fb.body;
}

describe('pmjay', () => {
  it('runs a TMS cashless case end to end: register, package bill, pre-auth clock and query, discharge without dues, claim, payment settles the bill', async () => {
    const h = await pmjayHospital();
    const a = await h.admit('Ramesh', 'GW-01');
    // The stay is listed for the Ayushman Mitra until registered.
    expect((await h.tpa.get('/pmjay/stays')).body.items.map((s) => s.ipNo)).toContain(a.ipNo);

    const unverified = await h.tpa.post('/pmjay/cases').send({
      admissionId: a.id,
      beneficiary: { pmjayId: 'PMJ12345678' },
    });
    expect(unverified.status).toBe(422);
    const reg = await h.tpa.post('/pmjay/cases').send({
      admissionId: a.id,
      beneficiary: {
        pmjayId: 'PMJ12345678',
        name: 'Ramesh Kumar',
        verification: { method: 'AADHAAR_OTP', ref: 'BIS-778' },
      },
    });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({
      status: 'REGISTERED',
      dueKind: 'PREAUTH_INITIATE',
      channel: 'TMS',
    });
    // Private hospital: 48 hours to raise the pre-auth.
    expect(new Date(reg.body.dueAt) - Date.now()).toBeGreaterThan(47 * 3_600_000);
    const id = reg.body.id;
    expect(
      (
        await h.tpa.post('/pmjay/cases').send({
          admissionId: a.id,
          beneficiary: { pmjayId: 'PMJ12345678', verification: { method: 'FALLBACK' } },
        })
      ).body.error.code,
    ).toBe('CASE_EXISTS');

    // The stay moved to the scheme.
    const stay = (await h.fo.get(`/ipd/admissions/${a.id}`)).body;
    expect(stay.payer.kind).toBe('SCHEME');

    // Private hospital cannot book a public-only package.
    expect(
      (await h.tpa.put(`/pmjay/cases/${id}/packages`).send({ packageIds: [h.reserved.id] })).body
        .error.code,
    ).toBe('PACKAGE_RESERVED');
    const pk = await h.tpa
      .put(`/pmjay/cases/${id}/packages`)
      .send({ packageIds: [h.chole.id], diagnosis: 'K80.2 Gallstones' });
    expect(pk.body.packageTotal).toBe(22_800_00);
    expect(pk.body.missing.preauth).toContain('USG abdomen report');

    // The running IP bill is the package rate, billed to the scheme.
    const bill = (await h.fo.get(`/ipd/admissions/${a.id}`)).body.bill;
    expect(bill.total).toBe(22_800_00);
    expect(bill.lines.map((l) => l.code)).toEqual(['SG039A']);

    // Pre-auth needs the documents and the TMS pre-auth number.
    const early = await h.tpa.post(`/pmjay/cases/${id}/preauth`).send({ tmsPreauthNo: 'PA-1' });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('DOCUMENTS_MISSING');
    for (const n of [
      'Beneficiary ID (e-card)',
      'Clinical notes',
      'Supporting investigation reports',
      'USG abdomen report',
    ])
      await doc(h.tpa, id, 'PREAUTH', n);
    expect((await h.tpa.post(`/pmjay/cases/${id}/preauth`).send({})).status).toBe(422);
    const sent = await h.tpa
      .post(`/pmjay/cases/${id}/preauth`)
      .send({ tmsPreauthNo: 'PA-2026-0001' });
    expect(sent.body).toMatchObject({ status: 'PREAUTH_SENT', dueKind: 'PREAUTH_DECISION' });
    expect(new Date(sent.body.dueAt) - Date.now()).toBeLessThanOrEqual(6 * 3_600_000);

    // Query → answered → approved.
    const q = await h.tpa
      .post(`/pmjay/cases/${id}/preauth/decision`)
      .send({ outcome: 'QUERY', text: 'Attach LFT report' });
    expect(q.body).toMatchObject({ status: 'PREAUTH_QUERY', dueKind: 'PREAUTH_QUERY_REPLY' });
    await h.tpa
      .post(`/pmjay/cases/${id}/preauth/answer-query`)
      .send({ text: 'LFT attached in TMS' });
    const ok = await h.tpa
      .post(`/pmjay/cases/${id}/preauth/decision`)
      .send({ outcome: 'APPROVED' });
    expect(ok.body).toMatchObject({
      status: 'PREAUTH_APPROVED',
      amounts: { preauthApproved: 22_800_00 },
    });

    // Claim before discharge is refused.
    expect((await h.tpa.post(`/pmjay/cases/${id}/claim`).send({ tmsClaimNo: 'CL-1' })).status).toBe(
      409,
    );

    // Discharge: no deposit was taken and no dues approval is needed.
    const fb = await discharge(h, a.id);
    expect(fb.bill.total).toBe(22_800_00);
    const afterDischarge = (await h.tpa.get(`/pmjay/cases/${id}`)).body;
    expect(afterDischarge).toMatchObject({
      status: 'DISCHARGED',
      dueKind: 'CLAIM_SUBMIT',
      outcome: 'NORMAL',
    });
    expect(afterDischarge.missing.claim).toEqual(
      expect.arrayContaining(['Discharge summary', 'Final bill', 'Histopathology report']),
    );

    for (const n of [
      'Discharge summary',
      'Post-procedure photograph',
      'Patient feedback form',
      'Final bill',
      'Histopathology report',
    ])
      await doc(
        h.tpa,
        id,
        n === 'Final bill' || n === 'Histopathology report' ? 'CLAIM' : 'DISCHARGE',
        n,
      );
    const claim = await h.tpa.post(`/pmjay/cases/${id}/claim`).send({ tmsClaimNo: 'CL-2026-0001' });
    expect(claim.body).toMatchObject({
      status: 'CLAIM_SUBMITTED',
      dueKind: 'CLAIM_PAYMENT',
      amounts: { claimed: 22_800_00 },
    });

    // Approved with a ₹800 deduction, then paid: the bill is settled and the shortfall written off.
    const appr = await h.tpa.post(`/pmjay/cases/${id}/claim/decision`).send({
      outcome: 'APPROVED',
      amount: 22_000_00,
      deductions: [{ reason: 'Implant sticker missing', amount: 800_00 }],
    });
    expect(appr.body).toMatchObject({
      status: 'CLAIM_APPROVED',
      amounts: { claimApproved: 22_000_00 },
    });
    expect(
      (await h.tpa.post(`/pmjay/cases/${id}/payment`).send({ amount: 23_000_00, utr: 'UTR1' }))
        .status,
    ).toBe(422);
    const paid = await h.tpa
      .post(`/pmjay/cases/${id}/payment`)
      .send({ amount: 22_000_00, utr: 'SBIN26100001' });
    expect(paid.body).toMatchObject({ status: 'PAID', amounts: { paid: 22_000_00 } });
    const final = (await h.cash.get(`/billing/bills/${fb.bill.billId}`)).body;
    expect(final).toMatchObject({ status: 'PAID', payer: { kind: 'SCHEME' } });
    expect(final.totals.balance).toBe(0);

    const sum = (await h.tpa.get('/pmjay/summary')).body;
    expect(sum).toMatchObject({
      claimed: 22_800_00,
      approved: 22_000_00,
      paid: 22_000_00,
      deductions: 800_00,
    });
  });

  it('auto-approves a package without pre-auth, rejects back to cash, and cancels', async () => {
    const h = await pmjayHospital();
    const reg = async (bed, name) => {
      const a = await h.admit(name, bed);
      const c = (
        await h.tpa.post('/pmjay/cases').send({
          admissionId: a.id,
          beneficiary: { pmjayId: `PMJ${name}`, verification: { method: 'AADHAAR_BIOMETRIC' } },
        })
      ).body;
      for (const n of [
        'Beneficiary ID (e-card)',
        'Clinical notes',
        'Supporting investigation reports',
      ])
        await doc(h.tpa, c.id, 'PREAUTH', n);
      return { a, c };
    };
    const one = await reg('GW-01', 'Sita');
    await h.tpa.put(`/pmjay/cases/${one.c.id}/packages`).send({ packageIds: [h.fever.id] });
    const auto = await h.tpa
      .post(`/pmjay/cases/${one.c.id}/preauth`)
      .send({ tmsPreauthNo: 'PA-9' });
    expect(auto.body).toMatchObject({ status: 'PREAUTH_APPROVED', dueAt: null });

    // Rejected: back to cash and the itemised bill (the bed day).
    const two = await reg('GW-02', 'Gita');
    await h.tpa.put(`/pmjay/cases/${two.c.id}/packages`).send({ packageIds: [h.chole.id] });
    await doc(h.tpa, two.c.id, 'PREAUTH', 'USG abdomen report');
    await h.tpa.post(`/pmjay/cases/${two.c.id}/preauth`).send({ tmsPreauthNo: 'PA-10' });
    const rej = await h.tpa
      .post(`/pmjay/cases/${two.c.id}/preauth/decision`)
      .send({ outcome: 'REJECTED', text: 'Not covered' });
    expect(rej.body.status).toBe('PREAUTH_REJECTED');
    const stay = (await h.fo.get(`/ipd/admissions/${two.a.id}`)).body;
    expect(stay.payer.kind).toBe('CASH');
    expect(stay.bill.lines.some((l) => l.code === 'SG039A')).toBe(false);

    // Cancelled before pre-auth.
    const three = await reg('PW-01', 'Mohan');
    await h.tpa.put(`/pmjay/cases/${three.c.id}/packages`).send({ packageIds: [h.chole.id] });
    const cancel = await h.tpa
      .post(`/pmjay/cases/${three.c.id}/cancel`)
      .send({ reason: 'Wrong patient' });
    expect(cancel.body.status).toBe('CANCELLED');
    expect((await h.fo.get(`/ipd/admissions/${three.a.id}`)).body.payer.kind).toBe('CASH');
  });

  it('runs an NHCX case in mock mode through the callback path, and opens a real JWE callback', async () => {
    const h = await pmjayHospital();
    await h.sa.put('/pmjay/settings').send({
      channel: 'NHCX',
      hfrId: 'IN2710000123',
      nhcx: { mode: 'MOCK', participantCode: 'hospital-demo@hcx', payerCode: 'pmjay-sha@hcx' },
    });
    const a = await h.admit('Kiran', 'GW-01');
    const c = (
      await h.tpa.post('/pmjay/cases').send({
        admissionId: a.id,
        beneficiary: {
          pmjayId: 'PMJ999',
          abha: '91-1234-5678-9012',
          verification: { method: 'AADHAAR_OTP' },
        },
      })
    ).body;
    expect(c.channel).toBe('NHCX');
    await h.tpa.put(`/pmjay/cases/${c.id}/packages`).send({ packageIds: [h.chole.id] });
    for (const n of [
      'Beneficiary ID (e-card)',
      'Clinical notes',
      'Supporting investigation reports',
      'USG abdomen report',
    ])
      await doc(h.tpa, c.id, 'PREAUTH', n);

    // The FHIR bundle that goes out.
    const fhir = (await h.tpa.get(`/pmjay/cases/${c.id}/fhir`)).body;
    expect(fhir.resourceType).toBe('Bundle');
    const claim = fhir.entry[0].resource;
    expect(claim).toMatchObject({
      resourceType: 'Claim',
      use: 'preauthorization',
      total: { value: 22800, currency: 'INR' },
    });
    expect(claim.item[0].productOrService.coding[0].code).toBe('SG039A');
    expect(claim.supportingInfo).toHaveLength(4);

    const sent = await h.tpa.post(`/pmjay/cases/${c.id}/preauth`).send({});
    expect(sent.body.status).toBe('PREAUTH_SENT');
    expect(sent.body.nhcx.calls[0]).toMatchObject({ action: 'preauth', status: 'ACCEPTED' });
    const ok = await h.tpa
      .post(`/pmjay/cases/${c.id}/nhcx/mock-response`)
      .send({ use: 'preauthorization', outcome: 'APPROVED', amount: 22_800_00, text: 'Approved' });
    expect(ok.body).toMatchObject({
      status: 'PREAUTH_APPROVED',
      tms: { preauthNo: `MOCK-PA-${a.ipNo}` },
    });
    expect(ok.body.events.at(-1).by).toBe('NHCX');

    // JWE round trip as NHCX sends it, and the public callback endpoint.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pub = publicKey.export({ type: 'spki', format: 'pem' });
    const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const token = encrypt({ hello: 'world' }, pub, { 'x-hcx-correlation_id': 'abc' });
    expect(decrypt(token, priv)).toMatchObject({
      header: { 'x-hcx-correlation_id': 'abc', alg: 'RSA-OAEP-256' },
      payload: { hello: 'world' },
    });
    const parts = token.split('.');
    parts[3] = Buffer.from('tampered payload').toString('base64url');
    expect(() => decrypt(parts.join('.'), priv)).toThrow();

    // Discharge, claim over NHCX, payer answers on the public on_submit endpoint.
    const fb = await discharge(h, a.id);
    for (const n of [
      'Discharge summary',
      'Post-procedure photograph',
      'Patient feedback form',
      'Final bill',
      'Histopathology report',
    ])
      await doc(h.tpa, c.id, 'CLAIM', n);
    const cl = await h.tpa.post(`/pmjay/cases/${c.id}/claim`).send({});
    expect(cl.body.status).toBe('CLAIM_SUBMITTED');
    const correlationId = cl.body.nhcx.correlationId;
    process.env.NHCX_PRIVATE_KEY = priv;
    try {
      const payload = encrypt(
        claimResponse({
          use: 'claim',
          outcome: 'complete',
          amount: fb.bill.total,
          text: 'Claim approved',
        }),
        pub,
        { 'x-hcx-correlation_id': correlationId, 'x-hcx-sender_code': 'pmjay-sha@hcx' },
      );
      const cb = await client(ctx.app, h.t.host)
        .post('/pmjay/nhcx/claim/on_submit')
        .send({ payload });
      expect(cb.status).toBe(202);
      const bad = await client(ctx.app, h.t.host)
        .post('/pmjay/nhcx/claim/on_submit')
        .send({ payload: 'x'.repeat(40) });
      expect(bad.status).toBe(401);
    } finally {
      delete process.env.NHCX_PRIVATE_KEY;
    }
    const after = (await h.tpa.get(`/pmjay/cases/${c.id}`)).body;
    expect(after).toMatchObject({
      status: 'CLAIM_APPROVED',
      amounts: { claimApproved: 22_800_00 },
    });
  });

  it('imports the State Health Agency rate list: adds new codes, revises existing rates', async () => {
    const h = await pmjayHospital();
    const row = (code, rate) => ({
      code,
      name: `Package ${code.toUpperCase()}`,
      specialty: 'Cardiology',
      rate,
    });
    const first = await h.sa
      .post('/pmjay/packages/import')
      .send({ rows: [row('mc011a', 1_00_000_00), row('SG039A', 25_000_00)] });
    expect(first.body).toMatchObject({ added: 1, updated: 1, total: 2 });
    const again = await h.sa
      .post('/pmjay/packages/import')
      .send({ rows: [row('MC011A', 1_00_000_00)] });
    expect(again.body).toMatchObject({ added: 0, updated: 0 });
    const list = (await h.tpa.get('/pmjay/packages?q=SG039A')).body.items;
    expect(list[0].rate).toBe(25_000_00);
  });

  it('is a subscription module and a desk permission', async () => {
    const { makeTenant } = await import('../helpers/int.js');
    const t = await makeTenant({ modules: ['OPD', 'IPD'] });
    const sa = await signIn(ctx.app, t.host);
    const r = await sa.get('/pmjay/cases');
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe('MODULE_NOT_SUBSCRIBED');
    const h = await pmjayHospital();
    await makeUser(h.t, { username: 'nurse1', roles: ['nurse'] });
    const nurse = await signIn(ctx.app, h.t.host, 'nurse1');
    expect((await nurse.get('/pmjay/cases')).status).toBe(403);
  });
});
