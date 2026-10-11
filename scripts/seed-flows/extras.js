/**
 * Flow seed "extras": screens the other areas left empty, filled through the real API.
 * Today's tele-consultations, a PCPNDT Form F, the Schedule H1 / X / narcotic registers, planned
 * discharges, an HR exit on notice, referral partners with a statement, and doctor payouts
 * drafted from closed OPD visits.
 * Every section checks first and returns 'skipped' once its data exists.
 */
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { ok, istDay, istMonth } from './harness.js';

const M = (name) => mongoose.model(name);
const key = (req) => req.set('Idempotency-Key', randomUUID());

let cache;
async function load(h) {
  if (cache) return cache;
  cache = await h.system(async () => {
    const P = {};
    for (const p of await M('Patient').find().lean()) P[p.name.first] = String(p._id);
    const S = Object.fromEntries(
      (await M('Service').find({ status: 'ACTIVE' }).lean()).map((s) => [s.code, String(s._id)]),
    );
    const D = Object.fromEntries(
      (await M('Doctor').find().lean()).map((d) => [
        d.code,
        { id: String(d._id), name: d.name, userId: d.userId ? String(d.userId) : null },
      ]),
    );
    return { P, S, D };
  });
  return cache;
}

// ---------------------------------------------------------------- 1. tele-consultations

async function teleConsults(h) {
  const fo = await h.as('frontoffice');
  const have = ok(await fo.get('/opd/tele-consults')).items ?? [];
  if (have.length >= 2) return 'skipped';
  const { P, D } = await load(h);
  const grid = ok(await fo.get(`/opd/slots?date=${istDay(0)}`));
  const want = [
    ['DMI', 'Anita', 'Tele follow-up: BP and sugar review'],
    ['DRM', 'Ravi', 'Tele consult: lab reports review'],
  ].slice(0, 2 - have.length);
  const done = [];
  for (const [code, who, notes] of want) {
    const cell = grid.cells.find((c) => c.doctorId === D[code].id);
    const slots = cell?.slots ?? [];
    // A free slot later today, else the last open one (the desk may book a passed slot).
    const slot =
      slots.find((s) => s.status === 'FREE' && s.time >= '17:00') ??
      slots.find((s) => s.status === 'FREE') ??
      [...slots].reverse().find((s) => s.status === 'PAST');
    if (!slot) throw new Error(`no slot today for ${D[code].name}`);
    const a = ok(
      await key(fo.post('/opd/appointments')).send({
        patientId: P[who],
        doctorId: D[code].id,
        date: istDay(0),
        time: slot.time,
        visitType: 'TELE',
        channel: 'PHONE',
        notes,
      }),
      201,
    );
    done.push(`${a.apptNo ?? a.id} ${slot.time} ${D[code].name}`);
  }
  const now = ok(await fo.get('/opd/tele-consults')).items.length;
  return `${done.length} tele bookings (${done.join('; ')}); tele list today: ${now}`;
}

// ---------------------------------------------------------------- 2. PCPNDT Form F

async function formF(h) {
  const rad = await h.as('radiology');
  const reg = ok(await rad.get(`/rad/form-f?month=${istMonth(0)}`));
  if (reg.items.length) return 'skipped';
  const { P, D } = await load(h);
  const admin = await h.as('admin');
  let def = (ok(await rad.get('/rad/studies-master')).items ?? []).find(
    (d) => d.pcpndt && d.isActive,
  );
  if (!def) {
    // No obstetric study flagged yet: flag the ultrasound that is one.
    const ob = (ok(await rad.get('/rad/studies-master?modality=USG')).items ?? []).find((d) =>
      /obstetric/i.test(d.name),
    );
    if (!ob) throw new Error('no obstetric ultrasound in the study master (no API to add one)');
    def = ok(await admin.put(`/rad/studies-master/${ob.id}`).send({ pcpndt: true }));
  }
  const patientId = P.Rekha;
  let study = (
    ok(await rad.get(`/rad/studies?pcpndt=true&patientId=${patientId}`)).items ?? []
  ).find((s) => !s.formF);
  if (!study) {
    const made = ok(
      await rad.post('/rad/orders').send({
        patientId,
        doctorId: D.DMI.id,
        studies: [def.serviceId],
        priority: 'ROUTINE',
        clinicalNotes: 'G2P1, 10 weeks by dates: dating and viability scan',
      }),
      201,
    );
    study = made.items[0];
  }
  ok(
    await rad.post(`/rad/studies/${study.id}/form-f`).send({
      lmp: istDay(-70),
      indication: 'To estimate gestational age (dating) and confirm viability',
      declaration: true,
      patientSigned: true,
    }),
  );
  const after = ok(await rad.get(`/rad/form-f?month=${istMonth(0)}`)).items;
  return `${def.code} ordered (${study.accessionNo}) with Form F; register ${istMonth(0)}: ${after.length}`;
}

// ---------------------------------------------------------------- 3. pharmacy registers

const CONTROLLED = [
  {
    schedule: 'H1',
    code: 'tramadol50',
    item: {
      name: 'Tramadol 50 mg cap',
      unit: 'capsule',
      gstRate: 12,
      drug: { generic: 'Tramadol', form: 'Capsule', strengthMg: 50, schedule: 'H1' },
    },
    rate: 450,
    mrp: 700,
    patient: 'Sunil',
    qty: 10,
    prescriber: { name: 'Dr. R. Menon', regNo: 'MMC-2011-48213' },
  },
  {
    schedule: 'X',
    code: 'methylphenidate10',
    item: {
      name: 'Addwize 10 mg tab',
      unit: 'tablet',
      gstRate: 5,
      drug: { generic: 'Methylphenidate', form: 'Tablet', strengthMg: 10, schedule: 'X' },
    },
    rate: 520,
    mrp: 780,
    patient: 'Ravi',
    qty: 14,
    prescriber: { name: 'Dr. Meera Iyer', regNo: 'MMC-2009-31877' },
  },
  {
    schedule: 'NARCOTIC',
    code: 'morphine10',
    item: {
      name: 'Morphine sulphate 10 mg tab',
      unit: 'tablet',
      gstRate: 5,
      drug: { generic: 'Morphine', form: 'Tablet', strengthMg: 10, schedule: 'NARCOTIC' },
    },
    rate: 900,
    mrp: 1250,
    patient: 'Harish', // ward issue for his stay
    qty: 6,
    prescriber: { name: 'Dr. Meera Iyer', regNo: 'MMC-2009-31877' },
  },
];

async function pharmacyRegisters(h) {
  const ph = await h.as('pharmacy');
  const store = await h.as('store');
  const month = istMonth(0);
  const todo = [];
  for (const c of CONTROLLED) {
    const r = ok(await ph.get(`/pharmacy/registers?schedule=${c.schedule}&month=${month}`));
    if (!r.items.length) todo.push(c);
  }
  if (!todo.length) return 'skipped';
  const { P } = await load(h);
  const stores = Object.fromEntries(
    (ok(await store.get('/inventory/stores')).items ?? []).map((s) => [s.code, s.id]),
  );
  if (!stores.PH) throw new Error('no pharmacy store PH');
  const vendor = (ok(await store.get('/inventory/vendors')).items ?? [])[0];
  if (!vendor) throw new Error('no vendor');
  const itemId = async (code) =>
    h.system(async () => {
      const it = await M('Item').findOne({ code }).lean();
      return it ? String(it._id) : null;
    });
  const stockIn = async (id) =>
    h.system(async () => {
      const rows = await M('StockBatch')
        .find({ storeId: stores.PH, itemId: id, qty: { $gt: 0 } })
        .lean();
      return rows.reduce((t, b) => t + b.qty, 0);
    });
  const stays = await h.system(() =>
    M('Admission')
      .find({ status: { $in: ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED'] } })
      .lean()
      .exec(),
  );
  const out = [];
  for (const c of todo) {
    let id = await itemId(c.code);
    if (!id)
      id = ok(
        await store.post('/inventory/items').send({
          code: c.code,
          hsn: '3004',
          reorderLevel: 20,
          ...c.item,
        }),
        201,
      ).id;
    if ((await stockIn(id)) < c.qty) {
      const g = ok(
        await store.post('/inventory/grns').send({
          vendorId: vendor.id,
          storeId: stores.PH,
          invoiceNo: `CTRL-${c.code.slice(0, 8).toUpperCase()}-${istDay(0).slice(5).replace('-', '')}`,
          invoiceDate: istDay(-1),
          lines: [
            {
              itemId: id,
              batchNo: `${c.code.slice(0, 3).toUpperCase()}${istDay(0).slice(2, 7).replace('-', '')}`,
              expiry: istMonth(18),
              qty: 100,
              rate: c.rate,
              mrp: c.mrp,
            },
          ],
        }),
        201,
        202,
      );
      if (g.approvalId) await h.approve('admin', String(g.approvalId));
    }
    const stay =
      c.schedule === 'NARCOTIC' && stays.find((a) => String(a.patient.id) === P[c.patient]);
    const d = ok(
      await ph.post('/pharmacy/sales').send({
        ...(stay ? { admissionId: String(stay._id) } : { patientId: P[c.patient] }),
        storeId: stores.PH,
        lines: [{ itemId: id, qty: c.qty }],
        prescriber: c.prescriber,
        prescriptionCopy: true,
      }),
      201,
    );
    out.push(
      `${c.schedule}: ${d.dispNo ?? d.dispense?.dispNo ?? 'dispensed'} ${c.item.name} x${c.qty}`,
    );
  }
  const counts = [];
  for (const c of CONTROLLED)
    counts.push(
      `${c.schedule}=${ok(await ph.get(`/pharmacy/registers?schedule=${c.schedule}&month=${month}`)).items.length}`,
    );
  return `${out.join('; ')} · registers ${counts.join(' ')}`;
}

// ---------------------------------------------------------------- 4. planned discharges

async function plannedDischarges(h) {
  const doc = await h.as('doctor');
  const planned = ok(await doc.get('/ipd/admissions?status=DISCHARGE_PLANNED,DISCHARGE_STARTED'));
  if ((planned.items ?? []).length) return 'skipped';
  const { P } = await load(h);
  const stays = (ok(await doc.get('/ipd/admissions?status=ADMITTED,UNDER_TREATMENT')).items ?? [])
    .filter((a) => a.payer?.kind === 'CASH' || !a.payer)
    .sort((a, b) => String(a.ipNo).localeCompare(String(b.ipNo)));
  const plan = [
    [P.Harish, `${istDay(1)}T11:00:00+05:30`],
    [P.Suresh, `${istDay(2)}T12:00:00+05:30`],
  ];
  const done = [];
  for (const [patientId, expectedAt] of plan) {
    const a = stays.find((s) => String(s.patient?.id) === patientId);
    if (!a) continue;
    let r = await doc.post(`/ipd/admissions/${a.id}/plan-discharge`).send({ expectedAt });
    if (r.status === 403)
      r = await (
        await h.as('medsupt')
      )
        .post(`/ipd/admissions/${a.id}/plan-discharge`)
        .send({ expectedAt });
    ok(r);
    done.push(`${a.ipNo} → ${expectedAt.slice(0, 16)}`);
  }
  if (!done.length) throw new Error('no cash in-patients to plan');
  return `${done.length} planned (${done.join('; ')})`;
}

// ---------------------------------------------------------------- 5. doctor payouts

const PAYOUT_VISITS = [
  ['DMI', 'doctor', 'Sunil', { code: 'I10', name: 'Essential (primary) hypertension' }],
  [
    'DMI',
    'doctor',
    'Rekha',
    { code: 'E11.9', name: 'Type 2 diabetes mellitus without complications' },
  ],
  [
    'DRM',
    'clinic',
    'Ravi',
    { code: 'J06.9', name: 'Acute upper respiratory infection, unspecified' },
  ],
];

async function doctorPayouts(h) {
  const acc = await h.as('accounts');
  const month = istMonth(0);
  if ((ok(await acc.get(`/finance/doctor-payouts?month=${month}`)).items ?? []).length)
    return 'skipped';
  const { P, D } = await load(h);
  const cashier = await h.as('cashier');
  const fo = await h.as('frontoffice');
  let closed = 0;
  for (const [i, [code, login, who, dx]] of PAYOUT_VISITS.entries()) {
    const tag = `Demo payout visit ${i + 1}`;
    const appt = await h.system(() => M('Appointment').findOne({ notes: tag }).lean().exec());
    let visit = appt
      ? await h.system(() => M('OpdVisit').findOne({ appointmentId: appt._id }).lean().exec())
      : null;
    if (visit?.status === 'CLOSED') continue;
    let visitId = visit && String(visit._id);
    if (!visitId) {
      const w = ok(
        await key(fo.post('/opd/appointments')).send({
          patientId: P[who],
          doctorId: D[code].id,
          channel: 'WALK_IN',
          notes: tag,
        }),
        201,
      );
      visitId = w.visit.id;
    }
    const doc = await h.as(login);
    const v = ok(await doc.get(`/opd/visits/${visitId}`));
    if (v.consultation?.status !== 'SIGNED' && v.stage !== 'DONE')
      ok(
        await doc.post(`/opd/visits/${visitId}/complete`).send({
          rx: [],
          diagnoses: [dx],
          advice: 'Review in two weeks with reports.',
        }),
      );
    ok(await key(cashier.post(`/opd/visits/${visitId}/close`)).send({ mode: 'CASH' }));
    closed++;
  }
  const r = ok(await acc.post('/finance/doctor-payouts/draft').send({ month }));
  const rows = r.items ?? [];
  return `${closed} OPD visits closed; ${rows.length} payouts drafted (${rows
    .map((p) => `${p.name}: ${p.bills} bills, net ₹${(p.net / 100).toFixed(0)}`)
    .join('; ')})`;
}

// ---------------------------------------------------------------- 6. referral statements

const REFERRED = [
  {
    first: 'Lata',
    last: 'Bhosale',
    gender: 'F',
    age: 58,
    mobile: '9822044101',
    codes: ['CONDPJ', 'ECG', 'LIPID'],
  },
  {
    first: 'Mohan',
    last: 'Deshpande',
    gender: 'M',
    age: 63,
    mobile: '9822044102',
    codes: ['CONDPJ', 'TMT'],
  },
];

async function referralStatements(h) {
  const crm = await h.as('crm');
  const month = istMonth(0);
  const have = await h.system(() => M('ReferralStatement').countDocuments({ month }).exec());
  if (have) return 'skipped';
  const admin = await h.as('admin');
  const fo = await h.as('frontoffice');
  const cashier = await h.as('cashier');
  const { S } = await load(h);
  let src = (ok(await admin.get('/masters/referral-sources?q=DRKAPOOR')).items ?? [])[0];
  if (!src) {
    const r = ok(
      await admin.post('/masters/referral-sources').send({
        code: 'DRKAPOOR',
        name: 'Dr. S. Kapoor Family Clinic',
        kind: 'DOCTOR',
        phone: '9822012345',
      }),
      201,
      202,
    );
    if (r.approvalId) await h.approve('superadmin', String(r.approvalId));
    src = (ok(await admin.get('/masters/referral-sources?q=DRKAPOOR')).items ?? [])[0];
    if (!src) throw new Error('referral source not created');
  }
  const billed = [];
  for (const p of REFERRED) {
    let patient = await h.system(() =>
      M('Patient').findOne({ mobile: p.mobile, 'name.first': p.first }).lean().exec(),
    );
    let patientId = patient && String(patient._id);
    if (!patientId)
      patientId = ok(
        await fo.post('/patients').send({
          registrationType: 'QUICK',
          name: { first: p.first, last: p.last },
          gender: p.gender,
          mobile: p.mobile,
          birth: { age: { years: p.age } },
          noKnownAllergies: true,
          referral: { sourceId: src.id, doctorName: 'Dr. S. Kapoor' },
          confirmNotDuplicate: true,
        }),
        201,
      ).id;
    const notes = 'Referred by Dr. S. Kapoor: cardiac work-up';
    const found = await h.system(() =>
      M('Bill').findOne({ 'patient.id': patientId, notes }).lean().exec(),
    );
    let bill = found
      ? ok(await cashier.get(`/billing/bills/${found._id}`))
      : ok(
          await cashier.post('/billing/bills').send({
            patientId,
            lines: p.codes.map((c) => ({ serviceId: S[c] })),
            notes,
          }),
          201,
        );
    if (bill.status === 'DRAFT')
      bill = ok(
        await cashier.post(`/billing/bills/${bill.id}/finalize`).send({ version: bill.version }),
      );
    if (bill.totals.balance > 0) {
      const amt = bill.totals.balance / 100;
      ok(
        await key(cashier.post('/billing/payments')).send({
          patientId,
          mode: 'CASH',
          amount: amt,
          allocations: [{ billId: bill.id, amount: amt }],
        }),
        201,
      );
    }
    billed.push(`${p.first} ${p.last} ${bill.billNo}`);
  }
  ok(
    await crm.put('/crm/referrals/agreements').send({
      referralSourceId: src.id,
      feePct: 10,
      categories: ['CONSULTATION', 'PROCEDURE', 'LAB'],
      notes: 'Monthly statement, paid by NEFT',
    }),
  );
  const st = ok(await crm.post('/crm/referrals/statements').send({ month })).items;
  return `source ${src.code}; ${billed.join(', ')} paid; ${st.length} statement(s): ${st
    .map((s) => `${s.sourceName} fee ₹${(s.fee / 100).toFixed(0)}`)
    .join('; ')}`;
}

// ---------------------------------------------------------------- 7. HR exit

async function hrExit(h) {
  const hr = await h.as('hr');
  const exits = ok(await hr.get('/hr/exits')).items ?? [];
  if (exits.length) return 'skipped';
  const all = ok(await hr.get('/hr/employees?limit=200')).items ?? [];
  let e = all.find((x) => !x.userId && x.status === 'ACTIVE');
  if (!e)
    e = ok(
      await hr.post('/hr/employees').send({
        name: { first: 'Santosh', last: 'Waghmare' },
        gender: 'M',
        mobile: '9822077311',
        designation: 'Housekeeping Supervisor',
        type: 'CONTRACT',
        joinedOn: '2023-06-01',
      }),
      201,
    );
  const r = ok(
    await hr.post(`/hr/employees/${e.id}/exit`).send({
      exitOn: istDay(30),
      reason: 'Resigned: relocating to Nagpur',
    }),
  );
  const ex = (ok(await hr.get('/hr/exits')).items ?? []).find(
    (x) => (x.id ?? x.employeeId) === e.id,
  );
  if (ex)
    ok(
      await hr.post(`/hr/exits/${e.id}/clear`).send({
        version: ex.version ?? r.version,
        dept: 'IT',
        note: 'Email and HIS access to be revoked on the last day',
      }),
    );
  return `${e.empNo ?? e.id} ${typeof e.name === 'string' ? e.name : (e.name?.first ?? '')} on notice to ${istDay(30)} (status ${r.status})`;
}

export const sections = [
  ['tele-consultations today', teleConsults],
  ['radiology Form F', formF],
  ['pharmacy H1 / X / narcotic registers', pharmacyRegisters],
  ['planned discharges', plannedDischarges],
  ['doctor payouts', doctorPayouts],
  ['referral statements', referralStatements],
  ['HR exit on notice', hrExit],
];
