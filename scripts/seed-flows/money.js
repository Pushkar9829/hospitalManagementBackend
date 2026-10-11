/**
 * Flow seed "money": billing, cash and front office for the demo hospital, made through the API.
 * Counter shifts (C1 closed with a variance and verified, C2 left open), receipts, IP advances,
 * a discount, two cancellations (credit notes and refunds), corporate credit bills, invoices and
 * letters of credit, card/UPI settlement, bank slips and day locks; plus front-office tokens,
 * enquiries and passes, consents, CRM calls, OPD templates/resources/leave/Queue TV/check-ups
 * and treatment plans, packages, legal entities and number series.
 * Every section checks first and returns 'skipped' once its data exists.
 */
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { ok, istDay, istMonth } from './harness.js';

const M = (name) => mongoose.model(name);
const key = (req) => req.set('Idempotency-Key', randomUUID());
const rupees = (paise) => Math.round(paise) / 100;

// ---------------------------------------------------------------- shared lookups

let cache;
/** Set when counter C1's work is complete, so the close never runs on a half-done shift. */
const state = { c1Done: false };
async function load(h) {
  if (cache) return cache;
  cache = await h.system(async () => {
    const pts = await M('Patient').find().lean();
    const P = {};
    const mobile = {};
    for (const p of pts) {
      P[p.name.first] = String(p._id);
      mobile[p.name.first] = p.mobile;
    }
    const S = Object.fromEntries(
      (await M('Service').find({ status: 'ACTIVE' }).lean()).map((s) => [s.code, String(s._id)]),
    );
    const payers = Object.fromEntries(
      (await M('Payer').find().lean()).map((p) => [p.code, String(p._id)]),
    );
    const doctors = Object.fromEntries(
      (await M('Doctor').find().lean()).map((d) => [
        d.code,
        { id: String(d._id), userId: d.userId ? String(d.userId) : undefined },
      ]),
    );
    const adm = (
      await M('Admission')
        .find({ status: { $nin: ['DISCHARGED', 'CANCELLED'] } })
        .lean()
    ).map((a) => ({
      id: String(a._id),
      patientId: String(a.patient?.id ?? a.patientId),
      ipNo: a.ipNo,
      bed: a.bed?.code,
    }));
    return { P, mobile, S, payers, doctors, adm };
  });
  return cache;
}

const svcLines = (S, codes) =>
  codes.map((c) => {
    if (!S[c]) throw new Error(`No active service ${c}`);
    return { serviceId: S[c] };
  });

const findBill = (h, patientId, notes) =>
  h.system(() =>
    M('Bill').findOne({ 'patient.id': patientId, notes }).sort({ createdAt: -1 }).lean().exec(),
  );

/** A final bill tagged by its note: created and finalised once, reused on a rerun. */
async function ensureBill(h, c, { patientId, notes, codes, payerId }) {
  const { S } = await load(h);
  const found = await findBill(h, patientId, notes);
  let bill = found
    ? ok(await c.get(`/billing/bills/${found._id}`))
    : ok(
        await c
          .post('/billing/bills')
          .send({ patientId, lines: svcLines(S, codes), notes, ...(payerId ? { payerId } : {}) }),
      );
  if (bill.status === 'DRAFT')
    bill = ok(await c.post(`/billing/bills/${bill.id}/finalize`).send({ version: bill.version }));
  return bill;
}

/** Pays a bill's balance (or a part) unless it already has a payment. */
async function pay(c, billId, mode, { amount, reference, depositId } = {}) {
  const bill = ok(await c.get(`/billing/bills/${billId}`));
  if (bill.totals.paid > 0 || bill.status !== 'FINAL' || bill.payer?.payerId) return bill;
  const amt = amount ?? rupees(bill.totals.balance);
  ok(
    await key(c.post('/billing/payments')).send({
      patientId: bill.patient.id,
      mode,
      amount: amt,
      ...(reference ? { reference } : {}),
      ...(depositId ? { depositId } : {}),
      allocations: [{ billId, amount: amt }],
    }),
    201,
  );
  return ok(await c.get(`/billing/bills/${billId}`));
}

/** Approves at each level until decided (billing manager first, then the Super Admin). */
async function approveAll(h, approvalId) {
  for (const who of ['billingmgr', 'superadmin', 'admin']) {
    const a = ok(await (await h.as('billingmgr')).get(`/approvals/${approvalId}`));
    if (a.status !== 'PENDING') return a.status;
    try {
      await h.approve(who, approvalId);
    } catch (e) {
      if (e.status !== 403 && e.status !== 409) throw e;
    }
  }
  return ok(await (await h.as('billingmgr')).get(`/approvals/${approvalId}`)).status;
}

async function currentShift(c) {
  const cur = ok(await c.get('/billing/shifts/current'));
  return cur && cur.id ? cur : null;
}

async function shiftsOf(c) {
  return ok(await c.get('/billing/shifts?limit=50')).items;
}

/** Opens the cashier's shift at a counter unless one is open already. */
async function ensureShift(c, counter, openingCash) {
  const cur = await currentShift(c);
  if (cur) {
    if (cur.counter !== counter)
      throw new Error(`cashier has an open shift at ${cur.counter}, expected ${counter}`);
    return cur;
  }
  return ok(await c.post('/billing/shifts').send({ counter, openingCash }), 201);
}

function notesFor(paise) {
  let r = Math.round(paise / 100);
  const out = {};
  for (const d of [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1]) {
    const n = Math.floor(r / d);
    if (n) {
      out[String(d)] = n;
      r -= n * d;
    }
  }
  return out;
}

async function ensureDeposit(h, c, { patientId, mode, amount, reference, purpose }) {
  const list = ok(await c.get(`/billing/deposits?patientId=${patientId}`)).items;
  const have = list.find((d) => d.purpose === purpose);
  if (have) return have;
  return ok(
    await key(c.post('/billing/deposits')).send({
      patientId,
      mode,
      amount,
      purpose,
      ...(reference ? { reference } : {}),
    }),
    201,
  );
}

/** Cancels a paid bill after approval; returns the bill. */
async function cancelBill(h, c, billId, reason) {
  let bill = ok(await c.get(`/billing/bills/${billId}`));
  if (bill.status === 'CANCELLED') return bill;
  let approvalId = bill.cancellation?.approvalId;
  if (bill.hold !== 'CANCELLATION') {
    const r = ok(
      await c.post(`/billing/bills/${billId}/cancel`).send({ version: bill.version, reason }),
      200,
      202,
    );
    approvalId = r.approvalId;
  }
  if (approvalId) await approveAll(h, String(approvalId));
  bill = ok(await c.get(`/billing/bills/${billId}`));
  if (bill.status !== 'CANCELLED') throw new Error(`bill ${bill.billNo} not cancelled`);
  return bill;
}

// GSTIN with its mod-36 check character (same rule as @hms/shared ids.js).
function gstinFor(stateCode, pan, entity = '1') {
  const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const s = `${stateCode}${pan}${entity}Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CH.indexOf(s[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return s + CH[(36 - (sum % 36)) % 36];
}

// ---------------------------------------------------------------- setup-side rows

async function billingSettings(h) {
  const bm = await h.as('billingmgr');
  const s = ok(await bm.get('/billing/settings'));
  if (s.billFooter) return 'skipped';
  ok(
    await bm.put('/billing/settings').send({
      version: s.version ?? 0,
      shiftVarianceLimit: 100,
      defaultOpeningCash: 5000,
      billPaper: 'A4',
      receiptPaper: 'THERMAL_80',
      billFooter:
        'Thank you for choosing us. Refunds go back to the original mode of payment. Helpline 020-4000-1234.',
    }),
  );
  return 'variance limit ₹100, opening cash ₹5,000, bill footer';
}

async function legalEntities(h) {
  const admin = await h.as('admin');
  const have = ok(await admin.get('/settings/entities'));
  if ((have.items ?? have).length) return 'skipped';
  const rows = [
    {
      name: 'Demo Multispeciality Hospital Pvt Ltd',
      registrationNo: 'U85110PN2015PTC155321',
      pan: 'AACCD4417K',
      address: { line1: 'Plot 12, Baner Road', city: 'Pune', state: 'Maharashtra', pin: '411045' },
      signatory: 'Dr. S. Kulkarni, Director',
    },
    {
      name: 'Demo Hospital Pharmacy LLP',
      registrationNo: 'AAK-4471',
      pan: 'AAKFD2208M',
      address: {
        line1: 'Ground floor, Plot 12, Baner Road',
        city: 'Pune',
        state: 'Maharashtra',
        pin: '411045',
      },
      signatory: 'Meena Joshi, Designated Partner',
    },
  ];
  for (const r of rows)
    ok(await admin.post('/settings/entities').send({ ...r, gstin: gstinFor('27', r.pan) }), 201);
  return `${rows.length} entities`;
}

async function numberSeries(h) {
  const admin = await h.as('admin');
  const list = ok(await admin.get('/settings/number-series'));
  const items = list.items ?? list;
  if (items.some((s) => s.version != null)) return 'skipped';
  // Saved with the product's own format, so numbers already issued keep their sequence.
  const keep = ['OP_BILL', 'IP_BILL', 'RECEIPT', 'REFUND', 'CREDIT_NOTE', 'DEPOSIT', 'MISC_BILL'];
  let n = 0;
  for (const s of items.filter((x) => keep.includes(x.series))) {
    ok(
      await admin
        .put(`/settings/number-series/${s.series}`)
        .send({ prefix: s.prefix, reset: s.reset, width: s.width }),
    );
    n++;
  }
  return `${n} series confirmed (unchanged format)`;
}

async function packages(h) {
  const admin = await h.as('admin');
  const have = ok(await admin.get('/masters/packages'));
  if (have.items.length) return 'skipped';
  const rows = [
    {
      code: 'PKG-TKR',
      name: 'Total knee replacement (one knee)',
      kind: 'SURGICAL',
      price: 285000,
      stayDays: 5,
      wardCategory: 'SEMI_PRIVATE',
      includes: [
        'Surgeon and anaesthetist fees',
        'OT charges',
        'Implant (standard)',
        'Room for 5 days',
        'Physiotherapy in stay',
      ],
      excludes: ['Blood products', 'Extra stay days', 'Premium implant upgrade'],
      taxCode: 'EXEMPT',
      departmentCode: 'ORTH',
    },
    {
      code: 'PKG-NVD',
      name: 'Normal delivery',
      kind: 'MATERNITY',
      price: 45000,
      stayDays: 2,
      wardCategory: 'GENERAL',
      includes: ['Labour room', 'Obstetrician fee', 'Routine newborn care', 'Room for 2 days'],
      excludes: ['NICU stay', 'Caesarean conversion'],
      taxCode: 'EXEMPT',
      departmentCode: 'GYN',
    },
    {
      code: 'PKG-LSCS',
      name: 'Caesarean section (LSCS)',
      kind: 'MATERNITY',
      price: 85000,
      stayDays: 4,
      wardCategory: 'SEMI_PRIVATE',
      includes: ['OT charges', 'Surgeon and anaesthetist fees', 'Room for 4 days'],
      excludes: ['NICU stay', 'Blood products'],
      taxCode: 'EXEMPT',
      departmentCode: 'GYN',
    },
    {
      code: 'PKG-DENGUE',
      name: 'Dengue fever, medical management',
      kind: 'MEDICAL',
      price: 25000,
      stayDays: 3,
      wardCategory: 'GENERAL',
      includes: ['Room for 3 days', 'Daily CBC', 'IV fluids', 'Physician visits'],
      excludes: ['Platelet transfusion', 'ICU care'],
      taxCode: 'EXEMPT',
      departmentCode: 'GMED',
    },
    {
      code: 'HC-EXEC',
      name: 'Executive health check',
      kind: 'HEALTH_CHECK',
      price: 6500,
      includes: [
        'CBC',
        'Lipid profile',
        'HbA1c',
        'LFT',
        'KFT',
        'TSH',
        'ECG',
        'Chest X-ray',
        'Physician consultation',
      ],
      taxCode: 'EXEMPT',
      departmentCode: 'GMED',
    },
    {
      code: 'HC-BASIC',
      name: 'Basic health check',
      kind: 'HEALTH_CHECK',
      price: 2500,
      includes: ['CBC', 'Fasting blood sugar', 'Lipid profile', 'Physician consultation'],
      taxCode: 'EXEMPT',
      departmentCode: 'GMED',
    },
    {
      code: 'DC-CATARACT',
      name: 'Cataract surgery (day care, monofocal lens)',
      kind: 'DAYCARE',
      price: 30000,
      includes: ['Day-care bed', 'Surgeon fee', 'Monofocal IOL'],
      excludes: ['Premium lens'],
      taxCode: 'EXEMPT',
    },
  ];
  for (const r of rows) ok(await admin.post('/masters/packages').send(r), 201);
  return `${rows.length} packages`;
}

async function payerCredit(h) {
  const admin = await h.as('admin');
  const list = ok(await admin.get('/masters/payers?limit=50')).items;
  const want = {
    TATA: {
      creditLimit: 500000,
      creditDays: 30,
      gstin: gstinFor('27', 'AAACT2727Q'),
      contactName: 'R. Deshmukh (HR Medical Cell)',
      email: 'medical.cell@tatamotors.example',
      phone: '02066131111',
    },
    PMJAY: {
      creditLimit: 1000000,
      creditDays: 45,
      contactName: 'District Implementation Unit, Pune',
      phone: '18002331022',
    },
  };
  let n = 0;
  for (const [code, extra] of Object.entries(want)) {
    const p = list.find((x) => x.code === code);
    if (!p || p.creditLimit > 0) continue;
    ok(
      await admin.put(`/masters/payers/${p.id}`).send({
        version: p.version,
        code: p.code,
        name: p.name,
        kind: p.kind,
        ...extra,
      }),
      200,
      202,
    );
    n++;
  }
  return n ? `credit limits set on ${n} payers` : 'skipped';
}

// ---------------------------------------------------------------- counter C1: the day shift

async function shiftOne(h) {
  const c = await h.as('cashier');
  const { P, payers } = await load(h);
  const shifts = await shiftsOf(c);
  if (shifts.some((s) => s.counter === 'C1' && s.status !== 'OPEN')) {
    state.c1Done = true;
    return 'skipped';
  }
  await ensureShift(c, 'C1', 5000);
  const done = [];

  const divya = await ensureBill(h, c, {
    patientId: P.Divya,
    notes: 'OPD consultation and thyroid panel',
    codes: ['CONDLG', 'CBC', 'TSH'],
  });
  await pay(c, divya.id, 'UPI', { reference: 'UTR628194550113' });
  const divyaDup = await ensureBill(h, c, {
    patientId: P.Divya,
    notes: 'Thyroid panel (entered twice)',
    codes: ['TSH'],
  });
  await pay(c, divyaDup.id, 'UPI', { reference: 'UTR628194550188' });

  const myraCbc = await ensureBill(h, c, {
    patientId: P.Myra,
    notes: 'Fever work-up: blood count',
    codes: ['CBC'],
  });
  await pay(c, myraCbc.id, 'CASH');
  const myraMal = await ensureBill(h, c, {
    patientId: P.Myra,
    notes: 'Fever work-up: malaria antigen',
    codes: ['MPAG'],
  });
  await pay(c, myraMal.id, 'CASH');

  // A 10% staff-family discount, approved, then paid by card.
  let rekha = await ensureBill(h, c, {
    patientId: P.Rekha,
    notes: 'Cardiac review',
    codes: ['CONDMI', 'ECG', 'LIPID'],
  });
  if (!rekha.discount?.status) {
    const r = ok(
      await c.post(`/billing/bills/${rekha.id}/discount`).send({
        version: rekha.version,
        kind: 'PERCENT',
        value: 10,
        reason: 'Hospital staff family member (mother of ward nurse)',
      }),
      200,
      202,
    );
    if (r.approvalId) await approveAll(h, r.approvalId);
  } else if (rekha.hold === 'DISCOUNT' && rekha.discount.approvalId)
    await approveAll(h, String(rekha.discount.approvalId));
  rekha = await pay(c, rekha.id, 'CARD', { reference: '7781' });
  done.push(`discount ${rekha.discount?.status ?? 'none'}`);

  // Advance for an MRI, then the MRI bill paid from it.
  const dep = await ensureDeposit(h, c, {
    patientId: P.Sunil,
    mode: 'UPI',
    amount: 10000,
    reference: 'UTR628194551020',
    purpose: 'Advance for MRI lumbar spine',
  });
  const mri = await ensureBill(h, c, {
    patientId: P.Sunil,
    notes: 'MRI lumbar spine (from advance)',
    codes: ['MRILS'],
  });
  await pay(c, mri.id, 'ADVANCE', { depositId: dep.id });
  const xray = await ensureBill(h, c, {
    patientId: P.Sunil,
    notes: 'Orthopaedic consult and X-ray',
    codes: ['CONDPJ', 'CXR'],
  });
  await pay(c, xray.id, 'CHEQUE', { reference: 'CHQ 004512 SBI' });

  // IP advances for the patients in beds.
  await ensureDeposit(h, c, {
    patientId: P.Harish,
    mode: 'CASH',
    amount: 25000,
    purpose: 'IP advance at admission',
  });
  await ensureDeposit(h, c, {
    patientId: P.Suresh,
    mode: 'CARD',
    amount: 15000,
    reference: '9902',
    purpose: 'IP advance at admission',
  });
  await ensureDeposit(h, c, {
    patientId: P.Neeta,
    mode: 'CASH',
    amount: 5000,
    purpose: 'Advance for items not covered by Tata Motors',
  });
  done.push('4 deposits');

  // Corporate and scheme credit bills (invoiced later).
  await ensureBill(h, c, {
    patientId: P.Sunil,
    notes: 'Tata Motors annual health check',
    codes: ['CONDAT', 'LIPID', 'HBA1C', 'ECG'],
    payerId: payers.TATA,
  });
  await ensureBill(h, c, {
    patientId: P.Divya,
    notes: 'Tata Motors employee: consultation and KFT',
    codes: ['CONDLG', 'KFT'],
    payerId: payers.TATA,
  });
  await ensureBill(h, c, {
    patientId: P.Myra,
    notes: 'PM-JAY OPD diagnostics',
    codes: ['CXR', 'CBC'],
    payerId: payers.PMJAY,
  });
  done.push('3 credit bills');

  // Cancellations: one refunded in cash from this drawer, one UPI refund left for the bank.
  await cancelBill(
    h,
    c,
    myraMal.id,
    'Malaria antigen not done: sample haemolysed, patient declined repeat',
  );
  await cancelBill(h, c, divyaDup.id, 'Thyroid test billed twice at the counter by mistake');
  const refunds = ok(await c.get(`/billing/refunds?status=APPROVED&patientId=${P.Myra}`)).items;
  for (const r of refunds)
    ok(await key(c.post(`/billing/refunds/${r.id}/pay`)).send({ version: r.version }));
  done.push(`2 cancelled, ${refunds.length} refund paid`);
  state.c1Done = true;
  return done.join(', ');
}

async function closeShiftOne(h) {
  const c = await h.as('cashier');
  const s = (await shiftsOf(c)).find((x) => x.counter === 'C1');
  if (!s) throw new Error('no C1 shift');
  if (s.status === 'VERIFIED') return 'skipped';
  if (s.status === 'OPEN' && !state.c1Done)
    throw new Error('counter C1 work is incomplete; not closing');
  let shift = s;
  if (s.status === 'OPEN') {
    const cur = await currentShift(c);
    const short = 15000; // ₹150 short: above the ₹100 limit, so the billing manager verifies
    const nonCash = {};
    for (const [mode, amount] of Object.entries(cur.expected))
      if (mode !== 'CASH' && amount) nonCash[mode] = rupees(amount);
    shift = ok(
      await c.post(`/billing/shifts/${cur.id}/close`).send({
        version: cur.version,
        notes: notesFor(cur.expected.CASH - short),
        nonCash,
        varianceReason: 'Change of ₹150 given twice to one patient at rush hour',
      }),
    );
  }
  if (shift.status === 'COUNTED') {
    const bm = await h.as('billingmgr');
    shift = ok(
      await bm.post(`/billing/shifts/${shift.id}/verify`).send({
        version: shift.version,
        comment: 'Checked with CCTV; cashier to make good the ₹150',
      }),
    );
  }
  return `C1 ${shift.status}, cash variance ₹${rupees(shift.cashVariance ?? 0)}`;
}

// ---------------------------------------------------------------- corporate and credit

async function corporate(h) {
  const bm = await h.as('billingmgr');
  const { P, payers } = await load(h);
  const month = istMonth(0);
  const out = [];
  for (const [code, payment] of [
    ['TATA', { amount: null, part: 0.6, mode: 'CHEQUE', reference: 'CHQ 118822 HDFC' }],
    ['PMJAY', { amount: null, part: 1, mode: 'BANK_TRANSFER', reference: 'NEFT PMJAY 2610091234' }],
  ]) {
    const payerId = payers[code];
    let inv = ok(await bm.get(`/billing/corporate-invoices?payerId=${payerId}`)).items[0];
    if (!inv) {
      inv = ok(await bm.post('/billing/corporate-invoices').send({ payerId, month }), 201);
      out.push(`invoice ${inv.invoiceNo}`);
    }
    if (!inv.paid) {
      const amt = Math.round((inv.total * payment.part) / 100);
      inv = ok(
        await bm.post(`/billing/corporate-invoices/${inv.id}/payments`).send({
          version: inv.version,
          amount: amt,
          mode: payment.mode,
          reference: payment.reference,
        }),
      );
      out.push(`${code} paid ₹${amt}`);
    }
  }
  const letters = ok(await bm.get('/billing/letters-of-credit')).items;
  const want = [
    {
      payerId: payers.TATA,
      patientId: P.Neeta,
      letterNo: 'TML/HR/2026/0412',
      validTill: istDay(60),
      covers: 'Admission and surgery up to ₹1,50,000 (room up to semi-private)',
      limit: 150000,
    },
    {
      payerId: payers.TATA,
      patientId: P.Sunil,
      letterNo: 'TML/HR/2026/0398',
      validTill: istDay(90),
      covers: 'Annual health check and OPD follow-up',
      limit: 25000,
    },
    {
      payerId: payers.TATA,
      patientId: P.Divya,
      letterNo: 'TML/HR/2026/0377',
      validTill: istDay(-3),
      covers: 'OPD consultations (expired letter)',
      limit: 10000,
    },
    {
      payerId: payers.PMJAY,
      patientId: P.Myra,
      letterNo: 'PMJAY/MH/27/0091234',
      validTill: istDay(180),
      covers: 'Family floater under PM-JAY, ₹5,00,000 per year',
      limit: 500000,
    },
  ];
  let n = 0;
  for (const l of want)
    if (!letters.some((x) => x.letterNo === l.letterNo)) {
      ok(await bm.post('/billing/letters-of-credit').send(l), 201);
      n++;
    }
  if (n) out.push(`${n} letters of credit`);
  return out.length ? out.join(', ') : 'skipped';
}

// ---------------------------------------------------------------- lab home collections

const HOME_VISITS = [
  {
    who: 'Rekha',
    codes: ['FBS', 'PPBS', 'HBA1C'],
    date: 0,
    slot: '07:00-08:00',
    address: '14 Sai Krupa Society, Aundh, Pune',
    landmark: 'Near Bremen Chowk',
    assign: true,
  },
  {
    who: 'Ravi',
    codes: ['KFT', 'LFT'],
    date: 1,
    slot: '08:00-09:00',
    address: 'Flat 302, Green Park, Baner, Pune',
    landmark: 'Opp. Baner Gaon bus stop',
    assign: true,
  },
  {
    who: 'Divya',
    codes: ['TSH', 'B12'],
    date: 2,
    slot: '07:30-08:30',
    address: '9 Lake View Apartments, Pashan, Pune',
    assign: false,
  },
];

async function homeVisits(h) {
  const fo = await h.as('frontoffice');
  const { P, S } = await load(h);
  const have = await h.system(() => M('HomeVisit').find().select('address').lean().exec());
  const todo = HOME_VISITS.filter((v) => !have.some((x) => x.address === v.address));
  if (!todo.length) return 'skipped';
  const phleb = await h.system(() => M('User').findOne({ username: 'phlebotomist' }).lean().exec());
  for (const v of todo)
    ok(
      await fo.post('/lab/home-visits').send({
        patientId: P[v.who],
        tests: v.codes.map((c) => S[c]),
        date: istDay(v.date),
        slot: v.slot,
        address: v.address,
        ...(v.landmark ? { landmark: v.landmark } : {}),
        ...(v.assign && phleb ? { phlebotomistUserId: String(phleb._id) } : {}),
      }),
      201,
    );
  return `${todo.length} home collections booked`;
}

// ---------------------------------------------------------------- counter C2: still open

async function shiftTwo(h) {
  const c = await h.as('cashier');
  const { P } = await load(h);
  const marker = await findBill(h, P.Myra, 'Echo (part payment)');
  if (marker && marker.totals.paid > 0) return 'skipped';
  await ensureShift(c, 'C2', 3000);
  // Home-collection bills are paid before the phlebotomist goes out.
  let n = 0;
  for (const v of HOME_VISITS.filter((x) => x.assign)) {
    const hv = await h.system(() => M('HomeVisit').findOne({ address: v.address }).lean().exec());
    const item =
      hv &&
      (await h.system(() =>
        M('LabItem')
          .findOne({ _id: { $in: hv.itemIds } })
          .lean()
          .exec(),
      ));
    if (!item?.billId) continue;
    let b = ok(await c.get(`/billing/bills/${item.billId}`));
    if (b.status === 'DRAFT')
      b = ok(await c.post(`/billing/bills/${b.id}/finalize`).send({ version: b.version }));
    await pay(
      c,
      b.id,
      v.who === 'Rekha' ? 'UPI' : 'CASH',
      v.who === 'Rekha' ? { reference: 'UTR628194560711' } : {},
    );
    n++;
  }
  const fu = await ensureBill(h, c, {
    patientId: P.Ravi,
    notes: 'Follow-up consultation',
    codes: ['CFUDMI'],
  });
  await pay(c, fu.id, 'CASH');
  const lab = await ensureBill(h, c, {
    patientId: P.Harish,
    notes: 'Attendant OPD visit: dressing',
    codes: ['DRESS', 'INJ'],
  });
  await pay(c, lab.id, 'UPI', { reference: 'UTR628194560999' });
  const echo = await ensureBill(h, c, {
    patientId: P.Myra,
    notes: 'Echo (part payment)',
    codes: ['ECHO'],
  });
  await pay(c, echo.id, 'CASH', { amount: 1000 });
  return `C2 open: ${n} home-collection bills, 3 walk-in bills (one part paid)`;
}

/** OP bills the base seed left in draft (before today): finalised and collected at C2. */
async function oldDrafts(h) {
  const c = await h.as('cashier');
  const drafts = await h.system(() =>
    M('Bill')
      .find({
        type: 'OP',
        status: 'DRAFT',
        createdAt: { $lt: new Date(`${istDay(0)}T00:00:00+05:30`) },
      })
      .sort({ createdAt: 1 })
      .lean()
      .exec(),
  );
  if (!drafts.length) return 'skipped';
  const cur = await currentShift(c);
  if (!cur) throw new Error('no open cashier shift');
  for (const [i, d] of drafts.entries()) {
    let b = ok(await c.get(`/billing/bills/${d._id}`));
    b = ok(await c.post(`/billing/bills/${b.id}/finalize`).send({ version: b.version }));
    await pay(c, b.id, i % 2 ? 'CARD' : 'CASH', i % 2 ? { reference: '4417' } : {});
  }
  return `${drafts.length} older OP drafts finalised and paid`;
}

// ---------------------------------------------------------------- day-end

async function settlements(h) {
  const bm = await h.as('billingmgr');
  const date = istDay(0);
  const day = ok(await bm.get(`/billing/settlements?date=${date}`));
  const pending = day.items.filter((r) => r.state === 'PENDING');
  if (!pending.length) return day.items.length ? 'skipped' : 'no card/UPI receipts today';
  for (const r of pending) {
    // Card: the bank keeps its 1.8% MDR; UPI settles in full.
    const settled = r.kind === 'CARD' ? Math.floor((r.receipts * 0.982) / 100) : rupees(r.receipts);
    ok(
      await bm.post('/billing/settlements').send({
        date,
        mode: r.mode,
        counter: r.counter,
        settled,
        reference: `${r.kind === 'CARD' ? 'HDFC-POS-BATCH' : 'AXIS-UPI'}-${date.replace(/-/g, '')}-${r.counter}`,
        ...(r.kind === 'CARD' ? { note: 'Card fee (MDR) deducted by the bank' } : {}),
      }),
    );
  }
  return `${pending.length} device settlements`;
}

async function bankDeposits(h) {
  const bm = await h.as('billingmgr');
  if (ok(await bm.get('/billing/bank-deposits')).items.length) return 'skipped';
  const shift = ok(await bm.get('/billing/shifts?limit=50')).items.find(
    (s) => s.counter === 'C1' && s.status === 'VERIFIED',
  );
  if (!shift) throw new Error('C1 shift not verified yet');
  const cash = rupees((shift.counted?.cash ?? 0) - shift.openingCash); // the float stays in the drawer
  const date = istDay(0);
  const slips = [];
  if (cash > 0)
    slips.push(
      ok(
        await bm.post('/billing/bank-deposits').send({
          date,
          bank: 'HDFC Bank current a/c ••5678',
          cash,
          reference: 'Counter C1 day shift',
        }),
        201,
      ),
    );
  const chq = await h.system(() =>
    M('Payment')
      .findOne({ modeKind: 'CHEQUE', status: 'CAPTURED' })
      .sort({ createdAt: 1 })
      .lean()
      .exec(),
  );
  if (chq)
    slips.push(
      ok(
        await bm.post('/billing/bank-deposits').send({
          date,
          bank: 'HDFC Bank current a/c ••5678',
          cheques: [{ number: '004512', bank: 'SBI', amount: rupees(chq.amount) }],
        }),
        201,
      ),
    );
  const tata = ok(await bm.get('/billing/corporate-invoices')).items.find((i) =>
    (i.payments ?? []).some((p) => p.mode === 'CHEQUE'),
  );
  const tataChq = tata?.payments?.find((p) => p.mode === 'CHEQUE');
  if (tataChq)
    slips.push(
      ok(
        await bm.post('/billing/bank-deposits').send({
          date,
          bank: 'ICICI Bank collection a/c ••0911',
          cheques: [{ number: '118822', bank: 'HDFC', amount: rupees(tataChq.amount) }],
          reference: `Tata Motors ${tata.invoiceNo}`,
        }),
        201,
      ),
    );
  // The bank has credited the first two; the corporate cheque is still in clearing.
  for (const s of slips.slice(0, 2))
    ok(
      await bm.post(`/billing/bank-deposits/${s.id}/status`).send({
        version: s.version,
        status: 'CREDITED',
        reference: `HDFC-STMT-${s.slipNo.replace(/\//g, '')}`,
      }),
    );
  return `${slips.length} slips (cash ₹${cash})`;
}

async function dayLocks(h) {
  const bm = await h.as('billingmgr');
  let n = 0;
  for (const off of [-1, -2, -3, -4, -5]) {
    const date = istDay(off);
    const st = ok(await bm.get(`/billing/days/${date}`));
    if (st.locked || st.shifts.open || st.shifts.toVerify) continue;
    ok(await bm.post(`/billing/days/${date}/lock`));
    n++;
  }
  return n ? `${n} past days locked` : 'skipped';
}

// ---------------------------------------------------------------- front office

async function foTokens(h) {
  const fo = await h.as('frontoffice');
  const counters = ok(await fo.get('/front-office/counters')).items;
  const count = await h.system(() => M('FoToken').countDocuments().exec());
  if (count) return 'skipped';
  const by = (name) => counters.find((x) => x.name === name) ?? counters[0];
  const plan = [
    ['Billing 1', ['Ravi Kumar', 'Anita Pawar', null, 'Mohan Shinde']],
    ['Registration', ['Kavita Joshi', null, 'Imran Shaikh']],
  ];
  let n = 0;
  for (const [name, people] of plan) {
    const ctr = by(name) ?? counters[n % counters.length];
    for (const p of people) {
      ok(
        await fo
          .post('/front-office/tokens')
          .send({ counterId: ctr.id, ...(p ? { name: p } : {}) }),
        201,
      );
      n++;
    }
    ok(await fo.post(`/front-office/counters/${ctr.id}/call-next`));
  }
  const third = counters.find((x) => !plan.some(([nm]) => nm === x.name));
  if (third) {
    ok(
      await fo.post('/front-office/tokens').send({ counterId: third.id, name: 'Farida Khan' }),
      201,
    );
    n++;
  }
  return `${counters.length} counters, ${n} tokens`;
}

async function foEnquiries(h) {
  const fo = await h.as('frontoffice');
  const list = ok(await fo.get('/front-office/enquiries'));
  if (list.total > 0) return 'skipped';
  const rows = [
    {
      caller: 'Meena Jadhav',
      mobile: '9822011122',
      topic: 'Knee replacement package cost and stay',
      category: 'PACKAGE',
      channel: 'PHONE',
      outcome: 'LEAD',
    },
    {
      caller: 'Arif Shaikh',
      topic: 'Is the cardiologist available on Saturday?',
      category: 'DOCTOR',
      channel: 'WALK_IN',
      outcome: 'BOOKED',
    },
    { topic: 'ICU visiting hours', category: 'VISITING', channel: 'PHONE', outcome: 'ANSWERED' },
    {
      caller: 'Pooja Kulkarni',
      mobile: '9890055512',
      topic: 'Normal delivery package and room types',
      category: 'PACKAGE',
      channel: 'WHATSAPP',
      outcome: 'FOLLOW_UP',
      notes: 'Send tariff sheet on WhatsApp',
    },
    {
      caller: 'Sanjay Patil',
      topic: 'MRI lumbar spine charges',
      category: 'TARIFF',
      channel: 'PHONE',
      outcome: 'ANSWERED',
    },
    {
      caller: 'Vinod Rao',
      topic: 'Private room availability for tomorrow',
      category: 'BED',
      channel: 'WALK_IN',
      outcome: 'FOLLOW_UP',
      notes: 'Call back after 4 pm discharges',
    },
    {
      caller: 'Leena Dsouza',
      mobile: '9765012345',
      topic: 'Executive health check for parents',
      category: 'PACKAGE',
      channel: 'EMAIL',
      outcome: 'BOOKED',
    },
  ];
  for (const r of rows) ok(await fo.post('/front-office/enquiries').send(r), 201);
  return `${rows.length} enquiries`;
}

async function foPasses(h) {
  const fo = await h.as('frontoffice');
  const { adm, P } = await load(h);
  const have = await h.system(() => M('VisitorPass').countDocuments().exec());
  if (have) return 'skipped';
  const names = {
    [P.Harish]: [
      ['Sunita Verma', 'Wife'],
      ['Rohit Verma', 'Son'],
    ],
    [P.Suresh]: [
      ['Anjali Patil', 'Daughter'],
      ['Prakash More', 'Friend'],
    ],
    [P.Neeta]: [
      ['Kiran Shah', 'Husband'],
      ['Hema Shah', 'Sister'],
    ],
  };
  let n = 0;
  for (const a of adm) {
    const [att, vis] = names[a.patientId] ?? [
      ['Family member', 'Relative'],
      ['Visitor', 'Friend'],
    ];
    const r = await fo.post('/front-office/passes').send({
      patientId: a.patientId,
      type: 'ATTENDANT',
      ...(a.bed ? { bed: a.bed } : {}),
      visitor: {
        name: att[0],
        relation: att[1],
        mobile: '98220' + String(10000 + n * 137).slice(0, 5),
      },
    });
    if (r.status === 201) n++;
    else if (r.body?.error?.code !== 'ATTENDANT_LIMIT') ok(r, 201);
    const v = ok(
      await fo.post('/front-office/passes').send({
        patientId: a.patientId,
        type: 'VISITOR',
        visitor: { name: vis[0], relation: vis[1] },
      }),
      201,
    );
    n++;
    ok(await fo.post(`/front-office/passes/${v.id}/out`));
  }
  return `${n} passes (visitors marked out)`;
}

// ---------------------------------------------------------------- consents, CRM, messaging

async function consents(h) {
  const fo = await h.as('frontoffice');
  const { P, adm } = await load(h);
  const plan = [
    [
      P.Ravi,
      [
        ['TREATMENT', 'REGISTRATION_FORM'],
        ['SMS', 'REGISTRATION_FORM'],
        ['WHATSAPP', 'REGISTRATION_FORM'],
      ],
    ],
    [
      P.Divya,
      [
        ['TREATMENT', 'REGISTRATION_FORM'],
        ['WHATSAPP', 'OTP'],
        ['MARKETING', 'OTP'],
      ],
    ],
    [
      P.Rekha,
      [
        ['TREATMENT', 'REGISTRATION_FORM'],
        ['DATA_SHARING', 'TABLET_SIGNATURE'],
        ['ABHA_LINKING', 'OTP'],
      ],
    ],
    [
      P.Sunil,
      [
        ['TREATMENT', 'REGISTRATION_FORM'],
        ['SMS', 'REGISTRATION_FORM'],
      ],
    ],
  ];
  for (const a of adm)
    plan.push([
      a.patientId,
      [
        ['ADMISSION', 'TABLET_SIGNATURE', `Admission ${a.ipNo}`],
        ['TREATMENT', 'TABLET_SIGNATURE'],
      ],
    ]);
  let n = 0;
  for (const [pid, rows] of plan) {
    const have = ok(await fo.get(`/patients/${pid}/consents`)).items;
    for (const [type, channel, scope] of rows) {
      if (have.some((x) => x.type === type)) continue;
      ok(
        await fo.post(`/patients/${pid}/consents`).send({
          type,
          channel,
          ...(scope ? { scope, givenBy: 'Patient', witness: 'Front office staff' } : {}),
        }),
        201,
      );
      n++;
    }
  }
  // Divya stops WhatsApp messages: the consent is withdrawn and CRM follows.
  const dv = ok(await fo.get(`/patients/${P.Divya}/consents`)).items.find(
    (x) => x.type === 'WHATSAPP' && x.status === 'ACTIVE',
  );
  if (dv) {
    ok(
      await fo
        .post(`/patients/${P.Divya}/consents/${dv.id}/withdraw`)
        .send({ version: dv.version, reason: 'Patient asked on phone to stop WhatsApp messages' }),
    );
    n++;
  }
  return n ? `${n} consents recorded/withdrawn` : 'skipped';
}

async function crmCalls(h) {
  const crm = await h.as('crm');
  const { P, mobile } = await load(h);
  const rows = [
    {
      mobile: mobile.Sunil,
      name: 'Sunil Desai',
      patientId: P.Sunil,
      topic: 'PACKAGE',
      notes: 'Asked about knee replacement cost for his father',
      lead: { interest: 'Knee replacement', department: 'Orthopaedics' },
    },
    {
      mobile: mobile.Ravi,
      name: 'Ravi Kumar',
      patientId: P.Ravi,
      topic: 'REPORT',
      notes: 'Wanted lipid report on WhatsApp',
      outcome: 'Shared portal link',
    },
    {
      mobile: '9850077123',
      name: 'Shalini Gokhale',
      topic: 'APPOINTMENT',
      channel: 'WHATSAPP',
      notes: 'Gynaecology appointment next week',
      outcome: 'Booked with OPD desk',
    },
    {
      mobile: mobile.Divya,
      name: 'Divya Rao',
      patientId: P.Divya,
      topic: 'BILLING',
      notes: 'Asked when the duplicate UPI payment will be refunded',
      outcome: 'Refund approved, explained 3-5 working days',
    },
    {
      mobile: '9823344556',
      name: 'Ajay Kulkarni',
      topic: 'COMPLAINT',
      notes: 'Long wait at the pharmacy counter on Sunday',
      outcome: 'Logged, pharmacy in-charge to call back',
    },
  ];
  const have = await h.system(() => M('CrmEnquiry').find().select('mobile notes').lean().exec());
  const todo = rows.filter((r) => !have.some((x) => x.mobile === r.mobile && x.notes === r.notes));
  if (!todo.length) return 'skipped';
  for (const r of todo) ok(await crm.post('/crm/enquiries').send(r), 201);
  return `${todo.length} call-desk enquiries`;
}

async function commsPrefs(h) {
  const crm = await h.as('crm');
  const { mobile } = await load(h);
  const want = [
    { mobile: mobile.Sunil, optOut: true, source: 'Asked on call to stop promotional SMS' },
    { mobile: '9823344556', optOut: true, source: 'Complaint call: no promotions please' },
    { mobile: mobile.Rekha, optOut: false, source: 'Opted in at health camp' },
  ];
  const have = await h.system(() =>
    M('CommsPreference').find().select('mobile source').lean().exec(),
  );
  // A consent recorded later can overwrite the row, so match on what this seed wrote.
  const todo = want.filter(
    (w) => !have.some((x) => x.mobile === w.mobile && x.source === w.source),
  );
  if (!todo.length) return 'skipped';
  for (const w of todo) ok(await crm.post('/crm/preferences').send(w));
  return `${todo.length} preferences`;
}

// ---------------------------------------------------------------- OPD desk extras

async function opdTemplates(h) {
  const doc = await h.as('doctor');
  const have = ok(await doc.get('/opd/templates')).items ?? [];
  const rows = [
    {
      name: 'Hypertension, newly diagnosed',
      kind: 'RX',
      department: 'Cardiology',
      rx: [
        {
          drugId: 'telma40',
          brand: 'Telma 40 mg tab',
          generic: 'Telmisartan',
          dose: '1 tab',
          frequency: '1-0-0',
          days: 30,
          route: 'Oral',
          instructions: 'After breakfast',
        },
        {
          drugId: 'amlodipine5',
          brand: 'Amlong 5 mg tab',
          generic: 'Amlodipine',
          dose: '1 tab',
          frequency: '0-0-1',
          days: 30,
          route: 'Oral',
        },
      ],
      advice: 'Low-salt diet, 30 minutes walk daily, home BP log twice a day. Review in 2 weeks.',
    },
    {
      name: 'Viral fever, adult',
      kind: 'RX',
      department: 'General Medicine',
      rx: [
        {
          drugId: 'dolo650',
          brand: 'Dolo 650 mg tab',
          generic: 'Paracetamol',
          dose: '1 tab',
          frequency: '1-1-1',
          days: 3,
          route: 'Oral',
          instructions: 'If temperature above 100°F',
        },
      ],
      advice:
        'Plenty of oral fluids, rest. Return if fever lasts beyond 3 days or bleeding appears.',
    },
    {
      name: 'Diabetes annual review',
      kind: 'ORDER_SET',
      department: 'General Medicine',
      orders: ['FBS', 'PPBS', 'HBA1C', 'KFT', 'LIPID', 'UMA'],
    },
    {
      name: 'Chest pain work-up',
      kind: 'ORDER_SET',
      department: 'Cardiology',
      orders: ['ECG', 'TROP', 'CBC', 'ECHO'],
    },
    {
      name: 'Fever panel',
      kind: 'ORDER_SET',
      department: 'General Medicine',
      orders: ['CBC', 'MPAG', 'NS1'],
    },
  ];
  const todo = rows.filter((r) => !have.some((x) => x.name === r.name));
  if (!todo.length) return 'skipped';
  for (const r of todo) ok(await doc.post('/opd/templates').send(r), 201);
  return `${todo.length} templates`;
}

async function opdResources(h) {
  const admin = await h.as('admin');
  if (ok(await admin.get('/opd/resources')).total) return 'skipped';
  const rows = [
    {
      name: 'Procedure room 1',
      type: 'ROOM',
      bookableFor: 'Dressings, minor procedures',
      slots: 12,
    },
    { name: 'Treadmill (TMT) room', type: 'EQUIPMENT', bookableFor: 'Treadmill test', slots: 8 },
    { name: 'Echo machine', type: 'EQUIPMENT', bookableFor: '2D Echo', slots: 10 },
    {
      name: 'Physiotherapist: Ms. A. Pawar',
      type: 'THERAPIST',
      bookableFor: 'Physiotherapy sessions',
      slots: 10,
    },
    { name: 'Nebulisation bay', type: 'ROOM', bookableFor: 'Nebulisation', slots: 16 },
  ];
  for (const r of rows) ok(await admin.post('/opd/resources').send(r), 201);
  return `${rows.length} resources`;
}

async function scheduleBlocks(h) {
  const admin = await h.as('admin');
  const { doctors } = await load(h);
  if (await h.system(() => M('ScheduleBlock').countDocuments().exec())) return 'skipped';
  const rows = [
    ['DMI', { from: istDay(18), to: istDay(19), reason: 'Cardiology conference, Mumbai' }],
    ['DPJ', { from: istDay(24), to: istDay(28), reason: 'Annual leave' }],
    ['DRM', { from: istDay(21), reason: 'Personal leave' }],
    ['DFK', { from: istDay(30), to: istDay(31), reason: 'CME faculty, Nagpur' }],
  ];
  let n = 0;
  for (const [code, body] of rows) {
    if (!doctors[code]) continue;
    ok(await admin.post(`/opd/schedules/${doctors[code].id}/blocks`).send(body));
    n++;
  }
  return `${n} leave blocks`;
}

async function displayKeys(h) {
  const admin = await h.as('admin');
  if ((ok(await admin.get('/opd/display-keys')).items ?? []).length) return 'skipped';
  const made = [];
  for (const name of ['Waiting hall TV', 'OPD block B TV', 'Old reception TV'])
    made.push(ok(await admin.post('/opd/display-keys').send({ name }), 201));
  ok(await admin.post(`/opd/display-keys/${made[2].id}/revoke`));
  return '3 Queue TV keys (one revoked)';
}

async function healthCheckups(h) {
  const fo = await h.as('frontoffice');
  const { P } = await load(h);
  if (await h.system(() => M('HealthCheckup').countDocuments().exec())) return 'skipped';
  const rows = [
    { patientId: P.Sunil, package: 'Executive health check', company: 'Tata Motors', stations: 9 },
    { patientId: P.Rekha, package: 'Basic health check', stations: 4 },
    { patientId: P.Ravi, package: 'Executive health check', stations: 9 },
    { patientId: P.Divya, package: 'Basic health check', company: 'Tata Motors', stations: 4 },
  ];
  for (const r of rows) ok(await fo.post('/opd/health-checkups').send(r), 201);
  return `${rows.length} check-ups today`;
}

async function treatmentPlans(h) {
  const fo = await h.as('frontoffice');
  const { P } = await load(h);
  if (ok(await fo.get('/opd/treatment-plans')).total) return 'skipped';
  const rows = [
    {
      patientId: P.Sunil,
      plan: 'Physiotherapy for low back pain',
      sessions: 10,
      firstSession: `${istDay(1)}T10:00`,
      billing: 'PACKAGE',
      amount: 600000,
    },
    {
      patientId: P.Rekha,
      plan: 'Cardiac rehabilitation, phase 2',
      sessions: 12,
      firstSession: `${istDay(2)}T09:30`,
      billing: 'PER_SESSION',
      amount: 80000,
    },
    {
      patientId: P.Harish,
      plan: 'Wound dressing after discharge',
      sessions: 6,
      firstSession: `${istDay(3)}T11:00`,
      billing: 'PER_SESSION',
      amount: 25000,
    },
    {
      patientId: P.Myra,
      plan: 'Allergy desensitisation injections',
      sessions: 8,
      firstSession: `${istDay(4)}T12:00`,
      billing: 'PACKAGE',
      amount: 400000,
    },
  ];
  for (const r of rows) ok(await fo.post('/opd/treatment-plans').send(r), 201);
  return `${rows.length} treatment plans`;
}

export const sections = [
  ['billing settings', billingSettings],
  ['legal entities', legalEntities],
  ['number series', numberSeries],
  ['packages', packages],
  ['payer credit limits', payerCredit],
  ['counter C1: bills, receipts, advances, refunds', shiftOne],
  ['counter C1: close and verify', closeShiftOne],
  ['corporate invoices and letters of credit', corporate],
  ['lab home collections', homeVisits],
  ['counter C2: open shift', shiftTwo],
  ['counter C2: older OP drafts', oldDrafts],
  ['card and UPI settlements', settlements],
  ['bank deposit slips', bankDeposits],
  ['day locks', dayLocks],
  ['front office tokens', foTokens],
  ['front office enquiries', foEnquiries],
  ['visitor passes', foPasses],
  ['patient consents', consents],
  ['CRM call enquiries', crmCalls],
  ['messaging preferences', commsPrefs],
  ['OPD templates', opdTemplates],
  ['OPD resources', opdResources],
  ['doctor leave blocks', scheduleBlocks],
  ['Queue TV keys', displayKeys],
  ['health check-ups', healthCheckups],
  ['treatment plans', treatmentPlans],
];
