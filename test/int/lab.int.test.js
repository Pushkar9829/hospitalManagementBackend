import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { outbox } from '../../src/core/notify/notify.service.js';
import { PriceList, Service, TaxCode } from '../../src/modules/setup/index.js';
import { sendReportSms } from '../../src/modules/lab/index.js';
import { fromOpdVisit } from '../../src/modules/lab/services/order.service.js';
import { escalateCalls } from '../../src/modules/lab/services/result.service.js';
import { Culture } from '../../src/modules/lab/models/micro.models.js';

const ctx = useIntegration();
const key = (req) => req.set('Idempotency-Key', randomUUID());

/**
 * A hospital with CBC, KFT and HIV tests, a lab technician and a pathologist (both "lab"), a
 * nurse, a cashier with an open shift, the front office and a doctor.
 */
async function lab() {
  const t = await makeTenant({ modules: ['OPD', 'IPD', 'LAB'] });
  for (const [u, r] of [
    ['tech', 'lab'],
    ['path', 'lab'],
    ['fo', 'frontoffice'],
    ['cash', 'cashier'],
    ['nurse', 'nurse'],
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
              category: 'LAB',
              taxCodeId: exempt._id,
              status: 'ACTIVE',
              isActive: true,
              rates: [{ priceListId: general._id, amount }],
            },
          ])
        )[0]._id,
      );
    return {
      cbc: await make('CBC', 'Complete blood count', 35000),
      kft: await make('KFT', 'Kidney function test', 65000),
      hiv: await make('HIV', 'HIV 1 and 2', 50000),
      ucs: await make('UCS', 'Urine culture and sensitivity', 80000),
      hpe: await make('HPE', 'Histopathology, small biopsy', 150000),
    };
  });
  const users = {};
  for (const u of ['tech', 'path', 'fo', 'cash', 'nurse', 'doc'])
    users[u] = await signIn(ctx.app, t.host, u);
  await users.cash.post('/billing/shifts').send({ counter: 'LAB1', openingCash: 0 });
  const patient = async (first, gender = 'M', mobile = '9876543210') =>
    (
      await users.fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first, last: 'Sharma' },
        gender,
        mobile,
        birth: { age: { years: 45 } },
        noKnownAllergies: true,
        confirmNotDuplicate: true,
      })
    ).body;
  return { t, svc, patient, ...users };
}

/** Walk-in order, paid, collected and received: returns the test rows and the sample number. */
async function receivedWalkIn(ctxLab, tests, p, duplicateReason) {
  const { tech, cash } = ctxLab;
  const order = await tech.post('/lab/orders').send({ patientId: p.id, tests, duplicateReason });
  expect(order.status).toBe(201);
  const draft = (await cash.get(`/billing/bills/${order.body.billId}`)).body;
  const bill = (
    await key(cash.post(`/billing/bills/${draft.id}/finalize`)).send({ version: draft.version })
  ).body;
  const paid = await key(cash.post('/billing/payments')).send({
    patientId: p.id,
    mode: 'CASH',
    amount: bill.totals.balance / 100,
    allocations: [{ billId: bill.id, amount: bill.totals.balance / 100 }],
  });
  expect(paid.status).toBe(201);
  const labels = await tech
    .post('/lab/collect')
    .send({ itemIds: order.body.items.map((i) => i.id), scan: p.uhid });
  expect(labels.status).toBe(200);
  for (const l of labels.body.labels)
    expect((await tech.post(`/lab/samples/${l.sampleNo}/receive`)).status).toBe(200);
  return { order: order.body, labels: labels.body.labels };
}

async function qcInControl(tech, analyser = 'HAEM-1') {
  const control = await tech
    .post('/lab/qc/controls')
    .send({ analyser, analyte: 'HB', level: 'L1', mean: 8, sd: 0.2, unit: 'g/dL' });
  expect(control.status).toBe(201);
  const run = await tech.post('/lab/qc/runs').send({ controlId: control.body.id, value: 8.1 });
  expect(run.body).toMatchObject({ status: 'IN_CONTROL', rules: [] });
  return control.body.id;
}

describe('laboratory', () => {
  it('walk-in: pay before collection (R2), wristband check (R1), barcode per container, receive and reject (R3)', async () => {
    const L = await lab();
    const p = await L.patient('Ravi');
    const order = await L.tech
      .post('/lab/orders')
      .send({ patientId: p.id, tests: [L.svc.cbc, L.svc.kft], priority: 'ROUTINE' });
    expect(order.status).toBe(201);
    expect(order.body.orderNo).toMatch(/^LAB\//);
    expect(order.body.items.map((i) => i.code).sort()).toEqual(['CBC', 'KFT']);

    const list = (await L.tech.get('/lab/collection')).body.items;
    expect(list[0]).toMatchObject({ orderNo: order.body.orderNo, payment: 'UNPAID' });
    const ids = order.body.items.map((i) => i.id);
    const unpaid = await L.tech.post('/lab/collect').send({ itemIds: ids, scan: p.uhid });
    expect(unpaid.status).toBe(402);
    expect(unpaid.body.error.code).toBe('PAYMENT_PENDING');

    const draft = (await L.cash.get(`/billing/bills/${order.body.billId}`)).body;
    expect(draft).toMatchObject({ status: 'DRAFT', totals: { total: 100000 } });
    const bill = (
      await key(L.cash.post(`/billing/bills/${draft.id}/finalize`)).send({ version: draft.version })
    ).body;
    expect((await L.tech.get('/lab/collection')).body.items[0].payment).toBe('UNPAID');
    await key(L.cash.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'CASH',
      amount: 1000,
      allocations: [{ billId: bill.id, amount: 1000 }],
    });

    const wrong = await L.tech.post('/lab/collect').send({ itemIds: ids, scan: 'CC9999999' });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('WRONG_PATIENT');
    const ok = await L.tech.post('/lab/collect').send({ itemIds: ids, scan: p.uhid.toLowerCase() });
    expect(ok.status).toBe(200);
    // CBC in a lavender tube, KFT in a red one: two barcodes.
    expect(ok.body.labels).toHaveLength(2);
    expect(ok.body.labels[0].sampleNo).toMatch(/^S\d{4}\d{6}$/);

    const transit = (await L.tech.get('/lab/samples')).body.items;
    expect(transit).toHaveLength(2);
    const [cbcLabel, kftLabel] = ok.body.labels.sort((a, b) =>
      a.tests[0].localeCompare(b.tests[0]),
    );
    const received = await L.tech.post(`/lab/samples/${cbcLabel.sampleNo}/receive`);
    expect(received.body).toMatchObject({ status: 'RECEIVED' });
    expect((await L.tech.post(`/lab/samples/${cbcLabel.sampleNo}/receive`)).status).toBe(409);
    const cbc = (await L.tech.get('/lab/items?stage=results')).body.items[0];
    expect(cbc).toMatchObject({ code: 'CBC', status: 'RECEIVED' });
    expect(cbc.dueAt).toBeTruthy(); // R11: walk-in TAT runs from receipt

    const before = outbox.length;
    const bad = await L.tech
      .post(`/lab/samples/${kftLabel.sampleNo}/reject`)
      .send({ reason: 'BAD' });
    expect(bad.status).toBe(422);
    const rejected = await L.tech
      .post(`/lab/samples/${kftLabel.sampleNo}/reject`)
      .send({ reason: 'HAEMOLYSED', note: 'Pink serum' });
    expect(rejected.body).toMatchObject({ status: 'REJECTED', rejectReason: 'HAEMOLYSED' });
    const again = (await L.tech.get('/lab/collection')).body.items[0];
    expect(again.tests).toEqual([expect.objectContaining({ code: 'KFT', recollect: true })]);
    expect(again.payment).toBe('OK');
    // The SMS goes out through the event subscriber (worker); run it here.
    const { sendRejectedSms } = await import('../../src/modules/lab/index.js');
    await runAsSystem(L.t.tenant._id, () =>
      sendRejectedSms({
        mobile: p.mobile ?? '9876543210',
        source: 'WALKIN',
        tests: ['KFT'],
        reason: 'HAEMOLYSED',
      }),
    );
    expect(outbox.slice(before).some((m) => m.template === 'LAB_SAMPLE_REJECTED')).toBe(true);
    expect((await L.tech.get(`/lab/samples/NOSUCH1`)).body.error.code).toBe('UNKNOWN_SAMPLE');
  });

  it('results: QC gate (R4), ranges and critical values (R6, R7), two-step release (R9)', async () => {
    const L = await lab();
    const p = await L.patient('Mohan');
    const { order } = await receivedWalkIn(L, [L.svc.cbc], p);
    const item = order.items[0];
    const values = [
      { code: 'HB', value: '6.5' },
      { code: 'TLC', value: '12500' },
      { code: 'PLT', value: '220000' },
    ];
    // A QC control exists for HAEM-1 but no run yet.
    const control = await L.tech
      .post('/lab/qc/controls')
      .send({ analyser: 'HAEM-1', analyte: 'HB', level: 'L1', mean: 8, sd: 0.2 });
    const blocked = await L.tech.put(`/lab/items/${item.id}/results`).send({ results: values });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('QC_NOT_IN_CONTROL');
    await L.tech.post('/lab/qc/runs').send({ controlId: control.body.id, value: 8.1 });

    const entered = await L.tech.put(`/lab/items/${item.id}/results`).send({ results: values });
    expect(entered.status).toBe(200);
    const byCode = Object.fromEntries(entered.body.results.map((r) => [r.code, r]));
    expect(byCode.HB).toMatchObject({ value: '6.5', flag: 'LL', critical: true, range: '13 - 17' });
    expect(byCode.TLC).toMatchObject({ flag: 'H' });
    expect(byCode.PLT).toMatchObject({ flag: 'N' });
    expect(entered.body.holds).toEqual([expect.objectContaining({ kind: 'CRITICAL', open: true })]);

    expect((await L.tech.post(`/lab/items/${item.id}/release`).send({})).status).toBe(409);
    expect((await L.tech.post(`/lab/items/${item.id}/verify`)).body.status).toBe('VERIFIED');
    const self = await L.tech.post(`/lab/items/${item.id}/release`).send({});
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('MAKER_CHECKER');
    const pending = await L.path.post(`/lab/items/${item.id}/release`).send({});
    expect(pending.body.error.code).toBe('CRITICAL_CALL_PENDING');

    const calls = (await L.nurse.get('/lab/critical-calls')).body.items;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ analyte: 'Haemoglobin', value: '6.5 g/dL', status: 'OPEN' });
    const noReadBack = await L.tech
      .post(`/lab/critical-calls/${calls[0].id}/log`)
      .send({ to: 'Dr. Menon', role: 'DOCTOR', reached: true, readBack: false });
    expect(noReadBack.status).toBe(422);
    const missed = await L.tech
      .post(`/lab/critical-calls/${calls[0].id}/log`)
      .send({ to: 'Dr. Menon', role: 'DOCTOR', reached: false });
    expect(missed.body.status).toBe('OPEN');
    // Not reached by the escalation time: the HOD is told.
    const escalated = await runAsSystem(L.t.tenant._id, () =>
      escalateCalls(new Date(Date.now() + 16 * 60_000)),
    );
    expect(escalated).toBe(1);
    const done = await L.tech
      .post(`/lab/critical-calls/${calls[0].id}/log`)
      .send({ to: 'Dr. Menon', role: 'DOCTOR', reached: true, readBack: true });
    expect(done.body).toMatchObject({ status: 'DONE' });
    expect(done.body.attempts).toHaveLength(2);

    const released = await L.path.post(`/lab/items/${item.id}/release`).send({ comment: 'Phoned' });
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ status: 'RELEASED', releasedBy: 'User path' });
    const report = (await L.doc.get(`/lab/reports/${encodeURIComponent(order.orderNo)}`)).body;
    expect(report.tests[0]).toMatchObject({ code: 'CBC', nabl: true, reportVersion: 1 });
    expect(
      (await L.tech.put(`/lab/items/${item.id}/results`).send({ results: values })).status,
    ).toBe(409);
    const ack = await L.doc.post(`/lab/items/${item.id}/acknowledge`);
    expect(ack.body.acknowledgedBy).toBe('User doc');
  });

  it('Westgard: 1-2s warns, 1-3s and 2-2s reject the run and hold patient results (R5)', async () => {
    const L = await lab();
    const p = await L.patient('Leela', 'F');
    const controlId = await qcInControl(L.tech);
    const { order } = await receivedWalkIn(L, [L.svc.cbc], p);
    const item = order.items[0];
    await L.tech.put(`/lab/items/${item.id}/results`).send({
      results: [
        { code: 'HB', value: '12.5' },
        { code: 'PLT', value: '250000' },
      ],
    });
    const warn = await L.tech.post('/lab/qc/runs').send({ controlId, value: 8.5 });
    expect(warn.body).toMatchObject({ status: 'WARNING', rules: ['1-2s'] });
    const twoTwo = await L.tech.post('/lab/qc/runs').send({ controlId, value: 8.45 });
    expect(twoTwo.body).toMatchObject({ status: 'REJECTED', rules: ['2-2s'], held: 1 });
    const held = (await L.tech.get(`/lab/items/${item.id}`)).body;
    expect(held.holds).toEqual([expect.objectContaining({ kind: 'QC', open: true })]);
    // The analyser is blocked until QC is back in control.
    const status = (await L.tech.get('/lab/qc/status')).body.items;
    expect(status).toEqual([expect.objectContaining({ analyser: 'HAEM-1', ok: false })]);
    const blocked = await L.tech
      .put(`/lab/items/${item.id}/results`)
      .send({ results: [{ code: 'HB', value: '12.4' }] });
    expect(blocked.body.error.code).toBe('QC_NOT_IN_CONTROL');
    const three = await L.tech.post('/lab/qc/runs').send({ controlId, value: 7.3 });
    expect(three.body).toMatchObject({ status: 'REJECTED', rules: ['1-3s'] });
    await L.tech.post('/lab/qc/runs').send({ controlId, value: 8.0 });
    const rerun = await L.tech
      .put(`/lab/items/${item.id}/results`)
      .send({ results: [{ code: 'HB', value: '12.4' }] });
    expect(rerun.status).toBe(200);
    expect(rerun.body.holds.find((h) => h.kind === 'QC').open).toBe(false);
    const lj = (await L.tech.get(`/lab/qc/levey-jennings?control=${controlId}`)).body;
    expect(lj.runs.map((r) => r.status)).toEqual([
      'IN_CONTROL',
      'WARNING',
      'REJECTED',
      'REJECTED',
      'IN_CONTROL',
    ]);
  });

  it('delta check holds for the pathologist (R8); amendment is a new version after approval (R10)', async () => {
    const L = await lab();
    const p = await L.patient('Gopal');
    await qcInControl(L.tech);
    const run = async (hb, repeat) => {
      const { order } = await receivedWalkIn(L, [L.svc.cbc], p, repeat);
      const id = order.items[0].id;
      const r = await L.tech
        .put(`/lab/items/${id}/results`)
        .send({ results: [{ code: 'HB', value: hb }] });
      await L.tech.post(`/lab/items/${id}/verify`);
      return { id, entered: r.body };
    };
    const first = await run('14.0');
    expect((await L.path.post(`/lab/items/${first.id}/release`).send({})).status).toBe(200);

    const second = await run('10.0', 'Post-operative check');
    expect(second.entered.results[0].delta).toMatchObject({ prev: '14', changePct: 28.6 });
    expect(second.entered.holds).toEqual([expect.objectContaining({ kind: 'DELTA', open: true })]);
    const noComment = await L.path.post(`/lab/items/${second.id}/release`).send({});
    expect(noComment.status).toBe(422);
    const ok = await L.path
      .post(`/lab/items/${second.id}/release`)
      .send({ acceptDelta: true, comment: 'Identity checked; post-operative fall' });
    expect(ok.body).toMatchObject({ status: 'RELEASED' });

    const amend = await L.tech
      .post(`/lab/items/${second.id}/amend`)
      .send({ reason: 'Transcription error', results: [{ code: 'HB', value: '10.4' }] });
    expect(amend.status).toBe(202);
    const approval = (await L.path.get(`/approvals/${amend.body.approvalId}`)).body;
    const decided = await L.path
      .post(`/approvals/${amend.body.approvalId}/decision`)
      .send({ decision: 'APPROVE', comment: 'Checked', version: approval.version });
    expect(decided.status).toBe(200);
    const after = (await L.tech.get(`/lab/items/${second.id}`)).body;
    expect(after).toMatchObject({ reportVersion: 2, status: 'RELEASED' });
    expect(after.results[0].value).toBe('10.4');
    expect(after.amendments).toEqual([
      expect.objectContaining({ version: 1, reason: 'Transcription error' }),
    ]);
  });

  it('sensitive results never go by SMS (R13); OPD orders reach the worklist; duplicates need a reason', async () => {
    const L = await lab();
    const p = await L.patient('Anil');
    const before = outbox.length;
    await runAsSystem(L.t.tenant._id, async () => {
      await sendReportSms({
        mobile: '9876543210',
        sensitive: true,
        test: 'HIV',
        orderNo: 'X',
        version: 1,
      });
      await sendReportSms({
        mobile: '9876543210',
        sensitive: false,
        test: 'CBC',
        orderNo: 'Y',
        version: 1,
      });
    });
    const sent = outbox.slice(before).filter((m) => m.template === 'LAB_REPORT_READY');
    expect(sent.map((m) => m.vars.test)).toEqual(['CBC']);

    const visitId = '65f000000000000000000001';
    const orderNo = await runAsSystem(L.t.tenant._id, () =>
      fromOpdVisit({
        visitId,
        patientId: p.id,
        orders: [
          { code: 'CBC', serviceId: L.svc.cbc, priority: 'URGENT' },
          { code: 'XRAY', serviceId: null },
        ],
      }),
    );
    expect(orderNo).toMatch(/^LAB\//);
    const items = (await L.tech.get(`/lab/items?visitId=${visitId}`)).body.items;
    expect(items).toEqual([
      expect.objectContaining({ code: 'CBC', source: 'OPD', priority: 'URGENT' }),
    ]);
    // Unpaid until the clinic desk closes the visit.
    expect((await L.tech.get('/lab/collection?source=OPD')).body.items[0].payment).toBe('UNBILLED');

    await L.doc.post('/lab/orders').send({ patientId: p.id, tests: [L.svc.kft] });
    const dupe = await L.doc.post('/lab/orders').send({ patientId: p.id, tests: [L.svc.kft] });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('DUPLICATE_ORDER');
    const withReason = await L.doc
      .post('/lab/orders')
      .send({ patientId: p.id, tests: [L.svc.kft], duplicateReason: 'Repeat after dialysis' });
    expect(withReason.status).toBe(201);
    const cancel = await L.doc
      .post(`/lab/items/${withReason.body.items[0].id}/cancel`)
      .send({ reason: 'Ordered twice' });
    expect(cancel.body.status).toBe('CANCELLED');
    const counts = (await L.tech.get('/lab/items/counts')).body;
    expect(counts.collect).toBe(2);
  });

  it('culture: plate, readings, organism and sensitivity, final, release and antibiogram (flow H)', async () => {
    const L = await lab();
    const p = await L.patient('Sita', 'F');
    const q = await L.patient('Gita', 'F', '9876500002');
    const { order } = await receivedWalkIn(L, [L.svc.ucs], p);
    // Not on the direct result-entry list: cultures have their own bench.
    expect((await L.tech.get('/lab/items?stage=results')).body.items).toHaveLength(0);
    const culture = (await L.tech.get('/lab/cultures')).body.items[0];
    expect(culture).toMatchObject({
      status: 'RECEIVED',
      orderNo: order.orderNo,
      test: 'Urine culture and sensitivity',
    });
    const id = culture.id;
    expect((await L.tech.post(`/lab/cultures/${id}/final`)).body.error.code).toBe(
      'CULTURE_NOT_READY',
    );
    expect(
      (await L.tech.post(`/lab/cultures/${id}/plate`).send({ media: ['CLED', 'Blood agar'] })).body
        .status,
    ).toBe('PLATED');
    const read = await L.tech
      .post(`/lab/cultures/${id}/readings`)
      .send({ growth: true, text: 'Lactose fermenting colonies' });
    expect(read.body).toMatchObject({ status: 'GROWTH_READ' });
    expect(read.body.prelimAt).toBeTruthy();
    await L.tech
      .post(`/lab/cultures/${id}/identify`)
      .send({ organism: 'Escherichia coli', colonyCount: '>10^5 CFU/mL' });
    const dup = await L.tech.post(`/lab/cultures/${id}/sensitivity`).send({
      rows: [
        { antibiotic: 'Nitrofurantoin', result: 'S' },
        { antibiotic: 'nitrofurantoin', result: 'R' },
      ],
    });
    expect(dup.status).toBe(422);
    await L.tech.post(`/lab/cultures/${id}/sensitivity`).send({
      rows: [
        { antibiotic: 'Nitrofurantoin', result: 'S' },
        { antibiotic: 'Ciprofloxacin', result: 'R' },
        { antibiotic: 'Ceftriaxone', result: 'I', mic: '2' },
      ],
    });
    const final = await L.tech.post(`/lab/cultures/${id}/final`);
    expect(final.body.status).toBe('FINAL');
    const item = (await L.tech.get(`/lab/items/${order.items[0].id}`)).body;
    expect(item).toMatchObject({ status: 'VERIFIED' });
    expect(item.results[0]).toMatchObject({ value: 'Escherichia coli, >10^5 CFU/mL', flag: 'A' });
    expect(item.comment).toContain('Ciprofloxacin: R');
    expect((await L.tech.post(`/lab/items/${item.id}/release`).send({})).status).toBe(403);
    expect((await L.path.post(`/lab/items/${item.id}/release`).send({})).body.status).toBe(
      'RELEASED',
    );

    // No growth at 48 hours.
    const other = await receivedWalkIn(L, [L.svc.ucs], q);
    const c2 = (await L.tech.get('/lab/cultures')).body.items.find(
      (c) => c.itemId === other.order.items[0].id,
    );
    await L.tech.post(`/lab/cultures/${c2.id}/plate`).send({ media: ['CLED'] });
    await runAsSystem(L.t.tenant._id, () =>
      Culture.updateOne(
        { _id: c2.id },
        { $set: { platedAt: new Date(Date.now() - 49 * 3_600_000) } },
      ).exec(),
    );
    const none = await L.tech
      .post(`/lab/cultures/${c2.id}/readings`)
      .send({ growth: false, text: 'No growth' });
    expect(none.body).toMatchObject({ noGrowth: true });
    expect(
      (await L.tech.post(`/lab/cultures/${c2.id}/identify`).send({ organism: 'X y' })).body.error
        .code,
    ).toBe('NO_GROWTH_READ');
    await L.tech.post(`/lab/cultures/${c2.id}/final`);
    expect((await L.tech.get(`/lab/items/${other.order.items[0].id}`)).body.results[0].value).toBe(
      'No growth after 48 hours of incubation',
    );

    const ab = (await L.path.get('/lab/cultures/antibiogram')).body;
    expect(ab.isolates).toBe(1);
    expect(ab.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organism: 'Escherichia coli',
          antibiotic: 'Ciprofloxacin',
          pct: 0,
        }),
      ]),
    );
  });

  it('histopathology: grossing, processing, slides, sign-out and release (flow I)', async () => {
    const L = await lab();
    const p = await L.patient('Kamla', 'F');
    const { order } = await receivedWalkIn(L, [L.svc.hpe], p);
    const c = (await L.path.get('/lab/histo/cases')).body.items[0];
    expect(c).toMatchObject({ status: 'RECEIVED', caseNo: expect.stringMatching(/^HP\//) });
    const noGross = await L.path.put(`/lab/histo/cases/${c.id}`).send({ advance: true });
    expect(noGross.status).toBe(422);
    await L.path
      .put(`/lab/histo/cases/${c.id}`)
      .send({ gross: 'Grey-white tissue 1.2 cm', advance: true });
    await L.path.put(`/lab/histo/cases/${c.id}`).send({ advance: true });
    const noBlocks = await L.path.put(`/lab/histo/cases/${c.id}`).send({ advance: true });
    expect(noBlocks.status).toBe(422);
    const slides = await L.path
      .put(`/lab/histo/cases/${c.id}`)
      .send({ blocks: 2, slides: 4, advance: true });
    expect(slides.body).toMatchObject({ status: 'SLIDES' });
    expect((await L.path.post(`/lab/histo/cases/${c.id}/report`)).status).toBe(422);
    await L.path.put(`/lab/histo/cases/${c.id}`).send({
      microscopy: 'Chronic cervicitis, no dysplasia',
      diagnosis: 'Chronic non-specific cervicitis. No evidence of malignancy.',
      archive: 'Cabinet B-12',
    });
    const reported = await L.path.post(`/lab/histo/cases/${c.id}/report`);
    expect(reported.body).toMatchObject({ status: 'REPORTED', reportedBy: 'User path' });
    expect(reported.body.history.map((h) => h.status)).toEqual([
      'RECEIVED',
      'GROSSED',
      'PROCESSED',
      'SLIDES',
      'REPORTED',
    ]);
    // Another pathologist releases (two-step rule).
    expect((await L.path.post(`/lab/items/${order.items[0].id}/release`).send({})).status).toBe(
      403,
    );
    const released = await L.tech.post(`/lab/items/${order.items[0].id}/release`).send({});
    expect(released.body.results[0].value).toContain('No evidence of malignancy');
  });

  it('runs a home collection: booked, assigned, paid, collected at home, handed to the lab', async () => {
    const L = await lab();
    const { t, svc, patient, fo, cash, tech } = L;
    await makeUser(t, { username: 'phleb1', roles: ['phlebotomist'] });
    await makeUser(t, { username: 'phleb2', roles: ['phlebotomist'] });
    const phleb = await signIn(ctx.app, t.host, 'phleb1');
    const other = await signIn(ctx.app, t.host, 'phleb2');
    const staff = (await tech.get('/lab/home-visits/staff')).body.items;
    expect(staff).toHaveLength(2);
    const p = await patient('Kiran');
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const booked = await fo.post('/lab/home-visits').send({
      patientId: p.id,
      tests: [svc.cbc, svc.kft],
      date: today,
      slot: '07:00-08:00',
      address: '12 Lake Road, Baner, Pune',
      phlebotomistUserId: (await phleb.get('/auth/me')).body.user.id,
    });
    expect(booked.status).toBe(201);
    expect(booked.body).toMatchObject({
      status: 'ASSIGNED',
      payment: 'UNPAID',
      tests: ['Complete blood count', 'Kidney function test'],
    });

    const mine = (await phleb.get(`/lab/home-visits?date=${today}&mine=true`)).body.items;
    expect(mine.map((v) => v.visitNo)).toEqual([booked.body.visitNo]);
    expect((await other.get(`/lab/home-visits?date=${today}&mine=true`)).body.items).toEqual([]);
    expect(
      (await other.post(`/lab/home-visits/${booked.body.id}/start`).send({ version: 0 })).status,
    ).toBe(403);
    const started = await phleb
      .post(`/lab/home-visits/${booked.body.id}/start`)
      .send({ version: 0 });
    expect(started.body.status).toBe('ON_THE_WAY');

    const unpaid = await phleb
      .post(`/lab/home-visits/${booked.body.id}/collect`)
      .send({ version: started.body.version, scan: p.uhid });
    expect(unpaid.body.error.code).toBe('PAYMENT_PENDING');
    const draft = (await cash.get(`/billing/bills/${booked.body.billId}`)).body;
    const bill = (
      await key(cash.post(`/billing/bills/${draft.id}/finalize`)).send({ version: draft.version })
    ).body;
    await key(cash.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'CASH',
      amount: bill.totals.balance / 100,
      allocations: [{ billId: bill.id, amount: bill.totals.balance / 100 }],
    });
    const wrong = await phleb
      .post(`/lab/home-visits/${booked.body.id}/collect`)
      .send({ version: started.body.version, scan: 'CC9999999' });
    expect(wrong.body.error.code).toBe('WRONG_PATIENT');
    const collected = await phleb
      .post(`/lab/home-visits/${booked.body.id}/collect`)
      .send({ version: started.body.version, scan: p.uhid });
    expect(collected.status).toBe(200);
    expect(collected.body.visit).toMatchObject({ status: 'COLLECTED', payment: 'OK' });
    expect(collected.body.labels.length).toBeGreaterThan(0);
    const handed = await phleb
      .post(`/lab/home-visits/${booked.body.id}/handover`)
      .send({ version: collected.body.visit.version });
    expect(handed.body.status).toBe('HANDED_OVER');
    for (const l of collected.body.labels)
      expect((await tech.post(`/lab/samples/${l.sampleNo}/receive`)).status).toBe(200);

    const second = await fo.post('/lab/home-visits').send({
      patientId: p.id,
      tests: [svc.hiv],
      date: today,
      slot: '09:00-10:00',
      address: '12 Lake Road, Baner, Pune',
    });
    expect(second.body.status).toBe('BOOKED');
    const cancelled = await fo
      .post(`/lab/home-visits/${second.body.id}/cancel`)
      .send({ version: 0, reason: 'Patient travelling' });
    expect(cancelled.body.status).toBe('CANCELLED');
    const items = (await tech.get('/lab/items?stage=collect')).body.items ?? [];
    expect(items.some((i) => i.orderNo === second.body.orderNo)).toBe(false);
  });

  it('registers: QC lots and rules, storage, rejections, send-outs, histology stains and archive, MRSA alert', async () => {
    const L = await lab();
    const { tech, path } = L;
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

    // QC lot register with versioned updates
    const lot = await tech
      .post('/lab/qc/lots')
      .send({
        lotNo: 'L1-2604',
        material: 'Bio-Rad Multiqual',
        level: 'L1',
        analyser: 'Cobas c311',
        expiresOn: '2027-04-30',
      });
    expect(lot.status).toBe(201);
    const closed = await tech
      .put(`/lab/qc/lots/${lot.body.id}`)
      .send({ version: lot.body.version, active: false });
    expect(closed.body.active).toBe(false);
    expect(
      (await tech.put(`/lab/qc/lots/${lot.body.id}`).send({ version: 0, active: true })).status,
    ).toBe(409);
    expect((await tech.get('/lab/qc/lots')).body.items).toHaveLength(1);

    // Westgard rules per analyser: with 1-3s only, two runs past 2 SD warn instead of rejecting
    const settings = (await path.get('/lab/settings')).body;
    await path
      .put('/lab/settings')
      .send({ version: settings.version, qcRules: [{ analyser: 'HAEM-1', reject: ['1-3s'] }] });
    const control = (
      await tech
        .post('/lab/qc/controls')
        .send({ analyser: 'HAEM-1', analyte: 'HB', level: 'L1', mean: 8, sd: 0.2, unit: 'g/dL' })
    ).body;
    await tech.post('/lab/qc/runs').send({ controlId: control.id, value: 8.5 });
    const second = await tech.post('/lab/qc/runs').send({ controlId: control.id, value: 8.5 });
    expect(second.body).toMatchObject({ status: 'WARNING' });

    // Storage and discard of a received sample
    const p = await L.patient('Sita', 'F');
    const { labels } = await receivedWalkIn(L, [L.svc.cbc], p);
    const stored = await tech
      .post(`/lab/storage/${labels[0].sampleNo}`)
      .send({ location: 'Rack H2', days: 3 });
    expect(stored.body).toMatchObject({ status: 'STORED', location: 'Rack H2' });
    expect((await tech.get('/lab/storage')).body.items[0]).toMatchObject({
      sampleNo: labels[0].sampleNo,
      due: false,
    });
    expect((await tech.post(`/lab/storage/${labels[0].sampleNo}/discard`)).body.status).toBe(
      'DISCARDED',
    );

    // Send-out to a partner lab
    const partner = await path
      .post('/lab/partners')
      .send({ code: 'METRO', name: 'Metro Reference Lab', nabl: true, tests: ['VITD'] });
    expect(partner.status).toBe(201);
    const q = await L.patient('Gita', 'F', '9876500002');
    const out = await receivedWalkIn(L, [L.svc.kft], q);
    const manifest = await tech
      .post('/lab/send-outs')
      .send({
        partnerId: partner.body.id,
        sampleNos: [out.labels[0].sampleNo],
        courier: 'Lab runner',
      });
    expect(manifest.status).toBe(201);
    expect(manifest.body).toMatchObject({
      manifestNo: expect.stringMatching(/^SO\//),
      partnerName: 'Metro Reference Lab',
    });
    const back = await tech
      .post(`/lab/send-outs/${manifest.body.id}/received`)
      .send({ version: manifest.body.version });
    expect(back.body.status).toBe('RESULTS_RECEIVED');

    // A rejected sample appears on the day's rejections
    const r = await L.patient('Rita', 'F', '9876500003');
    const ord = (await tech.post('/lab/orders').send({ patientId: r.id, tests: [L.svc.cbc] })).body;
    const draft = (await L.cash.get(`/billing/bills/${ord.billId}`)).body;
    const bill = (
      await key(L.cash.post(`/billing/bills/${draft.id}/finalize`)).send({ version: draft.version })
    ).body;
    await key(L.cash.post('/billing/payments')).send({
      patientId: r.id,
      mode: 'CASH',
      amount: bill.totals.balance / 100,
      allocations: [{ billId: bill.id, amount: bill.totals.balance / 100 }],
    });
    const col = (
      await tech.post('/lab/collect').send({ itemIds: ord.items.map((i) => i.id), scan: r.uhid })
    ).body;
    await tech.post(`/lab/samples/${col.labels[0].sampleNo}/reject`).send({ reason: 'CLOTTED' });
    const rej = (await tech.get(`/lab/samples-rejected?date=${today}`)).body.items;
    expect(rej).toEqual([
      expect.objectContaining({ sampleNo: col.labels[0].sampleNo, reason: 'CLOTTED' }),
    ]);

    // Histology: stains and archive issue and return
    const h = await L.patient('Meena', 'F', '9876500004');
    await receivedWalkIn(L, [L.svc.hpe], h);
    const hc = (await path.get('/lab/histo/cases')).body.items[0];
    await path
      .put(`/lab/histo/cases/${hc.id}`)
      .send({ specialStains: ['ER', 'PR', 'HER2'], archive: 'Cabinet 3, drawer 12' });
    expect((await path.get('/lab/histo/stains')).body.items[0]).toMatchObject({
      stains: ['ER', 'PR', 'HER2'],
      done: false,
    });
    const issued = await path
      .post(`/lab/histo/archive/${hc.id}/issue`)
      .send({ to: 'Tata Memorial (second opinion)' });
    expect(issued.body.issuedTo).toBe('Tata Memorial (second opinion)');
    expect(
      (await path.post(`/lab/histo/archive/${hc.id}/issue`).send({ to: 'Again' })).status,
    ).toBe(409);
    expect((await path.get('/lab/histo/archive')).body.items[0]).toMatchObject({
      location: 'Cabinet 3, drawer 12',
      issuedTo: 'Tata Memorial (second opinion)',
    });
    await path.post(`/lab/histo/archive/${hc.id}/return`);
    expect((await path.get('/lab/histo/archive')).body.items[0].issuedTo).toBeNull();

    // An MRSA culture raises an infection alert
    const m = await L.patient('Mohan', 'M', '9876500005');
    await receivedWalkIn(L, [L.svc.ucs], m);
    const cu = (await tech.get('/lab/cultures')).body.items.find((c) =>
      c.patient?.name?.startsWith('Mohan'),
    );
    await tech.post(`/lab/cultures/${cu.id}/plate`).send({ media: ['Blood agar'] });
    await tech
      .post(`/lab/cultures/${cu.id}/readings`)
      .send({ growth: true, text: 'Golden colonies' });
    await tech
      .post(`/lab/cultures/${cu.id}/identify`)
      .send({ organism: 'Staphylococcus aureus', colonyCount: '>10^5 CFU/mL' });
    await tech.post(`/lab/cultures/${cu.id}/sensitivity`).send({
      rows: [
        { antibiotic: 'Cefoxitin', result: 'R' },
        { antibiotic: 'Vancomycin', result: 'S' },
      ],
    });
    const alerts = (await tech.get('/lab/micro/alerts')).body.items;
    expect(alerts).toEqual([
      expect.objectContaining({ alert: 'MRSA', organism: 'Staphylococcus aureus' }),
    ]);
  });
});
