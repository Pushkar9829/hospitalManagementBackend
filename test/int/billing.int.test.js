import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { deliverEvents, makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Payer, PriceList, Service, TaxCode } from '../../src/modules/setup/index.js';
import { Journal } from '../../src/modules/finance/models/finance.models.js';
import { ApprovalRequest } from '../../src/core/approvals/approval.model.js';
import { sweepExpiredApprovals } from '../../src/core/approvals/approval.jobs.js';

const ctx = useIntegration();

/** Hospital with approved services, a cashier, a billing manager and the Super Admin. */
async function counter() {
  const t = await makeTenant();
  await makeUser(t, { username: 'cash1', roles: ['cashier'] });
  await makeUser(t, { username: 'cash2', roles: ['cashier'] });
  await makeUser(t, { username: 'bm', roles: ['billingmgr'] });
  await makeUser(t, { username: 'fo', roles: ['frontoffice'] });
  const svc = await runAsSystem(t.tenant._id, async () => {
    const lists = Object.fromEntries((await PriceList.find().lean()).map((l) => [l.code, l._id]));
    const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
    const gst5 = await TaxCode.findOne({ code: 'GST5' }).lean();
    const make = async (code, name, category, rates, tax = exempt) => {
      const [s] = await Service.create([
        {
          code,
          name,
          category,
          taxCodeId: tax._id,
          status: 'ACTIVE',
          isActive: true,
          rates: Object.entries(rates).map(([l, amount]) => ({ priceListId: lists[l], amount })),
        },
      ]);
      return String(s._id);
    };
    return {
      consult: await make('CONS', 'Consultation', 'CONSULTATION', {
        GENERAL: 50000,
        SENIOR: 40000,
      }),
      cbc: await make('CBC', 'Complete blood count', 'LAB', { GENERAL: 30000 }),
      cert: await make('CERT', 'Medical certificate', 'OTHER', { GENERAL: 20000 }, gst5),
    };
  });
  const fo = await signIn(ctx.app, t.host, 'fo');
  const patient = async (first, extra = {}) =>
    (
      await fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first, last: 'Kumar' },
        gender: 'M',
        mobile: extra.mobile ?? '9876543210',
        birth: { age: { years: extra.age ?? 47 } },
        category: extra.category ?? 'GENERAL',
        confirmNotDuplicate: true,
      })
    ).body;
  return {
    t,
    svc,
    patient,
    cash1: await signIn(ctx.app, t.host, 'cash1'),
    cash2: await signIn(ctx.app, t.host, 'cash2'),
    bm: await signIn(ctx.app, t.host, 'bm'),
    sa: await signIn(ctx.app, t.host),
  };
}

const key = (req) => req.set('Idempotency-Key', randomUUID());

async function finalBill(c, patientId, lines) {
  const draft = (await c.post('/billing/bills').send({ patientId, lines })).body;
  return (await c.post(`/billing/bills/${draft.id}/finalize`).send({ version: draft.version }))
    .body;
}

async function approve(c, approvalId) {
  const a = await c.get(`/approvals/${approvalId}`);
  return c
    .post(`/approvals/${approvalId}/decision`)
    .send({ decision: 'APPROVE', version: a.body.version });
}

describe('billing', () => {
  it('prices by payer: a senior citizen gets the senior rate, items without one fall back to general', async () => {
    const { svc, patient, cash1 } = await counter();
    const senior = await patient('Ramesh', { age: 66, category: 'SENIOR' });
    const general = await patient('Suresh', { mobile: '9800000001' });
    const a = (
      await cash1
        .post('/billing/bills')
        .send({ patientId: senior.id, lines: [{ serviceId: svc.consult }, { serviceId: svc.cbc }] })
    ).body;
    const b = (
      await cash1
        .post('/billing/bills')
        .send({ patientId: general.id, lines: [{ serviceId: svc.consult }] })
    ).body;
    expect(a.lines.map((l) => l.unitPrice)).toEqual([40000, 30000]);
    expect(a.payer.priceListCode).toBe('SENIOR');
    expect(b.lines[0].unitPrice).toBe(50000);
  });

  it('finalises with an open shift, takes UPI, prints and logs reprints as DUPLICATE', async () => {
    const { svc, patient, cash1, sa } = await counter();
    const p = await patient('Ravi');
    const draft = (
      await cash1.post('/billing/bills').send({
        patientId: p.id,
        lines: [{ serviceId: svc.consult }, { serviceId: svc.cert, qty: 1 }],
      })
    ).body;
    expect(draft.totals).toMatchObject({ gross: 70000, tax: 1000, total: 71000 });
    const noShift = await cash1
      .post(`/billing/bills/${draft.id}/finalize`)
      .send({ version: draft.version });
    expect(noShift.body.error.code).toBe('SHIFT_REQUIRED');
    expect(
      (await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 2000 })).status,
    ).toBe(201);
    const bill = (
      await cash1.post(`/billing/bills/${draft.id}/finalize`).send({ version: draft.version })
    ).body;
    expect(bill.billNo).toMatch(/^OP\/\d{2}-\d{2}\/000001$/);
    expect(
      (
        await cash1.post('/billing/payments').send({
          patientId: p.id,
          mode: 'UPI',
          amount: 710,
          allocations: [{ billId: bill.id, amount: 710 }],
        })
      ).status,
    ).toBe(400);
    const noRef = await key(cash1.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'UPI',
      amount: 710,
      allocations: [{ billId: bill.id, amount: 710 }],
    });
    expect(noRef.status).toBe(422);
    const pay = await key(cash1.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'UPI',
      amount: 710,
      reference: 'UTR123456',
      allocations: [{ billId: bill.id, amount: 710 }],
    });
    expect(pay.status).toBe(201);
    expect(pay.body.receiptNo).toMatch(/^RC\//);
    expect((await cash1.get(`/billing/bills/${bill.id}`)).body).toMatchObject({
      status: 'PAID',
      totals: { paid: 71000, balance: 0 },
    });
    const pdf = await cash1.get(`/billing/bills/${bill.id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await cash1.get(`/billing/bills/${bill.id}/pdf`)).status).toBe(422);
    expect((await cash1.get(`/billing/bills/${bill.id}/pdf?reason=Patient lost copy`)).status).toBe(
      200,
    );
    expect((await cash1.get(`/billing/payments/${pay.body.id}/pdf`)).status).toBe(200);
    const audit = await sa.get(`/audit?entity=Bill&entityId=${bill.id}&action=PRINT`);
    expect(audit.body.items.map((i) => i.summary)).toContain(
      'Reprint (DUPLICATE): Patient lost copy',
    );
  });

  it('holds a 15% discount for Billing Manager and Super Admin, then recalculates', async () => {
    const { svc, patient, cash1, bm, sa } = await counter();
    const p = await patient('Ravi');
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    const bill = await finalBill(cash1, p.id, [{ serviceId: svc.consult }, { serviceId: svc.cbc }]);
    const ask = await cash1.post(`/billing/bills/${bill.id}/discount`).send({
      version: bill.version,
      kind: 'PERCENT',
      value: 15,
      reason: 'Hospital staff family member',
    });
    expect(ask.status).toBe(202);
    expect(ask.body.bill.hold).toBe('DISCOUNT');
    const blocked = await key(cash1.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'CASH',
      amount: 800,
      allocations: [{ billId: bill.id, amount: 800 }],
    });
    expect(blocked.body.error.code).toBe('BILL_ON_HOLD');
    expect((await approve(bm, ask.body.approvalId)).body.status).toBe('PENDING');
    expect((await cash1.get(`/billing/bills/${bill.id}`)).body.hold).toBe('DISCOUNT');
    expect((await approve(sa, ask.body.approvalId)).body.status).toBe('APPLIED');
    const after = (await cash1.get(`/billing/bills/${bill.id}`)).body;
    expect(after.hold).toBeUndefined();
    expect(after).toMatchObject({
      totals: { gross: 80000, discount: 12000, total: 68000 },
      discount: { status: 'APPLIED' },
    });
  });

  it('releases a bill held for a discount when the approval expires unanswered', async () => {
    const { t, svc, patient, cash1 } = await counter();
    const p = await patient('Ravi');
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    const bill = await finalBill(cash1, p.id, [{ serviceId: svc.consult }]);
    const ask = await cash1.post(`/billing/bills/${bill.id}/discount`).send({
      version: bill.version,
      kind: 'PERCENT',
      value: 15,
      reason: 'Hospital staff family member',
    });
    await runAsSystem(t.tenant._id, () =>
      ApprovalRequest.updateOne(
        { _id: ask.body.approvalId },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      ).exec(),
    );
    const { expired } = await sweepExpiredApprovals();
    expect(expired).toBeGreaterThanOrEqual(1);
    const after = (await cash1.get(`/billing/bills/${bill.id}`)).body;
    expect(after.hold).toBeUndefined();
    expect((await cash1.get(`/approvals/${ask.body.approvalId}`)).body.status).toBe('EXPIRED');
    const paid = await key(cash1.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'CASH',
      amount: 500,
      allocations: [{ billId: bill.id, amount: 500 }],
    });
    expect(paid.status).toBe(201);
  });

  it('cancels a paid bill after approval: credit note, refund to the original mode, paid from the drawer', async () => {
    const { svc, patient, cash1, bm } = await counter();
    const p = await patient('Ravi');
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 1000 });
    const bill = await finalBill(cash1, p.id, [{ serviceId: svc.cbc }]);
    await key(cash1.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'CASH',
      amount: 300,
      allocations: [{ billId: bill.id, amount: 300 }],
    });
    const paid = (await cash1.get(`/billing/bills/${bill.id}`)).body;
    const ask = await cash1
      .post(`/billing/bills/${bill.id}/cancel`)
      .send({ version: paid.version, reason: 'Test not done, sample not collected' });
    expect(ask.status).toBe(202);
    expect((await approve(bm, ask.body.approvalId)).body.status).toBe('APPLIED');
    const cancelled = (await cash1.get(`/billing/bills/${bill.id}`)).body;
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancellation.creditNoteNo).toMatch(/^CN\//);
    const refund = (await cash1.get('/billing/refunds?status=APPROVED')).body.items[0];
    expect(refund).toMatchObject({ amount: 30000, modes: [{ modeKind: 'CASH', amount: 30000 }] });
    expect(
      (await key(cash1.post(`/billing/refunds/${refund.id}/pay`)).send({ version: refund.version }))
        .body.status,
    ).toBe('PAID');
    const shift = (await cash1.get('/billing/shifts/current')).body;
    expect(shift.expected.CASH).toBe(100000);
  });

  it('blocks ₹2 lakh or more in cash from one person in a day (section 269ST)', async () => {
    const { svc, patient, cash1 } = await counter();
    const p = await patient('Ravi');
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    expect(
      (
        await key(cash1.post('/billing/deposits')).send({
          patientId: p.id,
          mode: 'CASH',
          amount: 150000,
        })
      ).status,
    ).toBe(201);
    const bill = await finalBill(cash1, p.id, [{ serviceId: svc.consult, qty: 120 }]);
    const res = await key(cash1.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'CASH',
      amount: 50000,
      allocations: [{ billId: bill.id, amount: 50000 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CASH_LIMIT');
    expect(
      (
        await key(cash1.post('/billing/payments')).send({
          patientId: p.id,
          mode: 'CARD',
          amount: 50000,
          reference: '4321',
          allocations: [{ billId: bill.id, amount: 50000 }],
        })
      ).status,
    ).toBe(201);
  });

  it('splits one receipt across two family bills and adjusts advances', async () => {
    const { svc, patient, cash1 } = await counter();
    const father = await patient('Ravi');
    const son = await patient('Ishan', { age: 12 });
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    const b1 = await finalBill(cash1, father.id, [{ serviceId: svc.consult }]);
    const b2 = await finalBill(cash1, son.id, [{ serviceId: svc.cbc }]);
    const pay = await key(cash1.post('/billing/payments')).send({
      patientId: father.id,
      mode: 'CASH',
      amount: 800,
      allocations: [
        { billId: b1.id, amount: 500 },
        { billId: b2.id, amount: 300 },
      ],
    });
    expect(pay.body.allocations.map((a) => a.amount)).toEqual([50000, 30000]);
    expect((await cash1.get(`/billing/bills/${b2.id}`)).body.status).toBe('PAID');

    const dep = (
      await key(cash1.post('/billing/deposits')).send({
        patientId: son.id,
        mode: 'UPI',
        amount: 1000,
        reference: 'UTR9',
      })
    ).body;
    const b3 = await finalBill(cash1, son.id, [{ serviceId: svc.consult }]);
    const adv = await key(cash1.post('/billing/payments')).send({
      patientId: son.id,
      mode: 'ADVANCE',
      amount: 500,
      depositId: dep.id,
      allocations: [{ billId: b3.id, amount: 500 }],
    });
    expect(adv.status).toBe(201);
    expect((await cash1.get(`/billing/deposits?patientId=${son.id}`)).body.items[0]).toMatchObject({
      used: 50000,
      balance: 50000,
    });
  });

  it('keeps payment-link payments pending until a Billing Manager confirms them', async () => {
    const { svc, patient, cash1, bm } = await counter();
    const p = await patient('Ravi');
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    const bill = await finalBill(cash1, p.id, [{ serviceId: svc.cbc }]);
    const pend = (
      await key(cash1.post('/billing/payments')).send({
        patientId: p.id,
        mode: 'PAYLINK',
        amount: 300,
        reference: 'plink_1',
        allocations: [{ billId: bill.id, amount: 300 }],
      })
    ).body;
    expect(pend.status).toBe('PENDING');
    expect((await cash1.get(`/billing/bills/${bill.id}`)).body.status).toBe('FINAL');
    const byCashier = await cash1
      .post(`/billing/payments/${pend.id}/settle`)
      .send({ outcome: 'CAPTURED', version: pend.version });
    expect(byCashier.status).toBe(403);
    const ok = await bm
      .post(`/billing/payments/${pend.id}/settle`)
      .send({ outcome: 'CAPTURED', version: pend.version });
    expect(ok.body.status).toBe('CAPTURED');
    expect((await cash1.get(`/billing/bills/${bill.id}`)).body.status).toBe('PAID');
  });

  it('never reopens a cancelled bill when a pending payment confirms late', async () => {
    const { svc, patient, cash1, bm } = await counter();
    const p = await patient('Ravi');
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    const bill = await finalBill(cash1, p.id, [{ serviceId: svc.cbc }]);
    const pend = (
      await key(cash1.post('/billing/payments')).send({
        patientId: p.id,
        mode: 'PAYLINK',
        amount: 300,
        reference: 'plink_2',
        allocations: [{ billId: bill.id, amount: 300 }],
      })
    ).body;
    const open = (await cash1.get(`/billing/bills/${bill.id}`)).body;
    const ask = await cash1
      .post(`/billing/bills/${bill.id}/cancel`)
      .send({ version: open.version, reason: 'Patient left before the test' });
    await approve(bm, ask.body.approvalId);
    expect((await cash1.get(`/billing/bills/${bill.id}`)).body.status).toBe('CANCELLED');
    const late = await bm
      .post(`/billing/payments/${pend.id}/settle`)
      .send({ outcome: 'CAPTURED', version: pend.version });
    expect(late.body.error.code).toBe('BILL_NOT_OPEN');
    expect((await cash1.get(`/billing/bills/${bill.id}`)).body.status).toBe('CANCELLED');
  });

  it('cannot print a draft bill', async () => {
    const { svc, patient, cash1 } = await counter();
    const p = await patient('Ravi');
    const draft = (
      await cash1.post('/billing/bills').send({ patientId: p.id, lines: [{ serviceId: svc.cbc }] })
    ).body;
    const res = await cash1.get(`/billing/bills/${draft.id}/pdf`);
    expect(res.status).toBe(409);
  });

  it('applies the cash limit to receipts taken at the same moment at two counters', async () => {
    const { svc, patient, cash1, cash2 } = await counter();
    const p = await patient('Ravi');
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    await cash2.post('/billing/shifts').send({ counter: 'C2', openingCash: 0 });
    const bill = await finalBill(cash1, p.id, [{ serviceId: svc.consult, qty: 600 }]);
    const pay = (c) =>
      key(c.post('/billing/payments')).send({
        patientId: p.id,
        mode: 'CASH',
        amount: 150000,
        allocations: [{ billId: bill.id, amount: 150000 }],
      });
    const results = await Promise.all([pay(cash1), pay(cash2)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
  });

  it('counts the drawer: a ₹300 shortfall needs a reason and a Billing Manager, never the cashier', async () => {
    const { svc, patient, cash1, cash2, bm } = await counter();
    const p = await patient('Ravi');
    const shift = (await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 500 }))
      .body;
    expect(
      (await cash2.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 })).body.error.code,
    ).toBe('COUNTER_IN_USE');
    const bill = await finalBill(cash1, p.id, [{ serviceId: svc.consult }]);
    await key(cash1.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'CASH',
      amount: 500,
      allocations: [{ billId: bill.id, amount: 500 }],
    });
    const current = (await cash1.get('/billing/shifts/current')).body;
    expect(current.expected.CASH).toBe(100000);
    const notes = { 500: 1, 200: 1 }; // ₹700 counted against ₹1,000 expected
    expect(
      (
        await cash1
          .post(`/billing/shifts/${shift.id}/close`)
          .send({ version: current.version, notes })
      ).status,
    ).toBe(422);
    const closed = (
      await cash1.post(`/billing/shifts/${shift.id}/close`).send({
        version: current.version,
        notes,
        varianceReason: 'Change given twice to one patient',
      })
    ).body;
    expect(closed).toMatchObject({ status: 'COUNTED', cashVariance: -30000 });
    expect(
      (await cash1.post(`/billing/shifts/${shift.id}/verify`).send({ version: closed.version }))
        .status,
    ).toBe(403);
    expect(
      (
        await bm
          .post(`/billing/shifts/${shift.id}/verify`)
          .send({ version: closed.version, comment: 'Recovered from patient' })
      ).body.status,
    ).toBe('VERIFIED');
  });

  it('summarises revenue, collection, ageing and leakage for billing analytics', async () => {
    const { svc, patient, cash1, bm } = await counter();
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    const p = await patient('Asha');
    const paid = await finalBill(cash1, p.id, [{ serviceId: svc.consult }]);
    await finalBill(cash1, p.id, [{ serviceId: svc.cbc }]);
    await key(cash1.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'CASH',
      amount: 500,
      allocations: [{ billId: paid.id, amount: 500 }],
    });
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const res = await bm.get(`/billing/analytics?from=${today}&to=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.revenue).toMatchObject({ bills: 2, op: 2, net: 80000 });
    expect(res.body.collection).toMatchObject({
      collected: 50000,
      efficiency: 62.5,
      patientDues: 30000,
    });
    expect(res.body.collection.daysToCollect).toBe(0);
    expect(res.body.byGroup).toEqual([
      { group: 'CONSULTATION', amount: 50000 },
      { group: 'LAB', amount: 30000 },
    ]);
    expect(res.body.ageing.find((r) => r.payer === 'PATIENT')).toMatchObject({
      d0_30: 30000,
      total: 30000,
    });
    expect(res.body.daily).toEqual([{ date: today, billed: 80000, collected: 50000 }]);
    expect((await bm.get('/billing/analytics?from=2026-10-09&to=2026-10-01')).status).toBe(422);
    expect((await cash1.get(`/billing/analytics?from=${today}&to=${today}`)).status).toBe(403);
  });

  it('keeps billing settings: a higher variance limit needs no reason; cashiers cannot change them', async () => {
    const { cash1, bm } = await counter();
    const defaults = (await cash1.get('/billing/settings')).body;
    expect(defaults).toMatchObject({
      shiftVarianceLimit: 10000,
      defaultOpeningCash: 500000,
      billPaper: 'A4',
      receiptPaper: 'THERMAL_80',
    });
    const change = {
      version: defaults.version,
      shiftVarianceLimit: 500,
      defaultOpeningCash: 2000,
      billPaper: 'A5',
      receiptPaper: 'A5',
      billFooter: 'Reg. No. MH/PUNE/1234',
    };
    expect((await cash1.put('/billing/settings').send(change)).status).toBe(403);
    const saved = await bm.put('/billing/settings').send(change);
    expect(saved.body).toMatchObject({
      shiftVarianceLimit: 50000,
      defaultOpeningCash: 200000,
      billPaper: 'A5',
    });
    expect((await bm.put('/billing/settings').send(change)).status).toBe(409);

    const shift = (await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 1000 }))
      .body;
    const closed = await cash1
      .post(`/billing/shifts/${shift.id}/close`)
      .send({ version: shift.version, notes: { 500: 1, 200: 1 } }); // ₹300 short, under ₹500
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: 'VERIFIED', cashVariance: -30000 });
  });

  it('bills a corporate on credit within its limit, invoices the month and settles payments', async () => {
    const { t, svc, patient, cash1, bm } = await counter();
    const payerId = await runAsSystem(t.tenant._id, async () =>
      String(
        (
          await Payer.create([
            {
              code: 'TATA',
              name: 'Tata Motors',
              kind: 'CORPORATE',
              creditLimit: 100000,
              creditDays: 30,
              gstin: '27AAACT2727Q1ZW',
            },
          ])
        )[0]._id,
      ),
    );
    await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    const p = await patient('Anil');
    const credit = async (lines) => {
      const draft = (await cash1.post('/billing/bills').send({ patientId: p.id, payerId, lines }))
        .body;
      return cash1.post(`/billing/bills/${draft.id}/finalize`).send({ version: draft.version });
    };
    const first = await credit([{ serviceId: svc.consult }]);
    expect(first.status).toBe(200);
    expect(first.body.payer).toMatchObject({ kind: 'CORPORATE', payerId, name: 'Tata Motors' });
    const over = await credit([{ serviceId: svc.consult }, { serviceId: svc.cbc }]);
    expect(over.body.error.code).toBe('CREDIT_LIMIT');

    expect((await cash1.get('/billing/corporates')).status).toBe(403);
    const list = (await bm.get('/billing/corporates')).body;
    expect(list.items[0]).toMatchObject({
      name: 'Tata Motors',
      used: 50000,
      percent: 50,
      status: 'ACTIVE',
      draft: { bills: 1, amount: 50000 },
    });

    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const inv = await bm.post('/billing/corporate-invoices').send({ payerId, month });
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({
      invoiceNo: expect.stringMatching(/^CI\//),
      total: 50000,
      balance: 50000,
      status: 'ISSUED',
    });
    expect(inv.body.einvoice.status).toBe('NOT_NEEDED'); // consultation is exempt
    expect(
      (await bm.post('/billing/corporate-invoices').send({ payerId, month })).body.error.code,
    ).toBe('NOTHING_TO_INVOICE');

    const hold = await bm
      .post(`/billing/corporates/${payerId}/hold`)
      .send({ on: true, reason: 'Payment overdue 68 days' });
    expect(hold.body.status).toBe('ON_HOLD');
    const held = await cash1
      .post('/billing/bills')
      .send({ patientId: p.id, payerId, lines: [{ serviceId: svc.cbc }] });
    expect(held.body.error.code).toBe('PAYER_ON_HOLD');
    await bm.post(`/billing/corporates/${payerId}/hold`).send({ on: false });

    const part = await bm.post(`/billing/corporate-invoices/${inv.body.id}/payments`).send({
      version: inv.body.version,
      amount: 300,
      mode: 'BANK_TRANSFER',
      reference: 'UTR998877',
    });
    expect(part.body).toMatchObject({ paid: 30000, balance: 20000, status: 'PARTLY_PAID' });
    expect((await bm.get('/billing/corporates/ageing')).body.totals).toMatchObject({
      d0_30: 20000,
      total: 20000,
    });
    const full = await bm
      .post(`/billing/corporate-invoices/${inv.body.id}/payments`)
      .send({ version: part.body.version, amount: 200, mode: 'CHEQUE', reference: 'CHQ004411' });
    expect(full.body).toMatchObject({ balance: 0, status: 'PAID' });
    expect((await bm.get(`/billing/bills/${first.body.id}`)).body).toMatchObject({
      status: 'PAID',
    });

    const stmt = (await bm.get(`/billing/corporates/${payerId}/statement`)).body;
    expect(stmt.entries.map((e) => e.kind)).toEqual(['INVOICE', 'RECEIPT', 'RECEIPT']);
    expect(stmt.balance).toBe(0);

    await deliverEvents(t.tenant._id);
    const posted = await runAsSystem(t.tenant._id, () =>
      Journal.find({ 'source.kind': 'CORPORATE_RECEIPT' }).lean().exec(),
    );
    expect(posted.map((j) => j.total).sort()).toEqual([20000, 30000]);

    const letter = await bm.post('/billing/letters-of-credit').send({
      payerId,
      patientId: p.id,
      letterNo: 'TM/HR/2026/4471',
      validTill: '2099-12-31',
      covers: 'Admission up to ₹1,00,000',
      limit: 100000,
    });
    expect(letter.status).toBe(201);
    expect(letter.body).toMatchObject({ status: 'VALID', limit: 10000000 });
  });

  it('matches UPI settlements, banks the cash, and locks the day once every shift is verified', async () => {
    const { t, svc, patient, cash1, bm } = await counter();
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const shift = (await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 }))
      .body;
    const p = await patient('Ravi');
    const bill = await finalBill(cash1, p.id, [{ serviceId: svc.consult }]);
    await key(cash1.post('/billing/payments')).send({
      patientId: p.id,
      mode: 'UPI',
      amount: 500,
      reference: 'UTR778899',
      allocations: [{ billId: bill.id, amount: 500 }],
    });

    const day = (await bm.get(`/billing/settlements?date=${today}`)).body;
    expect(day.items).toEqual([
      expect.objectContaining({
        mode: 'UPI',
        counter: 'C1',
        receipts: 50000,
        count: 1,
        state: 'PENDING',
      }),
    ]);
    const short = (
      await bm
        .post('/billing/settlements')
        .send({ date: today, mode: 'UPI', counter: 'C1', settled: 450, reference: 'AXIS-UPI-0811' })
    ).body;
    expect(short.items[0]).toMatchObject({ settled: 45000, difference: 5000, state: 'SHORT' });
    const fixed = (
      await bm
        .post('/billing/settlements')
        .send({ date: today, mode: 'UPI', counter: 'C1', settled: 500, reference: 'AXIS-UPI-0811' })
    ).body;
    expect(fixed.items[0].state).toBe('MATCHED');
    expect(
      (
        await cash1
          .post('/billing/settlements')
          .send({ date: today, mode: 'UPI', counter: 'C1', settled: 500, reference: 'X1234' })
      ).status,
    ).toBe(403); // the billing manager matches settlements, not the cashier

    const slip = await bm.post('/billing/bank-deposits').send({
      date: today,
      bank: 'HDFC current',
      cash: 746,
      cheques: [{ number: '004411', bank: 'SBI', amount: 120 }],
    });
    expect(slip.status).toBe(201);
    expect(slip.body).toMatchObject({
      slipNo: expect.stringMatching(/^DS\//),
      cash: 74600,
      chequeTotal: 12000,
      status: 'DEPOSITED',
    });
    const credited = await bm
      .post(`/billing/bank-deposits/${slip.body.id}/status`)
      .send({ version: slip.body.version, status: 'CREDITED', reference: 'HDFC-STMT-1011' });
    expect(credited.body.status).toBe('CREDITED');
    await deliverEvents(t.tenant._id);
    const contra = await runAsSystem(t.tenant._id, () =>
      Journal.findOne({ 'source.kind': 'CASH_BANKED' }).lean().exec(),
    );
    expect(contra).toMatchObject({ type: 'CONTRA', total: 74600 });

    const early = await bm.post(`/billing/days/${today}/lock`);
    expect(early.body.error.code).toBe('SHIFTS_PENDING');
    const current = (await cash1.get('/billing/shifts/current')).body;
    const closed = await cash1
      .post(`/billing/shifts/${shift.id}/close`)
      .send({ version: current.version, notes: {}, nonCash: { UPI: 500 } });
    expect(closed.body.status).toBe('VERIFIED');
    const locked = await bm.post(`/billing/days/${today}/lock`);
    expect(locked.body).toMatchObject({
      locked: true,
      shifts: { open: 0, toVerify: 0, verified: 1 },
    });
    const reopen = await cash1.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 });
    expect(reopen.body.error.code).toBe('DAY_LOCKED');
  });
});
