import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import {
  Bed,
  Department,
  Doctor,
  PriceList,
  Service,
  TaxCode,
  Ward,
} from '../../src/modules/setup/index.js';
import { StockBatch } from '../../src/modules/inventory/models/inventory.models.js';
import {
  fromOpdVisit,
  fromWardOrder,
} from '../../src/modules/pharmacy/services/pharmacy.service.js';

const ctx = useIntegration();
const key = (req) => req.set('Idempotency-Key', randomUUID());
const ym = (months) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
};

/** A hospital with a main store, a pharmacy, a vendor, three medicines and a ward with a bed. */
async function pharmacy() {
  const t = await makeTenant({ modules: ['OPD', 'IPD', 'PHR', 'INV'] });
  const docUser = await makeUser(t, { username: 'doc', roles: ['doctor'] });
  for (const [u, r] of [
    ['store', 'store'],
    ['store2', 'store'],
    ['ph', 'pharmacy'],
    ['adm', 'admin'],
    ['cash', 'cashier'],
    ['fo', 'frontoffice'],
    ['nurse', 'nurse'],
  ])
    await makeUser(t, { username: u, roles: [r] });
  const ids = await runAsSystem(t.tenant._id, async () => {
    const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
    const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
    const [bedDay] = await Service.create([
      {
        code: 'BEDGEN',
        name: 'General ward bed day',
        category: 'BED',
        taxCodeId: exempt._id,
        status: 'ACTIVE',
        isActive: true,
        rates: [{ priceListId: general._id, amount: 100000 }],
      },
    ]);
    const [dept] = await Department.create([
      {
        code: 'MED',
        name: 'Medicine',
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
    const [w] = await Ward.create([
      {
        code: 'GW',
        name: 'General Ward',
        branchId: t.branch._id,
        category: 'GENERAL',
        gender: 'ANY',
        bedServiceId: bedDay._id,
      },
    ]);
    const [bed] = await Bed.create([
      { code: 'GW-01', name: 'GW-01', wardId: w._id, branchId: t.branch._id },
    ]);
    return { doctorId: String(doctor._id), bedId: String(bed._id) };
  });
  const u = {};
  for (const n of ['store', 'store2', 'ph', 'adm', 'cash', 'fo', 'nurse', 'doc'])
    u[n] = await signIn(ctx.app, t.host, n);
  await u.cash.post('/billing/shifts').send({ counter: 'PH1', openingCash: 0 });
  const main = (
    await u.store.post('/inventory/stores').send({ code: 'MAIN', name: 'Main store', kind: 'MAIN' })
  ).body;
  const phStore = (
    await u.store.post('/inventory/stores').send({ code: 'PH', name: 'Pharmacy', kind: 'PHARMACY' })
  ).body;
  const vendor = (
    await u.store
      .post('/inventory/vendors')
      .send({ code: 'MED1', name: 'Medi Distributors', gstin: '27AAACM1234F1Z5' })
  ).body;
  const item = async (body) => (await u.store.post('/inventory/items').send(body)).body;
  const dolo = await item({
    code: 'dolo650',
    name: 'Dolo 650 mg tab',
    unit: 'tablet',
    packSize: 15,
    hsn: '3004',
    gstRate: 5,
    reorderLevel: 100,
    drug: { generic: 'Paracetamol', form: 'Tablet', strengthMg: 650, schedule: 'OTC' },
  });
  const crocin = await item({
    code: 'crocin500',
    name: 'Crocin 500 mg tab',
    unit: 'tablet',
    gstRate: 5,
    drug: { generic: 'Paracetamol', form: 'Tablet', strengthMg: 500, schedule: 'OTC' },
  });
  const tramadol = await item({
    code: 'tramadol50',
    name: 'Tramadol 50 mg cap',
    unit: 'capsule',
    gstRate: 12,
    drug: { generic: 'Tramadol', form: 'Capsule', strengthMg: 50, schedule: 'H1' },
  });
  const calpol = await item({
    code: 'calpol',
    name: 'Calpol 250 mg/5 ml syrup',
    unit: 'ml',
    gstRate: 5,
    drug: {
      generic: 'Paracetamol',
      form: 'Syrup',
      strengthMg: 50,
      schedule: 'OTC',
      maxMgPerKgDay: 60,
    },
  });
  const patient = async (first, years = 40, mobile = '9876543210') =>
    (
      await u.fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first, last: 'Shah' },
        gender: 'M',
        mobile,
        birth: { age: { years } },
        noKnownAllergies: true,
        confirmNotDuplicate: true,
      })
    ).body;
  return { t, ...ids, ...u, main, phStore, vendor, dolo, crocin, tramadol, calpol, patient };
}

/** Stock straight into the pharmacy through a direct GRN (no PO). */
async function stockPharmacy(P, lines) {
  const g = await P.store.post('/inventory/grns').send({
    vendorId: P.vendor.id,
    storeId: P.phStore.id,
    invoiceNo: `INV-${randomUUID().slice(0, 6)}`,
    lines,
  });
  expect(g.status).toBe(201);
  return g.body;
}

describe('inventory and pharmacy', () => {
  it('purchase: PO through approval, GRN against it with batches, price variance held, transfer, ledger, count adjustment', async () => {
    const P = await pharmacy();
    const po = await P.store.post('/inventory/purchase-orders').send({
      vendorId: P.vendor.id,
      storeId: P.main.id,
      lines: [
        { itemId: P.dolo.id, qty: 300, rate: 150 },
        { itemId: P.crocin.id, qty: 200, rate: 120 },
      ],
    });
    expect(po.status).toBe(202);
    expect(po.body).toMatchObject({ status: 'PENDING_APPROVAL', total: 300 * 150 + 200 * 120 });
    const early = await P.store.post('/inventory/grns').send({
      poId: po.body.id,
      invoiceNo: 'X1',
      lines: [{ itemId: P.dolo.id, batchNo: 'D1', expiry: ym(12), qty: 10, rate: 150, mrp: 220 }],
    });
    expect(early.body.error.code).toBe('PO_NOT_OPEN');
    const appr = (await P.adm.get(`/approvals/${po.body.approvalId}`)).body;
    const ok = await P.adm
      .post(`/approvals/${po.body.approvalId}/decision`)
      .send({ decision: 'APPROVE', version: appr.version });
    expect(ok.status).toBe(200);
    const approved = (await P.store.get('/inventory/purchase-orders')).body.items[0];
    expect(approved).toMatchObject({ status: 'APPROVED', poNo: expect.stringMatching(/^PO\//) });

    const bad = await P.store.post('/inventory/grns').send({
      poId: po.body.id,
      invoiceNo: 'A1',
      lines: [{ itemId: P.dolo.id, batchNo: 'OLD', expiry: ym(0), qty: 10, rate: 150, mrp: 120 }],
    });
    expect(bad.status).toBe(422);
    const grn = await P.store.post('/inventory/grns').send({
      poId: po.body.id,
      invoiceNo: 'A1',
      invoiceDate: '2026-10-09',
      lines: [
        {
          itemId: P.dolo.id,
          batchNo: 'D-EARLY',
          expiry: ym(4),
          qty: 100,
          freeQty: 0,
          rate: 150,
          mrp: 220,
        },
        {
          itemId: P.dolo.id,
          batchNo: 'D-LATE',
          expiry: ym(18),
          qty: 200,
          freeQty: 20,
          rate: 150,
          mrp: 230,
        },
      ],
    });
    expect(grn.status).toBe(201);
    expect(grn.body).toMatchObject({ status: 'POSTED', grnNo: expect.stringMatching(/^GRN\//) });
    expect((await P.store.get('/inventory/purchase-orders')).body.items[0].status).toBe('PARTIAL');
    // Crocin billed 10% above the PO rate (limit 5%): held for the purchase manager.
    const held = await P.store.post('/inventory/grns').send({
      poId: po.body.id,
      invoiceNo: 'A2',
      lines: [
        { itemId: P.crocin.id, batchNo: 'C1', expiry: ym(10), qty: 200, rate: 132, mrp: 200 },
      ],
    });
    expect(held.status).toBe(202);
    expect(held.body.status).toBe('PENDING_APPROVAL');
    let stock = (await P.store.get(`/inventory/stock?storeId=${P.main.id}`)).body.items;
    expect(stock.find((s) => s.code === 'crocin500').qty).toBe(0);
    const a2 = (await P.store2.get(`/approvals/${held.body.approvalId}`)).body;
    await P.store2
      .post(`/approvals/${held.body.approvalId}/decision`)
      .send({ decision: 'APPROVE', version: a2.version });
    stock = (await P.store.get(`/inventory/stock?storeId=${P.main.id}`)).body.items;
    expect(stock.find((s) => s.code === 'crocin500').qty).toBe(200);
    expect(stock.find((s) => s.code === 'dolo650')).toMatchObject({
      qty: 320,
      nearestExpiry: ym(4),
    });
    expect((await P.store.get('/inventory/purchase-orders')).body.items[0].status).toBe('RECEIVED');

    // Transfer to the pharmacy picks the earliest expiry first.
    const tr = await P.store.post('/inventory/transfers').send({
      fromStoreId: P.main.id,
      toStoreId: P.phStore.id,
      lines: [{ itemId: P.dolo.id, qty: 120 }],
    });
    expect(tr.body.moved).toEqual([
      expect.objectContaining({ batchNo: 'D-EARLY', qty: 100 }),
      expect.objectContaining({ batchNo: 'D-LATE', qty: 20 }),
    ]);
    const ledger = (await P.store.get(`/inventory/ledger?itemId=${P.dolo.id}`)).body.items;
    expect(ledger.map((l) => l.kind)).toEqual(
      expect.arrayContaining(['GRN', 'TRANSFER_OUT', 'TRANSFER_IN']),
    );

    // Physical count: 8 short in D-LATE at the main store, through the pharmacy in-charge's approval.
    const adj = await P.store.post('/inventory/adjustments').send({
      storeId: P.main.id,
      itemId: P.dolo.id,
      batchNo: 'D-LATE',
      countedQty: 192,
      reason: 'Physical count variance',
    });
    expect(adj.status).toBe(202);
    const a3 = (await P.ph.get(`/approvals/${adj.body.approvalId}`)).body;
    await P.ph
      .post(`/approvals/${adj.body.approvalId}/decision`)
      .send({ decision: 'APPROVE', version: a3.version });
    const batches = (
      await P.store.get(`/inventory/items/${P.dolo.id}/batches?storeId=${P.main.id}`)
    ).body.items;
    expect(batches.find((b) => b.batchNo === 'D-LATE').qty).toBe(192);
    const reorder = (await P.store.get(`/inventory/reorder?storeId=${P.phStore.id}`)).body.items;
    expect(reorder.find((r) => r.name.startsWith('Dolo'))).toBeUndefined(); // 120 > level 100
  });

  it('counter sale: FEFO, expired never sold, H1 needs the prescriber, children by weight, OP bill at MRP with GST inside', async () => {
    const P = await pharmacy();
    await stockPharmacy(P, [
      { itemId: P.dolo.id, batchNo: 'NEAR', expiry: ym(2), qty: 10, rate: 150, mrp: 220 },
      { itemId: P.dolo.id, batchNo: 'FAR', expiry: ym(20), qty: 100, rate: 150, mrp: 230 },
      { itemId: P.tramadol.id, batchNo: 'T1', expiry: ym(12), qty: 30, rate: 500, mrp: 900 },
      { itemId: P.calpol.id, batchNo: 'S1', expiry: ym(12), qty: 600, rate: 30, mrp: 60 },
    ]);
    // An expired batch is still on the shelf: it must never be picked.
    await runAsSystem(P.t.tenant._id, () =>
      StockBatch.create([
        {
          storeId: P.phStore.id,
          itemId: P.dolo.id,
          batchNo: 'EXPIRED',
          expiry: ym(-1),
          mrp: 200,
          cost: 150,
          qty: 50,
        },
      ]),
    );
    const p = await P.patient('Ravi');
    const sale = await P.ph
      .post('/pharmacy/sales')
      .send({ patientId: p.id, lines: [{ itemId: P.dolo.id, qty: 15 }] });
    expect(sale.status).toBe(201);
    expect(sale.body.lines.map((l) => [l.batchNo, l.qty])).toEqual([
      ['NEAR', 10],
      ['FAR', 5],
    ]);
    expect(sale.body.total).toBe(10 * 220 + 5 * 230);
    const bill = (await P.cash.get(`/billing/bills/${sale.body.billId}`)).body;
    // GST inside the MRP: the lines add up to the MRP; the bill total is rounded to the rupee.
    expect(bill.totals.net).toBe(3350);
    expect(bill.totals.taxable + bill.totals.tax).toBe(3350);
    expect(bill.totals.total).toBe(3400);
    expect(bill.lines[0]).toMatchObject({ item: expect.objectContaining({ batchNo: 'NEAR' }) });

    const tooMuch = await P.ph
      .post('/pharmacy/sales')
      .send({ patientId: p.id, lines: [{ itemId: P.dolo.id, qty: 200 }] });
    expect(tooMuch.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: expect.stringContaining('only 95'),
    });

    const noRx = await P.ph
      .post('/pharmacy/sales')
      .send({ patientId: p.id, lines: [{ itemId: P.tramadol.id, qty: 10 }] });
    expect(noRx.body.error.code).toBe('PRESCRIBER_NEEDED');
    const noCopy = await P.ph.post('/pharmacy/sales').send({
      patientId: p.id,
      lines: [{ itemId: P.tramadol.id, qty: 10 }],
      prescriber: { name: 'Dr. A. Outside', regNo: 'KMC-123' },
    });
    expect(noCopy.status).toBe(422);
    const h1 = await P.ph.post('/pharmacy/sales').send({
      patientId: p.id,
      lines: [{ itemId: P.tramadol.id, qty: 10 }],
      prescriber: { name: 'Dr. A. Outside', regNo: 'KMC-123' },
      prescriptionCopy: true,
    });
    expect(h1.status).toBe(201);
    const reg = (await P.ph.get('/pharmacy/registers?schedule=H1')).body.items;
    expect(reg).toEqual([
      expect.objectContaining({ item: 'Tramadol 50 mg cap', qty: 10, regNo: 'KMC-123' }),
    ]);

    // A 4-year-old: 10 ml (500 mg) thrice daily for 14 kg is above 60 mg/kg/day.
    const child = await P.patient('Chotu', 4, '9876500004');
    const rxId = await runAsSystem(P.t.tenant._id, () =>
      fromOpdVisit({
        visitId: '65f000000000000000000011',
        patientId: child.id,
        doctorId: P.doctorId,
        rx: [
          {
            drugId: 'calpol',
            brand: 'Calpol syrup',
            generic: 'Paracetamol',
            dose: '10 ml',
            frequency: 'TDS',
            days: 3,
          },
        ],
      }),
    );
    const rx = (await P.ph.get(`/pharmacy/rx/${rxId}`)).body;
    expect(rx).toMatchObject({ child: true, prescriber: { name: 'Dr. R. Menon', regNo: 'MMC-9' } });
    expect(rx.lines[0]).toMatchObject({ suggestedQty: 90, available: 600 });
    const line = { itemId: P.calpol.id, qty: 90, rxLine: 0 };
    expect((await P.ph.post('/pharmacy/sales').send({ rxId, lines: [line] })).body.error.code).toBe(
      'WEIGHT_NEEDED',
    );
    const high = await P.ph.post('/pharmacy/sales').send({ rxId, lines: [line], weightKg: 14 });
    expect(high.body.error.code).toBe('DOSE_ABOVE_LIMIT');
    const ok = await P.ph.post('/pharmacy/sales').send({
      rxId,
      lines: [line],
      weightKg: 14,
      overrideReason: 'Doctor confirmed: loading dose for high fever',
    });
    expect(ok.status).toBe(201);
    expect(
      (await P.ph.get('/pharmacy/rx-queue')).body.items.find((r) => r.id === rxId),
    ).toBeUndefined();
  });

  it('substitution needs the same generic and the doctor’s consent', async () => {
    const P = await pharmacy();
    await stockPharmacy(P, [
      { itemId: P.crocin.id, batchNo: 'C9', expiry: ym(12), qty: 50, rate: 120, mrp: 200 },
    ]);
    const p = await P.patient('Sunil');
    const rxId = await runAsSystem(P.t.tenant._id, () =>
      fromOpdVisit({
        visitId: '65f000000000000000000012',
        patientId: p.id,
        doctorId: P.doctorId,
        rx: [
          {
            drugId: 'dolo650',
            brand: 'Dolo 650 mg tab',
            generic: 'Paracetamol',
            dose: '1 tab',
            frequency: 'TDS',
            days: 5,
          },
        ],
      }),
    );
    const rx = (await P.ph.get(`/pharmacy/rx/${rxId}`)).body;
    expect(rx.lines[0]).toMatchObject({ suggestedQty: 15, available: 0 });
    expect(rx.lines[0].alternatives).toEqual([
      expect.objectContaining({ code: 'crocin500', available: 50 }),
    ]);
    const sub = { itemId: P.crocin.id, qty: 15, rxLine: 0, substituteFor: 'Dolo 650 mg tab' };
    expect((await P.ph.post('/pharmacy/sales').send({ rxId, lines: [sub] })).status).toBe(422);
    const wrong = await P.ph
      .post('/pharmacy/sales')
      .send({ rxId, lines: [{ ...sub, itemId: P.tramadol.id, consent: true }] });
    expect(wrong.status).toBe(422);
    const ok = await P.ph
      .post('/pharmacy/sales')
      .send({ rxId, lines: [{ ...sub, consent: true }] });
    expect(ok.body.lines[0]).toMatchObject({
      name: 'Crocin 500 mg tab',
      substituteFor: 'Dolo 650 mg tab',
    });
  });

  it('ward issue: on the running IP bill; a pending return holds the final bill (R15) and credits it when accepted', async () => {
    const P = await pharmacy();
    await stockPharmacy(P, [
      { itemId: P.dolo.id, batchNo: 'W1', expiry: ym(12), qty: 100, rate: 150, mrp: 220 },
    ]);
    const p = await P.patient('Mohan');
    const a = await key(P.fo.post('/ipd/admissions')).send({
      patientId: p.id,
      doctorId: P.doctorId,
      reason: 'Fever',
      bedId: P.bedId,
      emergency: true,
    });
    expect(a.status).toBe(201);
    const rxId = await runAsSystem(P.t.tenant._id, () =>
      fromWardOrder({
        admissionId: a.body.id,
        line: {
          orderId: 'ord1',
          drugId: 'dolo650',
          brand: 'Dolo 650 mg tab',
          generic: 'Paracetamol',
          dose: '1 tab',
          frequency: 'TDS',
          days: 2,
        },
      }),
    );
    const q = (await P.ph.get('/pharmacy/rx-queue?source=IPD')).body.items;
    expect(q).toEqual([expect.objectContaining({ id: rxId, location: 'General Ward GW-01' })]);
    const issue = await P.ph
      .post('/pharmacy/sales')
      .send({ rxId, lines: [{ itemId: P.dolo.id, qty: 6, rxLine: 0 }] });
    expect(issue.body).toMatchObject({ kind: 'ISSUE', total: 1320, billId: null });
    let stay = (await P.cash.get(`/ipd/admissions/${a.body.id}`)).body;
    expect(stay.bill.lines.find((l) => l.name.startsWith('Dolo'))).toMatchObject({ qty: 6 });

    const ret = await P.nurse.post('/pharmacy/returns').send({
      dispenseId: issue.body.id,
      lines: [{ lineId: issue.body.lines[0].id, qty: 2 }],
      reason: 'Stopped',
    });
    expect(ret.status).toBe(201);
    // Discharge starts; the final bill waits for the pharmacy to settle the return.
    await P.doc.post(`/ipd/admissions/${a.body.id}/advise-discharge`);
    const blocked = await P.cash.post(`/ipd/admissions/${a.body.id}/final-bill`);
    expect(blocked.body.error.code).toBe('PHARMACY_RETURNS_PENDING');
    expect(
      (await P.ph.post(`/pharmacy/returns/${ret.body.id}/decide`).send({ accept: true })).body
        .status,
    ).toBe('ACCEPTED');
    stay = (await P.cash.get(`/ipd/admissions/${a.body.id}`)).body;
    expect(stay.bill.lines.find((l) => l.name.startsWith('Dolo'))).toMatchObject({ qty: 4 });
    const batches = (
      await P.ph.get(`/inventory/items/${P.dolo.id}/batches?storeId=${P.phStore.id}`)
    ).body.items;
    expect(batches[0].qty).toBe(96);
    const summary = (await P.ph.get('/pharmacy/sales-summary')).body;
    expect(summary).toMatchObject({ issues: 1320 });
  });

  it('requisitions: raised by a ward or from reorder levels, turned into a PO or rejected; transfer register', async () => {
    const P = await pharmacy();
    const manual = await P.nurse.post('/inventory/requisitions').send({
      storeId: P.main.id,
      reason: 'Fever cases rising on Ward 2',
      lines: [{ itemId: P.dolo.id, qty: 50 }],
    });
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({
      prNo: expect.stringMatching(/^PR\//),
      source: 'MANUAL',
      status: 'OPEN',
    });
    const auto = await P.store.post('/inventory/requisitions/reorder').send({ storeId: P.main.id });
    expect(auto.status).toBe(201);
    expect(auto.body.source).toBe('REORDER');
    expect(auto.body.lines.map((l) => l.itemId)).toContain(P.dolo.id);
    expect(
      (
        await P.nurse
          .post(`/inventory/requisitions/${auto.body.id}/reject`)
          .send({ version: 0, reason: 'No' })
      ).status,
    ).toBe(403);

    const converted = await P.store
      .post(`/inventory/requisitions/${manual.body.id}/convert`)
      .send({ version: 0, vendorId: P.vendor.id, rates: { [P.dolo.id]: 150 } });
    expect([200, 202]).toContain(converted.status);
    expect(converted.body.requisition).toMatchObject({
      status: 'PO_CREATED',
      poId: converted.body.po.id,
    });
    expect(converted.body.po.lines[0]).toMatchObject({ qty: 50, rate: 150 });
    const rejected = await P.store
      .post(`/inventory/requisitions/${auto.body.id}/reject`)
      .send({ version: 0, reason: 'Covered by the manual request' });
    expect(rejected.body.status).toBe('REJECTED');
    expect((await P.store.get('/inventory/requisitions?status=OPEN')).body.items).toEqual([]);

    const g = await P.store.post('/inventory/grns').send({
      vendorId: P.vendor.id,
      storeId: P.main.id,
      invoiceNo: `INV-${randomUUID().slice(0, 6)}`,
      lines: [
        { itemId: P.dolo.id, batchNo: 'D-REQ', expiry: ym(12), qty: 60, rate: 150, mrp: 300 },
      ],
    });
    expect(g.status).toBe(201);
    const tr = await P.store.post('/inventory/transfers').send({
      fromStoreId: P.main.id,
      toStoreId: P.phStore.id,
      lines: [{ itemId: P.dolo.id, qty: 20 }],
    });
    const reg = (await P.store.get('/inventory/transfers')).body.items;
    expect(reg[0]).toMatchObject({
      ref: tr.body.ref,
      from: 'Main store',
      to: 'Pharmacy',
      lines: 1,
      qty: 20,
      kind: 'TRANSFER',
    });
  });
});
