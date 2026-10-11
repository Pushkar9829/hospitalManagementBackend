/**
 * Flow seeds, clinical area: IPD (medicine orders, MAR, vitals, intake-output, pre-auth),
 * pharmacy (ward issues, returns, a counter sale), inventory (indents, requisitions, count
 * adjustments, a kitchen store), laboratory registers and send-outs, diet (notes, trays,
 * kitchen consumption) and MRD (death register, release of information, legal hold).
 * Everything goes through the API as the role that does it on the floor.
 */
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { ok, istDay } from './harness.js';

const M = (name) => mongoose.model(name);
const IST = 330 * 60_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const key = (req) => req.set('Idempotency-Key', randomUUID());
const ym = (months) => {
  const d = new Date(Date.now() + IST);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
};
/** HH:mm in IST of a moment. */
const hhmm = (t) => new Date(t + IST).toISOString().slice(11, 16);
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** Reads in the demo tenant's system context. */
const read = (h, name, filter = {}, opts = {}) =>
  h.system(() => {
    let q = M(name).find({ tenantId: h.tenant._id, ...filter });
    if (opts.sort) q = q.sort(opts.sort);
    return q.lean().exec();
  });
const count = (h, name, filter = {}) =>
  h.system(() =>
    M(name)
      .countDocuments({ tenantId: h.tenant._id, ...filter })
      .exec(),
  );

// ------------------------------------------------------------------ shared lookups

async function admitted(h) {
  return read(
    h,
    'Admission',
    { status: { $in: ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'] } },
    { sort: { admittedAt: 1 } },
  );
}
async function itemIds(h) {
  const rows = await read(h, 'Item');
  return Object.fromEntries(rows.map((i) => [i.code, String(i._id)]));
}
async function storeIds(h) {
  const rows = await read(h, 'Store');
  return Object.fromEntries(rows.map((s) => [s.code, String(s._id)]));
}
async function patientByName(h, first, last) {
  const [p] = await read(h, 'Patient', { 'name.first': first, 'name.last': last });
  return p;
}

/** New stays this seed owns (existing admitted patients are left as they are). */
const NEW_STAYS = [
  {
    first: 'Anita',
    last: 'Kulkarni',
    gender: 'F',
    age: 46,
    mobile: '9820031101',
    ward: 'PVT',
    reason: 'Symptomatic gallstones, laparoscopic cholecystectomy',
    payer: { code: 'STAR', policyNo: 'SH-2026-448817' },
  },
  {
    first: 'Vikram',
    last: 'Sawant',
    gender: 'M',
    age: 58,
    mobile: '9820031102',
    ward: 'W2',
    reason: 'Uncontrolled type 2 diabetes with foot ulcer',
    payer: { code: 'STAR', policyNo: 'SH-2025-993120' },
  },
  {
    first: 'Prakash',
    last: 'Joshi',
    gender: 'M',
    age: 71,
    mobile: '9820031103',
    ward: 'ICU',
    reason: 'Massive stroke, GCS 5, ventilated',
    emergency: true,
  },
];

async function stayOf(h, first, last) {
  const p = await patientByName(h, first, last);
  if (!p) return null;
  const [a] = await read(h, 'Admission', { 'patient.id': p._id }, { sort: { admittedAt: -1 } });
  return a ?? null;
}

// ------------------------------------------------------------------ sections

async function newAdmissions(h) {
  const fo = await h.as('frontoffice');
  const doctor = (await read(h, 'Doctor', { name: 'Dr. Meera Iyer' }))[0];
  const payers = Object.fromEntries((await read(h, 'Payer')).map((p) => [p.code, String(p._id)]));
  const beds = ok(await fo.get('/ipd/beds')).wards;
  const made = [];
  for (const s of NEW_STAYS) {
    if (await stayOf(h, s.first, s.last)) continue;
    let p = await patientByName(h, s.first, s.last);
    if (!p) {
      const r = ok(
        await fo.post('/patients').send({
          registrationType: 'QUICK',
          name: { first: s.first, last: s.last },
          gender: s.gender,
          mobile: s.mobile,
          birth: { age: { years: s.age } },
          noKnownAllergies: true,
          confirmNotDuplicate: true,
        }),
      );
      p = { _id: r.id };
    }
    const bed = beds
      .flatMap((w) => w.beds)
      .find((b) => b.code.startsWith(`${s.ward}-`) && b.status === 'AVAILABLE');
    if (!bed) throw new Error(`no free ${s.ward} bed`);
    const body = {
      patientId: String(p._id),
      doctorId: String(doctor._id),
      reason: s.reason,
      bedId: bed.id,
    };
    if (s.payer)
      body.payer = { kind: 'INSURANCE', payerId: payers[s.payer.code], policyNo: s.payer.policyNo };
    else body.emergency = true;
    const a = ok(await key(fo.post('/ipd/admissions')).send(body), 201);
    bed.status = 'OCCUPIED';
    made.push(`${a.ipNo} ${s.first} ${s.last} (${bed.code})`);
  }
  return made.length ? made.join(', ') : 'skipped';
}

async function vitalsAndIo(h) {
  if (await count(h, 'IpdVitals')) return 'skipped';
  const nurse = await h.as('nurse');
  const stays = await admitted(h);
  // Six observations over the last day per stay; the Joshi stay is deteriorating.
  const sets = {
    stable: [
      { rr: 18, spo2: 97, tempC: 37.2, sbp: 128, dbp: 80, hr: 84, painScore: 2 },
      { rr: 16, spo2: 98, tempC: 37.0, sbp: 124, dbp: 78, hr: 78, painScore: 1 },
    ],
    febrile: [
      { rr: 22, spo2: 94, tempC: 38.6, sbp: 112, dbp: 70, hr: 104, painScore: 3 },
      { rr: 20, spo2: 95, tempC: 38.1, sbp: 118, dbp: 74, hr: 96, painScore: 2 },
    ],
    critical: [
      {
        rr: 26,
        spo2: 91,
        onOxygen: true,
        tempC: 38.9,
        sbp: 94,
        dbp: 58,
        hr: 124,
        consciousness: 'U',
      },
      {
        rr: 28,
        spo2: 89,
        onOxygen: true,
        tempC: 39.2,
        sbp: 86,
        dbp: 50,
        hr: 132,
        consciousness: 'U',
      },
    ],
  };
  let v = 0;
  let io = 0;
  for (const [i, a] of stays.entries()) {
    const kind = a.patient.name.startsWith('Prakash')
      ? 'critical'
      : i % 3 === 1
        ? 'febrile'
        : 'stable';
    for (let k = 5; k >= 0; k--) {
      const base = sets[kind][k % 2];
      const body = { ...base, at: ago(k * 4 * HOUR + 10 * MIN) };
      if (a.patient.name.startsWith('Vikram')) body.sugar = 180 + k * 22;
      ok(await nurse.post(`/nursing/admissions/${a._id}/vitals`).send(body), 201);
      v++;
    }
    const entries = [
      { kind: 'INTAKE', route: 'IV', ml: 1000, note: 'NS 0.9% over 8 h', at: ago(20 * HOUR) },
      { kind: 'INTAKE', route: 'ORAL', ml: 600, at: ago(14 * HOUR) },
      { kind: 'OUTPUT', route: 'URINE', ml: 450, at: ago(12 * HOUR) },
      { kind: 'INTAKE', route: 'IV', ml: 500, at: ago(6 * HOUR) },
      { kind: 'OUTPUT', route: 'URINE', ml: 700, at: ago(2 * HOUR) },
    ];
    if (kind === 'critical')
      entries.push({ kind: 'INTAKE', route: 'RT', ml: 300, note: 'RT feed', at: ago(3 * HOUR) });
    if (a.patient.name.startsWith('Anita'))
      entries.push({ kind: 'OUTPUT', route: 'VOMIT', ml: 150, at: ago(5 * HOUR) });
    for (const e of entries) {
      ok(await nurse.post(`/nursing/admissions/${a._id}/io`).send(e), 201);
      io++;
    }
  }
  return `${v} observation sets, ${io} intake-output entries on ${stays.length} stays`;
}

/** Medicine plans per stay (drugId = pharmacy item code, so the ward issue finds the stock). */
const PLANS = {
  Harish: [
    {
      drug: { drugId: 'ecosprin75', brand: 'Ecosprin 75 mg tab', generic: 'Aspirin' },
      dose: '75 mg',
      route: 'ORAL',
      frequency: 'OD',
      days: 5,
    },
    {
      drug: { drugId: 'atorva40', brand: 'Atorvastatin 40 mg tab', generic: 'Atorvastatin' },
      dose: '40 mg',
      route: 'ORAL',
      frequency: 'OD',
      days: 5,
    },
    {
      drug: {
        drugId: 'metoprolol25',
        brand: 'Metolar XR 25 mg tab',
        generic: 'Metoprolol succinate',
      },
      dose: '25 mg',
      route: 'ORAL',
      frequency: 'BD',
      days: 5,
    },
    {
      drug: {
        drugId: 'sorbitrate5',
        brand: 'Sorbitrate 5 mg tab',
        generic: 'Isosorbide dinitrate',
      },
      dose: '5 mg',
      route: 'SL',
      frequency: 'STAT',
      stat: true,
    },
  ],
  Suresh: [
    {
      drug: {
        drugId: 'augmentin625',
        brand: 'Augmentin 625 mg tab',
        generic: 'Amoxicillin + Clavulanic acid',
      },
      dose: '625 mg',
      route: 'ORAL',
      frequency: 'BD',
      days: 5,
    },
    {
      drug: { drugId: 'dolo650', brand: 'Dolo 650 mg tab', generic: 'Paracetamol' },
      dose: '650 mg',
      route: 'ORAL',
      frequency: 'TDS',
      days: 3,
    },
    {
      drug: { drugId: 'pan40', brand: 'Pan 40 mg tab', generic: 'Pantoprazole' },
      dose: '40 mg',
      route: 'ORAL',
      frequency: 'OD',
      days: 5,
      held: true,
    },
  ],
  Neeta: [
    {
      drug: { drugId: 'cefixime200', brand: 'Taxim-O 200 mg tab', generic: 'Cefixime' },
      dose: '200 mg',
      route: 'ORAL',
      frequency: 'BD',
      days: 5,
    },
    {
      drug: { drugId: 'dolo650', brand: 'Dolo 650 mg tab', generic: 'Paracetamol' },
      dose: '650 mg',
      route: 'ORAL',
      frequency: 'STAT',
      stat: true,
    },
  ],
  Anita: [
    {
      drug: { drugId: 'pan40', brand: 'Pan 40 mg tab', generic: 'Pantoprazole' },
      dose: '40 mg',
      route: 'ORAL',
      frequency: 'OD',
      days: 3,
    },
    {
      drug: { drugId: 'dolo650', brand: 'Dolo 650 mg tab', generic: 'Paracetamol' },
      dose: '650 mg',
      route: 'ORAL',
      frequency: 'TDS',
      days: 3,
    },
    {
      drug: { drugId: 'ns500', brand: 'Normal saline 500 ml', generic: 'Sodium chloride 0.9%' },
      dose: '500 ml',
      route: 'IV',
      frequency: 'BD',
      days: 2,
    },
  ],
  Vikram: [
    {
      drug: { drugId: 'glycomet500', brand: 'Glycomet 500 mg tab', generic: 'Metformin' },
      dose: '500 mg',
      route: 'ORAL',
      frequency: 'BD',
      days: 7,
    },
    {
      drug: { brand: 'Actrapid insulin', generic: 'Insulin regular' },
      dose: '6 units',
      route: 'SC',
      frequency: 'TDS',
      days: 7,
      refused: false,
    },
    {
      drug: { drugId: 'cefixime200', brand: 'Taxim-O 200 mg tab', generic: 'Cefixime' },
      dose: '200 mg',
      route: 'ORAL',
      frequency: 'BD',
      days: 7,
      rejected: true,
    },
  ],
  Prakash: [
    {
      drug: { drugId: 'pan40', brand: 'Pan 40 mg tab', generic: 'Pantoprazole' },
      dose: '40 mg',
      route: 'RT',
      frequency: 'OD',
      days: 5,
    },
    {
      drug: { drugId: 'atorva40', brand: 'Atorvastatin 40 mg tab', generic: 'Atorvastatin' },
      dose: '40 mg',
      route: 'RT',
      frequency: 'HS',
      days: 5,
    },
  ],
};

/** Dose times: one near now (so it can be charted), then the usual round times. */
function timesFor(freq) {
  const now = Date.now();
  const nowMin = Number(hhmm(now).slice(0, 2)) * 60 + Number(hhmm(now).slice(3));
  const near = nowMin >= 25 ? hhmm(now - 20 * MIN) : hhmm(now + 10 * MIN);
  const usual = { OD: [], BD: ['21:00'], TDS: ['14:00', '22:00'], HS: [] }[freq] ?? [];
  return [near, ...usual.filter((t) => t !== near)].slice(
    0,
    freq === 'OD' || freq === 'HS' ? 1 : 3,
  );
}

async function medicineOrdersAndMar(h) {
  if (await count(h, 'MedOrder')) return 'skipped';
  const doc = await h.as('doctor');
  const ph = await h.as('pharmacy');
  const nurse = await h.as('nurse');
  const stays = await admitted(h);
  let orders = 0;
  let given = 0;
  for (const a of stays) {
    const plan = PLANS[a.patient.name.split(' ')[0]];
    if (!plan) continue;
    for (const line of plan) {
      const { stat, held, rejected, refused: _r, ...body } = line;
      if (!stat) {
        body.times = timesFor(body.frequency);
        body.startAt = new Date(Date.now() - 30 * MIN).toISOString();
      }
      body.instructions = held ? 'Before breakfast' : undefined;
      const o = ok(await doc.post(`/ipd/admissions/${a._id}/med-orders`).send(body), 201);
      orders++;
      if (rejected) {
        ok(
          await ph.post(`/ipd/med-orders/${o.id}/verify`).send({
            decision: 'REJECT',
            reason: 'Duplicate antibiotic: already on augmentin cover; please review',
          }),
        );
        continue;
      }
      if (!stat) ok(await ph.post(`/ipd/med-orders/${o.id}/verify`).send({}));
      // Chart the dose that is due now; later doses stay on the MAR as due.
      let dose;
      for (const date of [istDay(0), istDay(1)]) {
        const mar = ok(await nurse.get(`/nursing/admissions/${a._id}/mar?date=${date}`));
        const ord = mar.orders.find((x) => x.id === o.id);
        dose = ord?.doses.find(
          (d) => d.status === 'DUE' && Math.abs(new Date(d.dueAt) - Date.now()) <= 55 * MIN,
        );
        if (dose) break;
      }
      if (!dose) continue;
      const give = held
        ? { status: 'HELD', reason: 'Nil by mouth for ultrasound abdomen' }
        : { wristband: a.patient.uhid, witness: o.highAlert ? 'Demo Ward In-charge' : undefined };
      ok(await nurse.post(`/nursing/mar/${dose.id}/administer`).send(give));
      given++;
    }
  }
  return `${orders} orders on ${stays.length} stays, ${given} doses charted`;
}

/** A drug round now: the dose due this hour is given (or refused), and a STAT dose is charted. */
async function marRound(h) {
  const charted = await count(h, 'MarDose', { status: { $ne: 'DUE' } });
  if (charted >= 6) return 'skipped';
  const doc = await h.as('doctor');
  const ph = await h.as('pharmacy');
  const nurse = await h.as('nurse');
  const stays = await admitted(h);
  let given = 0;
  const findDose = async (a, orderId) => {
    for (const date of [istDay(0), istDay(1)]) {
      const mar = ok(await nurse.get(`/nursing/admissions/${a._id}/mar?date=${date}`));
      const d = mar.orders
        .find((x) => x.id === orderId)
        ?.doses.find(
          (x) => x.status === 'DUE' && Math.abs(new Date(x.dueAt) - Date.now()) <= 55 * MIN,
        );
      if (d) return d;
    }
    return null;
  };
  for (const [i, a] of stays.entries()) {
    const sched = ok(
      await doc.post(`/ipd/admissions/${a._id}/med-orders`).send({
        drug: {
          drugId: 'shelcal500',
          brand: 'Shelcal 500 mg tab',
          generic: 'Calcium + Vitamin D3',
        },
        dose: '500 mg',
        route: 'ORAL',
        frequency: 'BD',
        days: 5,
        times: timesFor('BD'),
        startAt: new Date(Date.now() - 30 * MIN).toISOString(),
      }),
      201,
    );
    ok(await ph.post(`/ipd/med-orders/${sched.id}/verify`).send({}));
    const d = await findDose(a, sched.id);
    if (d) {
      const body =
        i === 1
          ? { status: 'REFUSED', reason: 'Patient refused: nausea, will retry after the meal' }
          : { wristband: a.ipNo };
      ok(await nurse.post(`/nursing/mar/${d.id}/administer`).send(body));
      given++;
    }
    const stat = ok(
      await doc.post(`/ipd/admissions/${a._id}/med-orders`).send({
        drug: { brand: 'Ondansetron 4 mg inj', generic: 'Ondansetron' },
        dose: '4 mg',
        route: 'IV',
        frequency: 'STAT',
        instructions: 'For nausea',
      }),
      201,
    );
    const sd = await findDose(a, stat.id);
    if (sd) {
      ok(await nurse.post(`/nursing/mar/${sd.id}/administer`).send({ wristband: a.patient.uhid }));
      given++;
    }
  }
  return `${given} doses charted on ${stays.length} stays`;
}

async function wardIssuesAndReturns(h) {
  if (await count(h, 'Dispense', { kind: 'ISSUE' })) return 'skipped';
  await h.deliver(); // verified orders → pharmacy queue
  const ph = await h.as('pharmacy');
  const nurse = await h.as('nurse');
  const items = await itemIds(h);
  const queue = ok(await ph.get('/pharmacy/rx-queue?source=IPD')).items;
  const issues = [];
  for (const q of queue) {
    const rx = ok(await ph.get(`/pharmacy/rx/${q.id}`));
    const lines = rx.lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => items[l.drugId] && (l.available ?? 1) > 0)
      .map(({ l, i }) => ({
        itemId: items[l.drugId],
        qty: Math.max(1, Math.min(l.suggestedQty || 6, 10)),
        rxLine: i,
      }));
    if (!lines.length) continue; // e.g. insulin is not stocked by the pharmacy
    const d = ok(await ph.post('/pharmacy/sales').send({ rxId: q.id, lines }), 201);
    issues.push({
      d,
      admissionId: rx.admissionId ?? q.admissionId,
      patient: q.patient ?? rx.patient,
    });
  }
  // Returns: two accepted (stopped medicine, discharge left-over), one waiting on a new stay.
  const anita = await stayOf(h, 'Anita', 'Kulkarni');
  let returns = 0;
  const done = new Set();
  for (const { d } of issues) {
    const line = d.lines.find((l) => l.qty >= 2);
    if (!line) continue;
    const stay = String(d.admissionId ?? '');
    if (done.has(stay)) continue;
    const pending = anita && stay === String(anita._id);
    if (!pending && returns >= 2) continue;
    const r = ok(
      await nurse.post('/pharmacy/returns').send({
        dispenseId: d.id,
        lines: [{ lineId: line.id, qty: pending ? 1 : 2 }],
        reason: pending
          ? 'Patient shifted to IV, tablets not needed'
          : 'Order stopped by consultant',
      }),
      201,
    );
    done.add(stay);
    returns++;
    if (!pending) ok(await ph.post(`/pharmacy/returns/${r.id}/decide`).send({ accept: true }));
  }
  return `${issues.length} ward issues, ${returns} returns`;
}

async function counterSale(h) {
  if (await count(h, 'Dispense', { kind: 'SALE' })) return 'skipped';
  const ph = await h.as('pharmacy');
  const items = await itemIds(h);
  const queue = ok(await ph.get('/pharmacy/rx-queue?source=OPD')).items;
  let sold = 0;
  for (const q of queue.slice(0, 2)) {
    const rx = ok(await ph.get(`/pharmacy/rx/${q.id}`));
    const lines = rx.lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => items[l.drugId] && (l.available ?? 0) > 0)
      .map(({ l, i }) => ({
        itemId: items[l.drugId],
        qty: Math.max(1, Math.min(l.suggestedQty || 10, l.available)),
        rxLine: i,
      }));
    if (!lines.length) continue;
    ok(await ph.post('/pharmacy/sales').send({ rxId: q.id, lines }), 201);
    sold++;
  }
  // A walk-in buying paracetamol and ORS over the counter.
  const ravi = await patientByName(h, 'Ravi', 'Kumar');
  ok(
    await ph.post('/pharmacy/sales').send({
      patientId: String(ravi._id),
      lines: [
        { itemId: items.dolo650, qty: 10 },
        { itemId: items.ors, qty: 4 },
      ],
    }),
    201,
  );
  return `${sold + 1} counter sales (bills left for the counter)`;
}

async function preAuths(h) {
  if (await count(h, 'PreAuth')) return 'skipped';
  const tpa = await h.as('tpa');
  const anita = await stayOf(h, 'Anita', 'Kulkarni');
  const vikram = await stayOf(h, 'Vikram', 'Sawant');
  if (!anita || !vikram) throw new Error('insured stays missing (run the admissions section)');
  // Anita: query answered, approved, then an enhancement for the extra day.
  const a = ok(
    await tpa.post(`/ipd/admissions/${anita._id}/preauth`).send({
      requested: 85_000_00,
      diagnosis: 'K80.2 Calculus of gallbladder without cholecystitis',
      plannedTreatment: 'Laparoscopic cholecystectomy, 3 days stay',
      memberId: 'STAR-MEM-77120',
    }),
    201,
  );
  ok(
    await tpa
      .post(`/ipd/preauths/${a.id}/reply`)
      .send({ outcome: 'QUERY', text: 'Send the ultrasound abdomen report and LFT' }),
  );
  ok(
    await tpa
      .post(`/ipd/preauths/${a.id}/answer-query`)
      .send({ text: 'USG abdomen and LFT reports attached' }),
  );
  ok(
    await tpa
      .post(`/ipd/preauths/${a.id}/reply`)
      .send({ outcome: 'APPROVED', amount: 70_000_00, text: 'Approved for package rate' }),
  );
  ok(
    await tpa
      .post(`/ipd/preauths/${a.id}/enhancements`)
      .send({ amount: 15_000_00, reason: 'Post-op ileus, stay extended by 2 days' }),
  );
  // Vikram: sent, the insurer asked a question that is still open.
  const v = ok(
    await tpa.post(`/ipd/admissions/${vikram._id}/preauth`).send({
      requested: 60_000_00,
      diagnosis: 'E11.621 Type 2 diabetes with foot ulcer',
      plannedTreatment: 'IV antibiotics, debridement, insulin titration',
      memberId: 'STAR-MEM-55102',
    }),
    201,
  );
  ok(
    await tpa
      .post(`/ipd/preauths/${v.id}/reply`)
      .send({ outcome: 'QUERY', text: 'Duration of diabetes and last HbA1c?' }),
  );
  return '2 cashless cases (enhancement pending, query open)';
}

async function indents(h) {
  if (await count(h, 'Indent', { note: 'Emergency tray: paracetamol and ORS' })) return 'skipped';
  const nurse = await h.as('nurse');
  // The pharmacy role cannot raise indents (no inventory:indent:create), so the store raises
  // the pharmacy's refill on its behalf.
  const ph = await h.as('store');
  const store = await h.as('store');
  const items = await itemIds(h);
  const s = await storeIds(h);
  const mk = async (c, body) => {
    const [have] = await read(h, 'Indent', { note: body.note });
    if (have) return { id: String(have._id), existing: true };
    return ok(await c.post('/inventory/indents').send(body), 201);
  };
  const i1 = await mk(nurse, {
    fromStoreId: s.MAIN,
    toStoreId: s.GW,
    note: 'Weekly ward consumables',
    lines: [
      { itemId: items.gloves, qty: 60 },
      { itemId: items.syringe5, qty: 80 },
      { itemId: items.ns500, qty: 40 },
    ],
  });
  const i2 = await mk(nurse, {
    fromStoreId: s.MAIN,
    toStoreId: s.GW,
    note: 'Night stock top-up',
    lines: [{ itemId: items.syringe5, qty: 200 }], // more than the store holds: partial
  });
  await mk(ph, {
    fromStoreId: s.MAIN,
    toStoreId: s.PH,
    note: 'Pharmacy shelf refill',
    lines: [
      { itemId: items.dolo650, qty: 100 },
      { itemId: items.pan40, qty: 100 },
      { itemId: items.augmentin625, qty: 60 },
    ],
  });
  await mk(nurse, {
    fromStoreId: s.PH,
    toStoreId: s.GW,
    note: 'Emergency tray: paracetamol and ORS',
    lines: [
      { itemId: items.dolo650, qty: 20 },
      { itemId: items.ors, qty: 10 },
    ],
  });
  for (const i of [i1, i2]) {
    const [n] = await read(h, 'Indent', { _id: new mongoose.Types.ObjectId(i.id) });
    if (n.status === 'OPEN') ok(await store.post(`/inventory/indents/${i.id}/issue`));
  }
  return '4 indents (1 issued, 1 partial, 2 open)';
}

async function requisitions(h) {
  if (await count(h, 'PurchaseRequisition')) return 'skipped';
  const nurse = await h.as('nurse');
  const store = await h.as('store');
  const items = await itemIds(h);
  const s = await storeIds(h);
  const vendor = (await read(h, 'Vendor'))[0];
  const mk = async (c, body) => ok(await c.post('/inventory/requisitions').send(body), 201);
  const r1 = await mk(nurse, {
    storeId: s.MAIN,
    reason: 'Dengue season: fever cases rising on the general ward',
    lines: [
      { itemId: items.dolo650, qty: 500 },
      { itemId: items.ors, qty: 200 },
    ],
  });
  const r2 = await mk(store, {
    storeId: s.MAIN,
    reason: 'Duplicate of the ward request',
    lines: [{ itemId: items.dolo650, qty: 300 }],
  });
  await mk(store, {
    storeId: s.MAIN,
    reason: 'Glove consumption up after the infection-control audit',
    lines: [
      { itemId: items.gloves, qty: 1000 },
      { itemId: items.syringe5, qty: 500 },
    ],
  });
  ok(
    await store.post(`/inventory/requisitions/${r1.id}/convert`).send({
      version: r1.version ?? 0,
      vendorId: String(vendor._id),
      rates: { [items.dolo650]: 150, [items.ors]: 1800 },
    }),
    200,
    202,
  );
  ok(
    await store
      .post(`/inventory/requisitions/${r2.id}/reject`)
      .send({ version: r2.version ?? 0, reason: 'Covered by the ward requisition' }),
  );
  return '3 requisitions (1 to PO, 1 rejected, 1 open)';
}

async function adjustments(h) {
  if (await count(h, 'StockAdjustment')) return 'skipped';
  const store = await h.as('store');
  const items = await itemIds(h);
  const s = await storeIds(h);
  const batches = await read(h, 'StockBatch', { storeId: new mongoose.Types.ObjectId(s.MAIN) });
  const qty = (code, batchNo) =>
    batches.find((b) => String(b.itemId) === items[code] && b.batchNo === batchNo)?.qty;
  const plan = [
    ['gloves', 'B38A', -4, 'Physical count: 4 pairs torn, written off'],
    ['syringe5', 'B37A', -2, 'Physical count short by 2'],
    ['cetzine10', 'B20A', +5, 'Loose strip found in the returns bin'],
    ['calpol', 'B12A', -1, 'Bottle broken during shelving'],
  ];
  const made = [];
  for (const [code, batchNo, delta, reason] of plan) {
    const now = qty(code, batchNo);
    if (now == null) continue;
    made.push(
      ok(
        await store.post('/inventory/adjustments').send({
          storeId: s.MAIN,
          itemId: items[code],
          batchNo,
          countedQty: Math.max(0, now + delta),
          reason,
        }),
        201,
        202,
      ),
    );
  }
  // The pharmacy in-charge approves all but the last.
  for (const a of made.slice(0, -1)) if (a.approvalId) await h.approve('pharmacy', a.approvalId);
  return `${made.length} count adjustments (${made.length - 1} approved, 1 pending)`;
}

async function labRegisters(h) {
  const lab = await h.as('lab');
  const notes = [];
  const add = async (path, rows, c = lab) => {
    const have = ok(await c.get(path)).items.length;
    if (have) return notes.push(`${path} skipped`);
    for (const r of rows) ok(await c.post(path).send(r), 201);
    notes.push(`${path} ${rows.length}`);
  };
  await add('/lab/qc/lots', [
    {
      lotNo: 'BR-4471',
      material: 'Bio-Rad Lyphochek Assayed Chemistry',
      level: 'L1',
      analyser: 'Cobas c311',
      openedOn: istDay(-10),
      expiresOn: istDay(170),
    },
    {
      lotNo: 'BR-4471',
      material: 'Bio-Rad Lyphochek Assayed Chemistry',
      level: 'L2',
      analyser: 'Cobas c311',
      openedOn: istDay(-10),
      expiresOn: istDay(170),
    },
    {
      lotNo: 'SX-2290',
      material: 'Sysmex e-Check (XS) haematology control',
      level: 'N',
      analyser: 'Sysmex XN-550',
      openedOn: istDay(-5),
      expiresOn: istDay(25),
    },
    {
      lotNo: 'BR-3902',
      material: 'Bio-Rad Immunoassay Plus',
      level: 'L1',
      analyser: 'Cobas e411',
      openedOn: istDay(-60),
      expiresOn: istDay(-2),
      active: false,
    },
  ]);
  await add('/lab/qc/eqas', [
    {
      scheme: 'CMC Vellore EQAS Clinical Chemistry',
      cycle: '2026-C3',
      department: 'Biochemistry',
      dueOn: istDay(12),
      analytes: 18,
      status: 'DUE',
    },
    {
      scheme: 'AIIMS EQAS Haematology',
      cycle: '2026-H2',
      department: 'Haematology',
      dueOn: istDay(-20),
      analytes: 8,
      acceptable: 8,
      status: 'REVIEWED',
      note: 'All within 2 SDI',
    },
    {
      scheme: 'Bio-Rad EQAS Immunoassay',
      cycle: '2026-09',
      department: 'Immunology',
      dueOn: istDay(-5),
      analytes: 12,
      acceptable: 11,
      status: 'SUBMITTED',
      note: 'TSH SDI 2.3: review calibration',
    },
  ]);
  await add('/lab/qc/maintenance', [
    {
      equipment: 'Cobas c311',
      activity: 'Two-point calibration, glucose and creatinine',
      kind: 'CALIBRATION',
      doneOn: istDay(-3),
      doneBy: 'Demo Laboratory',
      nextDue: istDay(27),
    },
    {
      equipment: 'Sysmex XN-550',
      activity: 'Weekly cleaning and background check',
      kind: 'MAINTENANCE',
      doneOn: istDay(-1),
      doneBy: 'Demo Laboratory',
      nextDue: istDay(6),
    },
    {
      equipment: 'Cobas e411',
      activity: 'Annual preventive maintenance by Roche engineer',
      kind: 'MAINTENANCE',
      doneOn: istDay(-40),
      doneBy: 'Roche service',
      nextDue: istDay(325),
      note: 'Lamp replaced',
    },
    {
      equipment: 'Centrifuge R-8C',
      activity: 'RPM verification with tachometer',
      kind: 'CALIBRATION',
      doneOn: istDay(-15),
      doneBy: 'Biomedical',
      nextDue: istDay(-1),
    },
  ]);
  await add('/lab/partners', [
    {
      code: 'METRO',
      name: 'Metropolis Healthcare, Pune',
      nabl: true,
      contact: 'Client desk',
      phone: '02066201000',
      tatHours: 48,
      tests: ['VITD', 'B12'],
    },
    {
      code: 'SRL',
      name: 'SRL Diagnostics Reference Lab',
      nabl: true,
      contact: 'Ms. Pooja',
      phone: '02267801234',
      tatHours: 72,
      tests: ['HPE'],
    },
    {
      code: 'NIV',
      name: 'NIV Pune (public health)',
      nabl: false,
      phone: '02026006290',
      tatHours: 120,
      tests: ['NS1'],
      active: true,
    },
  ]);
  await add('/lab/micro/media', [
    {
      medium: 'Blood agar',
      lotNo: 'HM-BA-2611',
      qcStrain: 'S. pyogenes ATCC 19615',
      result: 'PASS',
      testedOn: istDay(-4),
      expiresOn: istDay(40),
    },
    {
      medium: 'MacConkey agar',
      lotNo: 'HM-MA-2608',
      qcStrain: 'E. coli ATCC 25922',
      result: 'PASS',
      testedOn: istDay(-4),
      expiresOn: istDay(55),
    },
    {
      medium: 'CLED agar',
      lotNo: 'HM-CL-2602',
      qcStrain: 'P. mirabilis ATCC 12453',
      result: 'PENDING',
      expiresOn: istDay(60),
    },
    {
      medium: 'Mueller-Hinton agar',
      lotNo: 'HM-MH-2597',
      qcStrain: 'S. aureus ATCC 25923',
      result: 'FAIL',
      testedOn: istDay(-2),
      expiresOn: istDay(30),
      note: 'Zone sizes out of range: lot quarantined',
    },
  ]);
  return notes.join(', ');
}

async function sendOuts(h) {
  if (await count(h, 'SendOut')) return 'skipped';
  const doc = await h.as('doctor');
  const lab = await h.as('lab');
  const svc = Object.fromEntries(
    (await read(h, 'Service', { category: 'LAB' })).map((s) => [s.code, String(s._id)]),
  );
  const partners = ok(await lab.get('/lab/partners')).items;
  const metro = partners.find((p) => p.code === 'METRO');
  const stays = (await admitted(h))
    .filter((a) => !a.patient.name.startsWith('Prakash'))
    .slice(0, 3);
  const samples = [];
  for (const a of stays) {
    const o = ok(
      await doc.post('/lab/orders').send({
        admissionId: String(a._id),
        tests: [svc.VITD, svc.B12],
        clinicalNotes: 'Fatigue, peripheral neuropathy',
      }),
      201,
    );
    const lab2 = ok(
      await lab
        .post('/lab/collect')
        .send({ itemIds: o.items.map((i) => i.id), scan: a.patient.uhid }),
    );
    for (const l of lab2.labels) {
      ok(await lab.post(`/lab/samples/${l.sampleNo}/receive`));
      samples.push(l.sampleNo);
    }
  }
  const half = Math.ceil(samples.length / 2);
  const m1 = ok(
    await lab.post('/lab/send-outs').send({
      partnerId: metro.id,
      sampleNos: samples.slice(0, half),
      courier: 'Metropolis pick-up, 11:00',
    }),
    201,
  );
  ok(
    await lab.post('/lab/send-outs').send({
      partnerId: metro.id,
      sampleNos: samples.slice(half),
      courier: 'Metropolis pick-up, 17:00',
    }),
    201,
  );
  ok(await lab.post(`/lab/send-outs/${m1.id}/received`).send({ version: m1.version ?? 0 }));
  return `${samples.length} samples on 2 manifests (1 results back)`;
}

async function dietNotesAndTrays(h) {
  const kitchen = await h.as('kitchen');
  const nurse = await h.as('nurse');
  const doc = await h.as('doctor');
  const out = [];
  await h.deliver(); // new admissions → default diet orders
  if (!(await count(h, 'DietNote'))) {
    const stays = await admitted(h);
    const bySurname = Object.fromEntries(stays.map((a) => [a.patient.name.split(' ')[0], a]));
    const notes = [
      [
        'Vikram',
        {
          kind: 'ASSESSMENT',
          heightCm: 170,
          weightKg: 84,
          risk: 'MEDIUM',
          kcal: 1800,
          proteinG: 70,
          text: 'Type 2 DM, HbA1c 9.8. 1800 kcal diabetic diet, 6 small meals, no added sugar.',
        },
      ],
      [
        'Vikram',
        {
          kind: 'COUNSELLING',
          text: 'Counselled patient and wife on carbohydrate counting and foot care.',
        },
      ],
      [
        'Harish',
        {
          kind: 'ASSESSMENT',
          heightCm: 168,
          weightKg: 76,
          risk: 'LOW',
          kcal: 1700,
          proteinG: 60,
          text: 'Post-MI: cardiac diet, salt under 5 g/day, low saturated fat.',
        },
      ],
      [
        'Anita',
        {
          kind: 'ASSESSMENT',
          heightCm: 158,
          weightKg: 69,
          risk: 'LOW',
          kcal: 1500,
          text: 'Post lap chole: clear liquids to soft, low-fat diet.',
        },
      ],
      [
        'Suresh',
        {
          kind: 'DISCHARGE_PLAN',
          heightCm: 165,
          weightKg: 58,
          risk: 'MEDIUM',
          kcal: 2000,
          proteinG: 75,
          text: 'Recovering pneumonia, lost 3 kg: high-protein diet for 4 weeks after discharge.',
        },
      ],
    ];
    let n = 0;
    for (const [name, body] of notes) {
      if (!bySurname[name]) continue;
      ok(await kitchen.post(`/diet/notes/${bySurname[name]._id}`).send(body), 201);
      n++;
    }
    // Doctor orders therapeutic diets for the new stays.
    for (const [name, body] of [
      ['Vikram', { diet: 'DIABETIC', special: 'No sugar in tea', attendantMeals: true }],
      ['Anita', { diet: 'SOFT', special: 'Low fat' }],
    ])
      if (bySurname[name]) {
        const r = await doc.put(`/diet/orders/${bySurname[name]._id}`).send(body);
        if (r.status !== 200) out.push(`diet order ${name}: ${r.status} ${r.body?.error?.code}`);
      }
    out.push(`${n} dietitian notes`);
  } else out.push('notes skipped');

  if (!(await count(h, 'DietTray', { status: 'DELIVERED' }))) {
    const today = istDay(0);
    let trays = 0;
    if (!(await count(h, 'DietTray')))
      for (const meal of ['BREAKFAST', 'LUNCH', 'DINNER']) {
        const r = ok(await kitchen.post('/diet/production/prepare').send({ date: today, meal }));
        trays += r.items.length;
      }
    // Breakfast and lunch delivered ward by ward; one lunch tray missed.
    const lunch = ok(await kitchen.get(`/diet/trays?date=${today}&meal=LUNCH`)).items;
    if (!lunch.some((t) => t.status === 'MISSED')) {
      const missed = lunch.find((t) => t.status === 'PREPARED');
      if (missed)
        ok(
          await nurse
            .post(`/diet/trays/${missed.id}/missed`)
            .send({ reason: 'Patient away for CT scan' }),
        );
    }
    let delivered = 0;
    for (const meal of ['BREAKFAST', 'LUNCH']) {
      const rows = ok(await kitchen.get(`/diet/trays?date=${today}&meal=${meal}`)).items;
      for (const ward of [...new Set(rows.map((t) => t.ward).filter(Boolean))])
        delivered += ok(
          await nurse.post('/diet/trays/deliver').send({ date: today, meal, ward }),
        ).delivered;
    }
    out.push(`${trays} trays prepared, ${delivered} delivered, 1 missed`);
  } else out.push('trays skipped');
  return out.join(', ');
}

const FOOD = [
  { code: 'RICE', name: 'Rice, sona masoori', unit: 'kg', gstRate: 0, cost: 5200, qty: 100 },
  { code: 'ATTA', name: 'Wheat atta', unit: 'kg', gstRate: 0, cost: 3800, qty: 80 },
  { code: 'TOORDAL', name: 'Toor dal', unit: 'kg', gstRate: 0, cost: 14500, qty: 40 },
  { code: 'MILK', name: 'Milk, toned', unit: 'litre', gstRate: 0, cost: 5600, qty: 60 },
  { code: 'OIL', name: 'Sunflower oil', unit: 'litre', gstRate: 5, cost: 14000, qty: 30 },
  { code: 'VEG', name: 'Seasonal vegetables', unit: 'kg', gstRate: 0, cost: 4000, qty: 60 },
];

async function kitchenStock(h) {
  if (await count(h, 'KitchenConsumption')) return 'skipped';
  const store = await h.as('store');
  const admin = await h.as('admin');
  const kitchen = await h.as('kitchen');
  let s = await storeIds(h);
  if (!s.KIT) {
    let r = await store
      .post('/inventory/stores')
      .send({ code: 'KIT', name: 'Kitchen store', kind: 'KITCHEN' });
    if (r.status === 403)
      r = await admin
        .post('/inventory/stores')
        .send({ code: 'KIT', name: 'Kitchen store', kind: 'KITCHEN' });
    ok(r, 201);
    s = await storeIds(h);
  }
  let items = await itemIds(h);
  for (const f of FOOD)
    if (!items[f.code])
      ok(
        await store.post('/inventory/items').send({
          code: f.code,
          name: f.name,
          kind: 'FOOD',
          unit: f.unit,
          gstRate: f.gstRate,
          reorderLevel: 10,
        }),
        201,
      );
  items = await itemIds(h);
  const vendor = (await read(h, 'Vendor'))[0];
  const kitStock = ok(await kitchen.get('/diet/kitchen/stock'));
  if (!kitStock.value) {
    // Bought into the main store, then issued to the kitchen.
    ok(
      await store.post('/inventory/grns').send({
        vendorId: String(vendor._id),
        storeId: s.MAIN,
        invoiceNo: `KIT-${istDay(0)}`,
        invoiceDate: istDay(-1),
        lines: FOOD.map((f) => ({
          itemId: items[f.code],
          batchNo: `F${istDay(0).replaceAll('-', '').slice(2)}`,
          expiry: ym(f.code === 'MILK' || f.code === 'VEG' ? 1 : 9),
          qty: f.qty,
          rate: f.cost,
          mrp: f.cost,
        })),
      }),
      201,
    );
    ok(
      await store.post('/inventory/transfers').send({
        fromStoreId: s.MAIN,
        toStoreId: s.KIT,
        lines: FOOD.map((f) => ({ itemId: items[f.code], qty: Math.round(f.qty * 0.6) })),
      }),
      201,
    );
  }
  const use = [
    [
      istDay(-1),
      'DINNER',
      [
        ['RICE', 6],
        ['TOORDAL', 1.5],
        ['VEG', 4],
        ['OIL', 0.8],
      ],
    ],
    [
      istDay(0),
      'BREAKFAST',
      [
        ['MILK', 8],
        ['ATTA', 3],
        ['OIL', 0.5],
      ],
    ],
    [
      istDay(0),
      'LUNCH',
      [
        ['RICE', 7],
        ['TOORDAL', 2],
        ['VEG', 5],
        ['ATTA', 4],
        ['OIL', 1],
      ],
    ],
  ];
  for (const [date, meal, lines] of use)
    ok(
      await kitchen.post('/diet/kitchen/consumption').send({
        date,
        meal,
        lines: lines.map(([c, qty]) => ({ itemId: items[c], qty })),
      }),
      201,
    );
  return `kitchen store with ${FOOD.length} food items, ${use.length} consumption entries`;
}

async function deathAndRegister(h) {
  if (await count(h, 'DeathRecord')) return 'skipped';
  const bm = await h.as('billingmgr');
  const mrd = await h.as('mrd');
  const a = await stayOf(h, 'Prakash', 'Joshi');
  if (!a) throw new Error('the Joshi stay is missing');
  const diedAt = new Date(Date.now() - 40 * MIN).toISOString();
  if (a.status !== 'DISCHARGED')
    ok(
      await bm.post(`/ipd/admissions/${a._id}/discharge`).send({
        outcome: 'DEATH',
        death: { at: diedAt, cause: 'Brain-stem infarction with aspiration pneumonia' },
      }),
    );
  await h.deliver(); // discharged → MRD record
  const d = ok(
    await mrd.post('/mrd/deaths').send({
      patientId: String(a.patient.id),
      admissionId: String(a._id),
      diedAt,
      cause: {
        immediate: 'Aspiration pneumonia',
        antecedent: 'Brain-stem infarction',
        underlying: 'Hypertension',
        icd: 'I63.9',
      },
      mccdNo: `MCCD-${istDay(0).replaceAll('-', '')}-01`,
      certifiedBy: 'Dr. Meera Iyer',
      mortuarySlot: 'M-1',
    }),
    201,
  );
  ok(
    await mrd
      .post(`/mrd/deaths/${d.id}/handover`)
      .send({ handedTo: 'Rohan Joshi', relation: 'Son', idProof: 'Aadhaar XXXX-4471' }),
  );
  return `death registered (${d.regNo}), body handed to family`;
}

async function releases(h) {
  if (await count(h, 'ReleaseRequest')) return 'skipped';
  const mrd = await h.as('mrd');
  const recs = ok(await mrd.get('/mrd/records')).items;
  const pick = (name) =>
    recs.find(
      (r) => (r.patient?.name ?? r.patient) === name || r.patient?.name?.startsWith?.(name),
    );
  const plan = [
    [
      'Myra Khan',
      {
        kind: 'INSURER',
        name: 'Star Health',
        idProof: 'Letter SH/CL/88120',
        authorisation: 'Patient consent form signed',
      },
      'Reimbursement claim',
      18,
      'release',
    ],
    [
      'Neeta Shah',
      { kind: 'PATIENT', name: 'Neeta Shah', idProof: 'Aadhaar XXXX-2290', authorisation: 'Self' },
      'Second opinion at another hospital',
      9,
      'approve',
    ],
    [
      'Suresh Patil',
      {
        kind: 'COURT',
        name: 'Consumer Forum, Pune',
        idProof: 'Summons 114/2026',
        authorisation: 'Court order dated 05-10-2026',
      },
      'Consumer complaint hearing',
      24,
      'pending',
    ],
  ];
  const out = [];
  for (const [name, requester, purpose, pages, stage] of plan) {
    const r = pick(name);
    if (!r) continue;
    const q = ok(
      await mrd.post('/mrd/releases').send({ recordId: r.id, requester, purpose, pages }),
      201,
      202,
    );
    if (stage !== 'pending' && q.approvalId) await h.approve('medsupt', q.approvalId);
    if (stage === 'release') ok(await mrd.post(`/mrd/releases/${q.id}/release`));
    out.push(`${name}: ${stage}`);
  }
  return `${out.length} release requests (${out.join('; ')})`;
}

async function legalHoldAndDestruction(h) {
  const mrd = await h.as('mrd');
  const out = [];
  const recs = ok(await mrd.get('/mrd/records')).items;
  const held = await count(h, 'MrdRecord', { 'legalHold.on': true });
  if (!held) {
    const r = recs.find((x) => (x.patient?.name ?? x.patient) === 'Suresh Patil') ?? recs[0];
    ok(
      await mrd
        .put(`/mrd/records/${r.id}/legal-hold`)
        .send({ on: true, reason: 'Consumer Forum complaint 114/2026: preserve the file' }),
    );
    out.push(`legal hold on ${r.ipNo}`);
  } else out.push('legal hold skipped');
  if (await count(h, 'MrdDestruction')) return [...out, 'destruction skipped'].join(', ');
  const due = ok(await mrd.get('/mrd/retention-due')).items.filter((r) => !r.blockedBy);
  if (!due.length) {
    out.push(
      'no destruction batch: no record is past its retention date (needs a 10-year-old discharge)',
    );
    return out.join(', ');
  }
  const b = ok(
    await mrd.post('/mrd/destructions').send({
      recordIds: due.slice(0, 3).map((r) => r.id),
      method: 'SHREDDING',
      reason: 'Retention period over',
    }),
    202,
  );
  await h.approve('medsupt', b.approvalId);
  out.push(
    `destruction ${b.batchNo} proposed (Medical Superintendent approved, Super Admin pending)`,
  );
  return out.join(', ');
}

export const sections = [
  ['ipd: new stays (2 insured, 1 ICU)', newAdmissions],
  ['nursing: vitals and intake-output', vitalsAndIo],
  ['ipd: medicine orders and MAR', medicineOrdersAndMar],
  ['nursing: drug round on the MAR', marRound],
  ['pharmacy: ward issues and returns', wardIssuesAndReturns],
  ['pharmacy: counter sales', counterSale],
  ['ipd: cashless pre-authorisation', preAuths],
  ['inventory: indents', indents],
  ['inventory: purchase requisitions', requisitions],
  ['inventory: count adjustments', adjustments],
  ['lab: QC, EQAS, maintenance, partners, media', labRegisters],
  ['lab: send-outs to a partner lab', sendOuts],
  ['diet: dietitian notes and trays', dietNotesAndTrays],
  ['diet: kitchen store and consumption', kitchenStock],
  ['mrd: death and the death register', deathAndRegister],
  ['mrd: release of information', releases],
  ['mrd: legal hold and destruction', legalHoldAndDestruction],
];
