/**
 * Flow seeds, area "people": HR, payroll, finance (sub-ledgers and treasury), support services
 * (housekeeping, linen, equipment PM, biomedical waste, infection control, referral statements)
 * and the reports centre. Every section checks first and skips once its data exists.
 */
import { istDay, istMonth, ok } from './harness.js';

const DAY = 86_400_000;
const shiftDay = (d, n) =>
  new Date(new Date(`${d}T12:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const lastDayOf = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
};
const fyOf = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const start = mo >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const FY = fyOf(istMonth(0));
const FY_START = Number(FY.slice(0, 4));

async function model(h, path, name) {
  const mod = await import(path);
  return h.system(() => mod[name]);
}
const count = (h, path, name, filter = {}) =>
  h.system(async () => (await import(path))[name].countDocuments(filter).exec());

const employeesByNo = async (h) => {
  const hr = await h.as('hr');
  const items = ok(await hr.get('/hr/employees?limit=100')).items;
  return Object.fromEntries(items.map((e) => [e.empNo, e]));
};
const accountsByCode = async (h) => {
  const acc = await h.as('accounts');
  const items = ok(await acc.get('/finance/accounts')).items;
  return Object.fromEntries(items.map((a) => [a.code, a]));
};

// ===================================================================== HR

async function designations(h) {
  const admin = await h.as('admin');
  if (ok(await admin.get('/masters/designations')).total > 0) return 'skipped';
  const rows = [
    ['HRM', 'HR Manager', 'M2'],
    ['PAYOFF', 'Payroll Officer', 'E2'],
    ['FINCTRL', 'Finance Controller', 'M2'],
    ['NIC', 'Nursing In-charge', 'M1'],
    ['SN', 'Staff Nurse', 'E1'],
    ['WA', 'Ward Attendant', 'S1'],
    ['CASHIER', 'Cashier', 'S2'],
    ['FOE', 'Front Office Executive', 'S2'],
    ['LABTECH', 'Lab Technician', 'E1'],
    ['PHARM', 'Pharmacist', 'E1'],
    ['STOREKPR', 'Store Keeper', 'S2'],
    ['RMO', 'Resident Medical Officer', 'M1'],
  ];
  for (const [code, name, grade] of rows)
    ok(await admin.post('/masters/designations').send({ code, name, grade }));
  return `${rows.length} designations`;
}

async function holidays(h) {
  const admin = await h.as('admin');
  if (ok(await admin.get('/masters/holidays')).total > 0) return 'skipped';
  const y = FY_START; // calendar year of the current financial year start
  const rows = [
    [`REPUB${y}`, 'Republic Day', `${y}-01-26`],
    [`HOLI${y}`, 'Holi', `${y}-03-04`],
    [`GOODFRI${y}`, 'Good Friday', `${y}-04-03`],
    [`MHDAY${y}`, 'Maharashtra Day', `${y}-05-01`],
    [`INDEP${y}`, 'Independence Day', `${y}-08-15`],
    [`GANESH${y}`, 'Ganesh Chaturthi', `${y}-09-14`],
    [`GANDHI${y}`, 'Gandhi Jayanti', `${y}-10-02`],
    [`DASARA${y}`, 'Dussehra', `${y}-10-20`],
    [`DIWALI${y}`, 'Diwali (Lakshmi Puja)', `${y}-11-08`],
    [`XMAS${y}`, 'Christmas', `${y}-12-25`],
  ];
  for (const [code, name, date] of rows)
    ok(await admin.post('/masters/holidays').send({ code, name, date, branchCodes: [] }));
  return `${rows.length} holidays for ${y}`;
}

async function recruitment(h) {
  const hr = await h.as('hr');
  if (ok(await hr.get('/hr/openings')).items.length) return 'skipped';
  const depts = Object.fromEntries(
    ok(await hr.get('/departments')).items.map((d) => [d.code, d.id]),
  );
  const openings = [
    {
      body: {
        title: 'Staff Nurse (ICU)',
        positions: 3,
        type: 'PERMANENT',
        description: 'GNM/B.Sc nursing, 2+ years ICU experience, BLS certified.',
      },
      candidates: [
        ['Priya Menon', '9876501231', 'Referral', 4, ['SCREENED', 'INTERVIEW', 'OFFERED']],
        ['Sneha Kadam', '9876501232', 'Naukri', 3, ['SCREENED', 'INTERVIEW']],
        ['Ritu Sharma', '9876501233', 'Walk-in', 1, ['SCREENED']],
        ['Deepa Nair', '9876501234', 'Naukri', 2, ['REJECTED']],
      ],
    },
    {
      body: {
        title: 'Lab Technician',
        positions: 1,
        type: 'PERMANENT',
        departmentId: depts.GMED,
        description: 'DMLT/B.Sc MLT; night shifts on rotation.',
      },
      candidates: [
        ['Arjun Pawar', '9876501235', 'Employee referral', 3, ['SCREENED', 'INTERVIEW']],
        ['Nikhil Deshmukh', '9876501236', 'Campus', 0, []],
      ],
    },
    {
      body: {
        title: 'Front Office Executive',
        positions: 1,
        type: 'CONTRACT',
        description: 'Registration and billing desk, Marathi and Hindi.',
      },
      candidates: [['Komal Jadhav', '9876501237', 'Walk-in', 1, ['SCREENED']]],
    },
    {
      body: {
        title: 'Resident Medical Officer',
        positions: 2,
        type: 'CONSULTANT',
        departmentId: depts.GMED,
        description: 'MBBS with MMC registration; ward and casualty cover.',
      },
      candidates: [['Dr. Aditya Kulkarni', '9876501238', 'Website', 2, ['SCREENED', 'INTERVIEW']]],
    },
  ];
  let n = 0;
  for (const o of openings) {
    const op = ok(await hr.post('/hr/openings').send(o.body));
    for (const [name, mobile, source, exp, stages] of o.candidates) {
      let c = ok(
        await hr
          .post(`/hr/openings/${op.id}/candidates`)
          .send({ name, mobile, source, experienceYears: exp }),
      );
      n += 1;
      for (const stage of stages) {
        const step = { version: c.version, stage };
        if (stage === 'INTERVIEW')
          step.interview = { rating: exp >= 3 ? 4 : 3, notes: 'Panel: Nursing in-charge, HR' };
        if (stage === 'OFFERED') step.offer = { ctc: 4_20_000_00, joinOn: istDay(20) };
        if (stage === 'REJECTED') step.note = 'Did not clear the clinical skills test';
        c = ok(await hr.post(`/hr/candidates/${c.id}/move`).send(step));
      }
    }
  }
  return `${openings.length} openings, ${n} candidates`;
}

async function training(h) {
  const hr = await h.as('hr');
  if (ok(await hr.get('/hr/training')).items?.length) return 'skipped';
  const e = await employeesByNo(h);
  const all = Object.values(e).map((x) => x.id);
  const nursing = ['EMP00004', 'EMP00005', 'EMP00006'].map((n) => e[n].id);
  const sessions = [
    {
      body: {
        title: 'BLS refresher',
        topic: 'BLS',
        date: `${FY_START}-08-20`,
        hours: 4,
        trainer: 'Dr. R. Menon',
        employeeIds: [...nursing, e.EMP00009.id],
      },
      absent: [e.EMP00009.id],
    },
    {
      body: {
        title: 'Fire safety and evacuation drill',
        topic: 'FIRE',
        date: `${FY_START}-09-18`,
        hours: 2,
        trainer: 'Pune Fire Brigade',
        employeeIds: all,
      },
      absent: [e.EMP00007.id, e.EMP00011.id],
    },
    {
      body: {
        title: 'Biomedical waste segregation',
        topic: 'BMW',
        date: istDay(-4),
        hours: 1.5,
        trainer: 'Infection control nurse',
        employeeIds: [...nursing, e.EMP00009.id, e.EMP00011.id],
      },
      absent: [],
    },
    {
      body: {
        title: 'Hand hygiene and infection control',
        topic: 'INFECTION',
        date: istDay(10),
        hours: 2,
        trainer: 'Infection control committee',
        employeeIds: [...nursing, e.EMP00008.id],
      },
      upcoming: true,
    },
  ];
  for (const s of sessions) {
    const made = ok(await hr.post('/hr/training').send(s.body));
    if (s.upcoming) continue;
    ok(
      await hr.put(`/hr/training/${made.id}/attendance`).send({
        version: made.version,
        attendees: s.body.employeeIds.map((id, i) =>
          s.absent.includes(id)
            ? { employeeId: id, attended: false }
            : { employeeId: id, attended: true, score: 70 + ((i * 7) % 30) },
        ),
      }),
    );
  }
  return `${sessions.length} sessions`;
}

async function appraisals(h) {
  const hr = await h.as('hr');
  if (ok(await hr.get('/hr/appraisal-cycles')).items?.length) return 'skipped';
  const cyc = ok(
    await hr.post('/hr/appraisal-cycles').send({
      name: `FY ${FY} mid-year`,
      from: `${FY_START}-04-01`,
      to: `${FY_START}-09-30`,
      goals: [
        { title: 'Patient care and safety', weight: 40 },
        { title: 'Attendance and punctuality', weight: 20 },
        { title: 'Teamwork', weight: 20 },
        { title: 'Training and learning', weight: 20 },
      ],
    }),
  );
  const notes = [];
  // Self reviews by the staff who have a login.
  const self = {
    employee: [[4, 4, 3, 3], 'Covered night shifts during the dengue surge'],
    wardincharge: [[4, 5, 4, 4], 'Ran the general ward at 95% occupancy without incidents'],
    accounts: [[4, 4, 4, 3], 'Closed the books for Q1 on time'],
    payroll: [[3, 4, 4, 3], 'Moved payroll to the new statutory rates'],
  };
  for (const [u, [ratings, comments]] of Object.entries(self)) {
    const c = await h.as(u);
    const mine = ok(await c.get('/me/appraisal')).appraisal;
    if (!mine) continue;
    ok(
      await c
        .post(`/me/appraisal/${mine.id}/self`)
        .send({ version: mine.version, ratings, comments }),
    );
    notes.push(u);
  }
  // Managers review their teams: Rekha (ward in-charge) reviews Sunil; Meera (HR) reviews Rekha and Kavita.
  for (const [mgr, ratings] of [
    ['wardincharge', [4, 4, 4, 3]],
    ['hr', [4, 4, 4, 4]],
  ]) {
    const c = await h.as(mgr);
    const team = ok(await c.get('/me/appraisal')).team ?? [];
    for (const a of team.filter((x) => x.status === 'MANAGER'))
      ok(
        await c
          .post(`/me/appraisal/${a.id}/manager`)
          .send({ version: a.version, ratings, comments: 'Meets expectations' }),
      );
  }
  // HR closes the one that is ready.
  const list = ok(await hr.get(`/hr/appraisal-cycles/${cyc.id}/appraisals`)).items;
  const ready = list.filter((a) => a.status === 'HR');
  if (ready[0])
    ok(
      await hr
        .post(`/hr/appraisals/${ready[0].id}/final`)
        .send({ version: ready[0].version, finalRating: 4 }),
    );
  return `cycle with ${list.length} appraisals; self: ${notes.join(', ')}; ${ready.length} at HR, 1 final`;
}

async function shiftSwaps(h) {
  const hr = await h.as('hr');
  const any = await count(h, '../../src/modules/hr/models/hr.models.js', 'ShiftSwap');
  if (any) return 'skipped';
  const e = await employeesByNo(h);
  const RosterCell = await model(h, '../../src/modules/hr/models/hr.models.js', 'RosterCell');
  const cells = await h.system(() =>
    RosterCell.find({ date: { $gt: istDay(0) } })
      .sort({ date: 1 })
      .lean()
      .exec(),
  );
  const cell = (empNo, pred) =>
    cells.find((c) => String(c.employeeId) === e[empNo].id && c.shift !== 'OFF' && pred(c));
  const emp = await h.as('employee'); // Sunil Gaikwad, ward attendant
  const made = [];
  // Sunil asks to swap with Anita on a day both are rostered, then with Rekha.
  const a = cell('EMP00006', (c) => cell('EMP00005', (x) => x.date === c.date));
  const b = cell('EMP00006', (c) => c.date !== a?.date);
  if (a)
    made.push(
      ok(
        await emp.post('/hr/swaps').send({
          unit: a.unit,
          date: a.date,
          fromId: e.EMP00006.id,
          toId: e.EMP00005.id,
          reason: 'Family function in the evening',
        }),
      ),
    );
  if (b)
    made.push(
      ok(
        await emp.post('/hr/swaps').send({
          unit: b.unit,
          date: b.date,
          fromId: e.EMP00006.id,
          toId: e.EMP00004.id,
          reason: 'Doctor appointment',
        }),
      ),
    );
  // Anita's swap with Rekha, raised by the ward in-charge on her behalf.
  const c3 = cell('EMP00005', (c) => c.date !== a?.date);
  const wi = await h.as('wardincharge');
  if (c3)
    made.push(
      ok(
        await wi.post('/hr/swaps').send({
          unit: c3.unit,
          date: c3.date,
          fromId: e.EMP00005.id,
          toId: e.EMP00004.id,
          reason: 'Exam for B.Sc nursing bridge course',
        }),
      ),
    );
  if (made[0]) ok(await hr.post(`/hr/swaps/${made[0].id}/decision`).send({ approve: true }));
  if (made[2]) ok(await hr.post(`/hr/swaps/${made[2].id}/decision`).send({ approve: false }));
  return `${made.length} swaps (1 approved, 1 rejected, rest pending)`;
}

// ===================================================================== payroll

async function payrollSettings(h) {
  const pay = await h.as('payroll');
  const s = ok(await pay.get('/payroll/settings'));
  if (s.deductor?.tan) return 'skipped';
  const r = ok(
    await pay.put('/payroll/settings').send({
      deductor: {
        name: 'Demo Hospital',
        tan: 'PNED12345F',
        pan: 'AABCD1234E',
        address: 'Survey No. 21, Baner Road, Pune 411045',
        responsibleName: 'Kavita Joshi',
        responsibleDesignation: 'Finance Controller',
      },
    }),
  );
  return `deductor TAN ${r.deductor.tan}`;
}

async function taxDeclarations(h) {
  const pay = await h.as('payroll');
  if (ok(await pay.get('/payroll/tax-declarations')).items.length) return 'skipped';
  const decl = {
    employee: { regime: 'NEW' },
    accounts: { regime: 'OLD', rentMonthly: 18000, deductions80C: 150000, deductions80D: 25000 },
    hr: { regime: 'OLD', rentMonthly: 15000, deductions80C: 120000, deductions80D: 18000 },
    wardincharge: { regime: 'OLD', rentMonthly: 9000, deductions80C: 80000, deductions80D: 12000 },
    payroll: { regime: 'OLD', rentMonthly: 10000, deductions80C: 60000, deductions80D: 0 },
  };
  for (const [u, body] of Object.entries(decl)) {
    const c = await h.as(u);
    ok(await c.put('/me/tax-declaration').send(body));
  }
  // Payroll verifies everyone else's; its own waits (a maker should not check their own).
  const me = (await h.as('payroll')).user;
  const list = ok(await pay.get('/payroll/tax-declarations')).items;
  let verified = 0;
  for (const d of list) {
    if (d.employee?.name === me?.name || d.employee?.empNo === 'EMP00002') continue;
    ok(
      await pay
        .post(`/payroll/tax-declarations/${d.id}/review`)
        .send({ version: d.version, outcome: 'VERIFIED', note: 'Proofs seen' }),
    );
    verified += 1;
  }
  return `${list.length} declarations, ${verified} verified`;
}

/** Last month's run was left CALCULATED: recalculate with the declarations and release it. */
async function payrollRelease(h) {
  const pay = await h.as('payroll');
  const runs = ok(await pay.get('/payroll/runs')).items;
  const run = runs.find((r) => r.month === istMonth(-1));
  if (!run) return 'no run for last month';
  if (run.status === 'LOCKED') return 'skipped';
  if (['DRAFT', 'CALCULATED', 'RETURNED'].includes(run.status))
    ok(await pay.post(`/payroll/runs/${run.id}/calculate`));
  const sub = ok(await pay.post(`/payroll/runs/${run.id}/submit`), 202);
  await h.approve('hr', sub.approvalId, 'Attendance and LOP checked');
  await h.approve('accounts', sub.approvalId, 'Funds available');
  const locked = ok(await pay.get(`/payroll/runs/${run.id}`));
  return `${run.month} ${locked.status}, net ₹${locked.totals.net / 100}, TDS ₹${locked.totals.tds / 100}`;
}

async function tdsChallans(h) {
  const pay = await h.as('payroll');
  const year = ok(await pay.get(`/payroll/tds?fy=${FY}`));
  const due = year.months.filter((m) => m.locked && m.tds > 0);
  const todo = due.filter((m) => !m.challan);
  if (!todo.length) return due.length ? 'skipped' : 'no locked month has TDS';
  let serial = 41 + due.length - todo.length;
  for (const m of todo) {
    const depositedOn = shiftDay(m.due, -2) < istDay(0) ? shiftDay(m.due, -2) : istDay(0);
    ok(
      await pay.post('/payroll/tds/challans').send({
        month: m.month,
        bsrCode: '0510308',
        challanSerial: String(serial++).padStart(5, '0'),
        depositedOn,
        amount: m.tds,
      }),
    );
  }
  return `${todo.length} challans (${todo.map((m) => m.month).join(', ')})`;
}

async function bonus(h) {
  const pay = await h.as('payroll');
  if (ok(await pay.get('/payroll/bonus')).items.some((b) => b.fy === FY)) return 'skipped';
  const b = ok(await pay.post('/payroll/bonus').send({ fy: FY, percent: 8.33 }));
  return `draft for ${FY}: ${b.lines?.length ?? 0} eligible, ₹${(b.total ?? 0) / 100}`;
}

// ===================================================================== finance

async function budgets(h) {
  const acc = await h.as('accounts');
  const b0 = ok(await acc.get(`/finance/budgets?fy=${FY}`));
  if (b0.items.some((r) => (r.budgetTotal ?? 0) > 0)) return 'skipped';
  const annual = {
    4000: 72_00_000_00,
    4010: 1_80_00_000_00,
    4020: 48_00_000_00,
    4030: 36_00_000_00,
    4040: 90_00_000_00,
    5000: 48_00_000_00,
    5010: 5_00_000_00,
    5100: 30_00_000_00,
    5500: 24_00_000_00,
    5510: 18_00_000_00,
    5520: 6_00_000_00,
  };
  let n = 0;
  for (const [code, amt] of Object.entries(annual)) {
    const row = b0.items.find((r) => r.code === code);
    if (!row) continue;
    ok(
      await acc
        .put('/finance/budgets')
        .send({ fy: b0.fy ?? FY, accountId: row.accountId, annual: amt }),
    );
    n += 1;
  }
  return `${n} ledgers budgeted for ${b0.fy ?? FY}`;
}

async function pettyCash(h) {
  const acc = await h.as('accounts');
  const book = ok(await acc.get(`/finance/petty-cash?from=${istDay(-30)}`));
  if (book.items.length) return 'skipped';
  const a = await accountsByCode(h);
  ok(
    await acc
      .post('/finance/petty-cash')
      .send({ kind: 'TOPUP', date: istDay(-6), amount: 15_000_00, note: 'Float for October' }),
  );
  const spends = [
    [istDay(-5), 450_00, '5500', 'Shree Tea Stall', 'Tea for NABH audit team', 'TS-118'],
    [istDay(-4), 180_00, '5500', 'Blue Dart', 'Courier: TPA claim documents', 'BD-55102'],
    [
      istDay(-3),
      1_250_00,
      '5500',
      'Saraswati Stationers',
      'Registers and files for MRD',
      'SS-2231',
    ],
    [istDay(-2), 640_00, '5520', 'Om Electricals', 'Tube lights for OPD corridor', 'OE-77'],
    [istDay(-1), 3_200_00, '5520', 'Sai Plumbing Works', 'OT scrub area drain cleared', 'SP-310'],
  ];
  let pending = 0;
  for (const [date, amount, code, payee, note, billRef] of spends) {
    const r = await acc
      .post('/finance/petty-cash')
      .send({ kind: 'EXPENSE', date, amount, accountId: a[code].id, payee, note, billRef });
    const body = ok(r, 201, 202);
    if (r.status === 202) {
      pending += 1;
      await h.approve('hod', body.approvalId, 'Urgent OT repair, approved');
    }
  }
  return `1 top-up, ${spends.length} expenses (${pending} approved by HOD)`;
}

async function vendorPayments(h) {
  const acc = await h.as('accounts');
  if (ok(await acc.get('/finance/vendor-payments')).items.length) return 'skipped';
  const pay = ok(await acc.get('/finance/payables'));
  const v = pay.items[0];
  if (!v) return 'no payables';
  const grn = v.grns[0];
  const first = Math.min(75_000_00, grn.due);
  ok(
    await acc.post('/finance/vendor-payments').send({
      vendorId: v.vendorId,
      amount: first,
      mode: 'BANK_TRANSFER',
      reference: 'NEFT HDFCN26285541',
    }),
  );
  let n = 1;
  const rest = grn.due - first;
  if (rest > 0) {
    ok(
      await acc.post('/finance/vendor-payments').send({
        vendorId: v.vendorId,
        amount: rest,
        mode: 'CHEQUE',
        reference: 'CHQ 100245',
      }),
    );
    n += 1;
  }
  return `${n} payments to ${v.vendorName} for ${grn.grnNo}`;
}

async function doctorShares(h) {
  const acc = await h.as('accounts');
  if (ok(await acc.get('/finance/doctor-shares')).items.length) return 'skipped';
  const Doctor = await model(h, '../../src/modules/setup/models/masters.models.js', 'Doctor');
  const docs = await h.system(() =>
    Doctor.find({ userId: { $exists: true } })
      .lean()
      .exec(),
  );
  const plans = [
    { CONSULTATION: 70, PROCEDURE: 40 },
    { CONSULTATION: 60, PROCEDURE: 35, IPD: 20 },
  ];
  let n = 0;
  for (const [i, d] of docs.entries()) {
    const r = await acc
      .put('/finance/doctor-shares')
      .send({ userId: String(d.userId), shares: plans[i % plans.length], tdsPercent: 10 });
    if (r.status === 422 && plans[i % plans.length].IPD) {
      ok(
        await acc.put('/finance/doctor-shares').send({
          userId: String(d.userId),
          shares: { CONSULTATION: 60, PROCEDURE: 35 },
          tdsPercent: 10,
        }),
      );
    } else ok(r);
    n += 1;
  }
  return `${n} doctors (${docs.map((d) => d.name).join(', ')})`;
}

async function doctorPayouts(h) {
  const acc = await h.as('accounts');
  const months = [istMonth(-1), istMonth(0)];
  for (const m of months)
    if (ok(await acc.get(`/finance/doctor-payouts?month=${m}`)).items.length) return 'skipped';
  const out = [];
  for (const m of months) {
    const d = ok(await acc.post('/finance/doctor-payouts/draft').send({ month: m }));
    out.push(...d.items.map((p) => ({ ...p, month: m })));
  }
  if (!out.length) return 'no finalised doctor bills yet: nothing to draft';
  // Pay last month's; this month's stays a draft.
  let paid = 0;
  for (const p of out.filter((x) => x.month === istMonth(-1) && x.gross > 0)) {
    ok(
      await acc
        .post(`/finance/doctor-payouts/${p.id}/pay`)
        .send({ version: p.version, mode: 'BANK_TRANSFER', reference: `NEFT DRPAY${paid + 1}` }),
    );
    paid += 1;
  }
  return `${out.length} payouts drafted, ${paid} paid`;
}

async function fixedAssets(h) {
  const acc = await h.as('accounts');
  if (ok(await acc.get('/finance/assets')).items.length) return 'skipped';
  const eq = Object.fromEntries(
    ok(await acc.get('/finance/assets/equipment')).items.map((e) => [e.code, e.id]),
  );
  const y = FY_START;
  const assets = [
    {
      code: 'FA-BLDG-01',
      name: 'Hospital building, Baner',
      block: 'BUILDING',
      putToUseOn: '2019-04-01',
      cost: 4_50_00_000_00,
      fundedFrom: 'EXISTING',
      // SLM over 60 years, 5% salvage: ₹59,375 a month for 84 months to March 2026
      openingAccumulated: 49_87_500_00,
      depreciatedThrough: `${y}-03`,
    },
    {
      code: 'FA-AMB-01',
      name: 'Ambulance MH12 QW 4521 (Force Traveller)',
      block: 'VEHICLES',
      putToUseOn: `${y - 3}-10-01`,
      cost: 18_00_000_00,
      method: 'WDV',
      fundedFrom: 'EXISTING',
      openingAccumulated: 5_74_000_00,
      depreciatedThrough: `${y}-03`,
    },
    {
      code: 'FA-MON-03',
      name: 'Multipara monitor (ICU)',
      block: 'MEDICAL_EQUIPMENT',
      equipmentId: eq['MON-03'],
      department: 'ICU',
      putToUseOn: `${y - 2}-04-01`,
      cost: 3_20_000_00,
      fundedFrom: 'EXISTING',
      // SLM over 13 years, 5% salvage: ₹1,948.72 a month for 24 months
      openingAccumulated: 46_769_00,
      depreciatedThrough: `${y}-03`,
    },
    {
      code: 'FA-VENT-01',
      name: 'Ventilator (Hamilton C3)',
      block: 'MEDICAL_EQUIPMENT',
      equipmentId: eq['VENT-01'],
      department: 'ICU',
      putToUseOn: `${y}-07-15`,
      cost: 9_50_000_00,
    },
    {
      code: 'FA-AC-ICU',
      name: 'ICU air conditioner (11 TR ductable)',
      block: 'ELECTRICAL',
      equipmentId: eq['AC-ICU-1'],
      department: 'ICU',
      putToUseOn: `${y}-07-20`,
      cost: 2_40_000_00,
    },
    {
      code: 'FA-IT-01',
      name: 'HMS application server',
      block: 'COMPUTERS',
      putToUseOn: `${y}-08-05`,
      cost: 1_85_000_00,
      method: 'WDV',
    },
  ];
  for (const a of assets) {
    if (a.equipmentId === undefined) delete a.equipmentId;
    ok(await acc.post('/finance/assets').send(a), 201);
  }
  return `${assets.length} assets (${assets.filter((a) => a.equipmentId).length} from equipment)`;
}

async function depreciation(h) {
  const acc = await h.as('accounts');
  const month = istMonth(-1);
  const runs = ok(await acc.get('/finance/assets/depreciation'));
  if ((runs.items ?? runs).some?.((r) => r.month === month)) return 'skipped';
  const r = await acc.post('/finance/assets/depreciation').send({ month });
  if (r.status === 409 && r.body?.error?.code === 'ALREADY_RUN') return 'skipped';
  const b = ok(r);
  return `${month}: ₹${b.total / 100}`;
}

async function bankStatement(h) {
  const acc = await h.as('accounts');
  if (ok(await acc.get('/finance/bank/statement')).items.length) return 'skipped';
  const a = await accountsByCode(h);
  const upto = lastDayOf(istMonth(-1)); // the statement runs to the end of last month
  const rec = ok(await acc.get(`/finance/bank/reconciliation?asOf=${upto}`));
  const book = [
    ...rec.depositsNotCredited.map((x) => ({ ...x, amount: x.amount })),
    ...rec.chequesNotPresented.map((x) => ({ ...x, amount: -x.amount })),
  ].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const lines = [];
  for (const [i, j] of book.entries())
    lines.push({
      date: j.amount < 0 ? (shiftDay(j.date, 1) > upto ? upto : shiftDay(j.date, 1)) : j.date,
      description: (j.amount < 0 ? 'NEFT DR ' : 'NEFT CR ') + j.narration.slice(0, 60),
      ref: `UTR${String(260001 + i)}`,
      amount: j.amount,
    });
  lines.push(
    {
      date: upto,
      description: 'SMS alert and account service charges incl GST',
      ref: '',
      amount: -590_00,
    },
    { date: upto, description: 'Interest on sweep FD credited', ref: 'INT-Q2', amount: 18_420_00 },
  );
  lines.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  let bal = 0;
  for (const l of lines) l.balance = bal += l.amount;
  const imp = ok(await acc.post('/finance/bank/statement').send({ lines }));
  // Book what only the bank knew about.
  const open = ok(await acc.get('/finance/bank/statement?status=UNMATCHED')).items;
  let booked = 0;
  for (const l of open) {
    const acct = l.amount === -590_00 ? a['5500'] : l.amount === 18_420_00 ? a['4090'] : null;
    if (!acct) continue;
    ok(
      await acc.post(`/finance/bank/statement/${l.id}/book`).send({
        version: l.version,
        accountId: acct.id,
        narration: l.amount < 0 ? 'Bank service charges' : 'Interest on sweep deposit',
      }),
    );
    booked += 1;
  }
  return `${imp.added} lines, ${imp.matched} auto-matched, ${booked} booked`;
}

// ===================================================================== support services

async function hkRounds(h) {
  const fac = await h.as('facility');
  const sa = await h.as('superadmin');
  const days = [istDay(-3), istDay(-2), istDay(-1), istDay(0)];
  const nowHm = new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 16);
  let done = 0;
  let verified = 0;
  for (const d of days) {
    const rows = ok(await fac.get(`/facility/hk-tasks?date=${d}`)).items;
    if (d === days[0] && rows.some((r) => r.status !== 'DUE')) return 'skipped';
    for (const [i, r] of rows.entries()) {
      if (r.status !== 'DUE') continue;
      if (d === istDay(0) && r.time > nowHm) continue; // later today: still due
      const items = r.items.map((x) => x.text);
      const short = (i + days.indexOf(d)) % 4 === 3;
      ok(
        await fac.post(`/facility/hk-tasks/${r.id}/done`).send({
          done: short ? items.slice(0, -1) : items,
          remarks: short ? `${items.at(-1)}: pending, supplies short` : undefined,
        }),
      );
      done += 1;
      if (d !== istDay(0)) {
        ok(await sa.post(`/facility/hk-tasks/${r.id}/verify`));
        verified += 1;
      }
    }
  }
  return `${done} rounds done, ${verified} verified`;
}

async function linenCondemn(h) {
  const n = await count(
    h,
    '../../src/modules/facility/models/facility.models.js',
    'LinenCondemnation',
  );
  if (n) return 'skipped';
  const fac = await h.as('facility');
  const rows = [
    { ward: 'General Ward', code: 'BEDSHEET', qty: 3, reason: 'Torn beyond repair', approve: true },
    { ward: 'General Ward', code: 'PILLOW', qty: 2, reason: 'Permanent stains', approve: true },
    { ward: 'ICU', code: 'BEDSHEET', qty: 1, reason: 'Burnt by warming device', approve: false },
  ];
  for (const r of rows) {
    const { approve, ...body } = r;
    const res = ok(await fac.post('/facility/linen/condemn').send(body), 202, 201);
    if (approve && res.approvalId) await h.approve('admin', res.approvalId, 'Write-off approved');
  }
  return `${rows.length} condemnations (2 approved, 1 pending)`;
}

async function pmRecords(h) {
  const n = await count(h, '../../src/modules/facility/models/facility.models.js', 'PmRecord');
  if (n) return 'skipped';
  const fac = await h.as('facility');
  const assets = Object.fromEntries(
    ok(await fac.get('/facility/assets')).items.map((x) => [x.code, x]),
  );
  const plan = [
    ['MON-03', { kind: 'PM', doneOn: istDay(-1), notes: 'Overdue PM done; NIBP cuff replaced' }],
    [
      'MON-03',
      {
        kind: 'CALIBRATION',
        doneOn: istDay(-1),
        vendorVisit: true,
        notes: 'SpO2 and ECG calibrated by Philips service',
      },
    ],
    ['VENT-01', { kind: 'PM', doneOn: istDay(-2), notes: 'Filters changed, O2 sensor checked' }],
    [
      'VENT-01',
      {
        kind: 'CALIBRATION',
        doneOn: istDay(-2),
        vendorVisit: true,
        notes: 'Flow sensor calibration, within limits',
      },
    ],
    ['AC-ICU-1', { kind: 'PM', doneOn: istDay(-3), notes: 'Coil cleaning and gas pressure check' }],
  ];
  let made = 0;
  const skipped = [];
  for (const [code, body] of plan) {
    const a = assets[code];
    if (!a) continue;
    const r = await fac.post(`/facility/assets/${a.id}/pm`).send(body);
    if (r.status === 422) {
      skipped.push(`${code} ${body.kind}`); // no schedule of that kind on this asset
      continue;
    }
    ok(r);
    made += 1;
  }
  return `${made} PM/calibration records${skipped.length ? ` (no schedule: ${skipped.join(', ')})` : ''}`;
}

async function wasteHandovers(h) {
  const n = await count(h, '../../src/modules/facility/models/facility.models.js', 'WasteHandover');
  if (n) return 'skipped';
  const fac = await h.as('facility');
  const days = [istDay(-3), istDay(-2), istDay(-1)];
  const sample = {
    'General Ward': [3.4, 1.6, 0.4, 0.5],
    ICU: [4.2, 2.1, 0.6, 0.3],
    OT: [5.1, 1.2, 0.8, 0.9],
  };
  for (const [i, d] of days.entries()) {
    let day = ok(await fac.get(`/facility/waste?date=${d}`));
    for (const [ward, [y, r, w, b]] of Object.entries(sample))
      if (!day.items.some((x) => x.ward === ward))
        day = ok(
          await fac.post('/facility/waste').send({
            date: d,
            ward,
            yellow: Math.round((y + i * 0.3) * 10) / 10,
            red: Math.round((r + i * 0.1) * 10) / 10,
            white: w,
            blue: b,
          }),
        );
    const t = day.total;
    const weights =
      i === 1
        ? { ...t, yellow: Math.round(t.yellow * 0.7 * 10) / 10 } // the CBWTF weighed less
        : { ...t, yellow: Math.round((t.yellow + 0.1) * 10) / 10 };
    ok(
      await fac.post('/facility/waste/handover').send({
        date: d,
        manifestNo: `PCB-MF-${d.replaceAll('-', '')}`,
        vehicle: 'MH12 KT 4410',
        weights,
      }),
    );
  }
  return `${days.length} handovers (1 mismatch)`;
}

async function haiCases(h) {
  const q = await h.as('quality');
  const n = await count(h, '../../src/modules/quality/models/quality.models.js', 'HaiCase');
  if (n) return 'skipped';
  const cases = [
    {
      type: 'CAUTI',
      ward: 'ICU',
      onsetOn: istDay(-9),
      organism: 'E. coli',
      notes: 'Catheter day 6',
    },
    {
      type: 'VAP',
      ward: 'ICU',
      onsetOn: istDay(-5),
      organism: 'Klebsiella pneumoniae',
      notes: 'Ventilator day 4; bundle compliance reviewed',
    },
    {
      type: 'SSI',
      ward: 'General Ward',
      onsetOn: istDay(-3),
      organism: 'Staphylococcus aureus (MSSA)',
      notes: 'Superficial, post LSCS day 5',
    },
    {
      type: 'CLABSI',
      ward: 'ICU',
      onsetOn: `${istMonth(-1)}-18`,
      organism: 'Candida tropicalis',
      notes: 'Central line day 9; line removed',
    },
  ];
  for (const c of cases) ok(await q.post('/quality/infection/cases').send(c));
  // Device days for the months, so the rates have a denominator.
  for (const [month, d] of [
    [istMonth(-1), { catheter: 310, centralLine: 95, ventilator: 70 }],
    [istMonth(0), { catheter: 120, centralLine: 40, ventilator: 28 }],
  ]) {
    const cur = ok(await q.get(`/quality/infection?month=${month}`));
    if (!(cur.cauti?.deviceDays > 0))
      ok(await q.put('/quality/infection/device-days').send({ month, ward: 'ICU', ...d }));
  }
  return `${cases.length} HAI cases`;
}

async function referralStatements(h) {
  const crm = await h.as('crm');
  const n = await count(h, '../../src/modules/crm/models/crm.models.js', 'ReferralStatement');
  if (n) return 'skipped';
  let made = 0;
  let sent = 0;
  for (const month of [istMonth(-1), istMonth(0)]) {
    const st = ok(await crm.post('/crm/referrals/statements').send({ month })).items;
    made += st.length;
    if (month === istMonth(-1))
      for (const s of st) {
        ok(await crm.post(`/crm/referrals/statements/${s.id}/send`));
        sent += 1;
      }
  }
  return made
    ? `${made} statements (${sent} sent)`
    : 'no referred patient was billed: no statement to make';
}

async function reportsCentre(h) {
  const hr = await h.as('hr');
  if (ok(await hr.get('/reports/exports')).total > 0) return 'skipped';
  const from = `${istMonth(-1)}-01`;
  const to = istDay(0);
  const exportsPlan = [
    ['hr', 'headcount-attrition', 'XLSX', { from, to }],
    ['hr', 'payroll-register', 'XLSX', { from, to }],
    ['payroll', 'statutory-pf-esi', 'PDF', { from, to }],
    ['accounts', 'gst-registers', 'XLSX', { from, to }],
    ['facility', 'equipment-downtime', 'PDF', { from, to }],
    ['quality', 'infection-rates', 'PDF', { from, to }],
  ];
  let ex = 0;
  for (const [u, code, format, filters] of exportsPlan) {
    const c = await h.as(u);
    ok(await c.post(`/reports/${code}/export`).send({ format, filters }), 201);
    ex += 1;
  }
  const schedules = [
    [
      'hr',
      {
        reportCode: 'headcount-attrition',
        frequency: 'WEEKLY',
        dayOfWeek: 1,
        time: '07:30',
        recipients: ['hr@demohospital.example'],
      },
    ],
    [
      'payroll',
      {
        reportCode: 'payroll-register',
        frequency: 'MONTHLY',
        dayOfMonth: 2,
        time: '09:00',
        recipients: ['payroll@demohospital.example'],
        format: 'XLSX',
      },
    ],
    [
      'facility',
      {
        reportCode: 'housekeeping-tat',
        frequency: 'DAILY',
        time: '08:00',
        recipients: ['facility@demohospital.example'],
      },
    ],
    [
      'quality',
      {
        reportCode: 'nabh-indicators',
        frequency: 'MONTHLY',
        dayOfMonth: 5,
        time: '10:00',
        recipients: ['quality@demohospital.example'],
        format: 'PDF',
      },
    ],
  ];
  for (const [u, body] of schedules)
    ok(await (await h.as(u)).post('/reports/schedules').send(body), 201);
  return `${ex} exports, ${schedules.length} schedules`;
}

/**
 * Bed cleaning tasks come from beds being vacated (transfer or discharge), which the clinical seed
 * drives. Housekeeping closes the open ones here.
 */
async function cleaningTasks(h) {
  const wi = await h.as('wardincharge');
  const all = ok(await wi.get('/ipd/cleaning?status=ALL')).items;
  if (!all.length) return 'no vacated beds yet (made by IPD transfers/discharges)';
  const open = all.filter((t) => t.status === 'OPEN');
  if (!open.length || all.some((t) => t.status === 'DONE')) return 'skipped';
  // Close all but the newest, which stays on the board.
  let n = 0;
  for (const t of open.slice(0, -1)) {
    ok(await wi.post(`/ipd/cleaning/${t.id}/done`));
    n += 1;
  }
  return `${n} cleaning tasks closed, ${open.length - n} open`;
}

/** Job titles for the demo logins (username = role panel key). */
const LOGIN_DESIGNATION = {
  superadmin: ['Medical Director', 'CONSULTANT'],
  admin: ['Hospital Administrator', 'PERMANENT'],
  medsupt: ['Medical Superintendent', 'PERMANENT'],
  doctor: ['Consultant Physician', 'CONSULTANT'],
  hod: ['Head of Medicine', 'CONSULTANT'],
  clinic: ['Clinic Coordinator', 'PERMANENT'],
  nurse: ['Staff Nurse', 'PERMANENT'],
  frontoffice: ['Front Office Executive', 'PERMANENT'],
  security: ['Security Supervisor', 'CONTRACT'],
  cashier: ['Cashier', 'PERMANENT'],
  billingmgr: ['Billing Manager', 'PERMANENT'],
  tpa: ['Insurance Desk Executive', 'PERMANENT'],
  lab: ['Lab Technician', 'PERMANENT'],
  pathologist: ['Pathologist', 'CONSULTANT'],
  phlebotomist: ['Phlebotomist', 'PERMANENT'],
  radiology: ['Radiographer', 'PERMANENT'],
  radiologist2: ['Radiologist', 'CONSULTANT'],
  pharmacy: ['Pharmacist', 'PERMANENT'],
  store: ['Store Keeper', 'PERMANENT'],
  auditor: ['Internal Auditor', 'PERMANENT'],
  mrd: ['Medical Records Officer', 'PERMANENT'],
  kitchen: ['Kitchen Supervisor', 'PERMANENT'],
  facility: ['Facility Manager', 'PERMANENT'],
  quality: ['Quality Manager', 'PERMANENT'],
  crm: ['CRM Executive', 'PERMANENT'],
};

/** Every demo login gets an employee record, so My Space (leave, attendance, payslips) works. */
async function linkLogins(h) {
  const sa = await h.as('superadmin');
  const hr = await h.as('hr');
  const users = ok(await sa.get('/users?limit=100')).items ?? [];
  const linked = new Set(
    (ok(await hr.get('/hr/employees?limit=200')).items ?? []).map((e) => e.userId).filter(Boolean),
  );
  let added = 0;
  for (const u of users) {
    const role = LOGIN_DESIGNATION[u.username];
    if (!role || linked.has(u.id)) continue;
    const parts = String(u.name ?? u.username)
      .replace(/^(Dr\.?|Demo)\s+/i, '')
      .trim()
      .split(/\s+/);
    const first = parts[0] || u.username;
    const last = parts.slice(1).join(' ') || undefined;
    ok(
      await hr.post('/hr/employees').send({
        name: { first, ...(last ? { last } : {}) },
        gender: ['nurse', 'frontoffice', 'pathologist', 'quality', 'crm', 'tpa'].includes(
          u.username,
        )
          ? 'F'
          : 'M',
        designation: role[0],
        type: role[1],
        joinedOn: shiftDay(istDay(0), -400 - added * 37),
        userId: u.id,
      }),
      201,
    );
    added += 1;
  }
  return added ? `${added} logins linked to employee records` : 'skipped';
}

export const sections = [
  // HR masters and talent
  ['hr: link demo logins to employees', linkLogins],
  ['hr: designations', designations],
  ['payroll: deductor settings', payrollSettings],
  ['payroll: tax declarations', taxDeclarations],
  ['payroll: release last month', payrollRelease],
  ['payroll: TDS challans', tdsChallans],
  ['payroll: bonus draft', bonus],
  ['hr: holidays', holidays],
  ['hr: recruitment', recruitment],
  ['hr: training', training],
  ['hr: appraisals', appraisals],
  ['hr: shift swaps', shiftSwaps],
  // finance
  ['finance: budgets', budgets],
  ['finance: petty cash', pettyCash],
  ['finance: vendor payments', vendorPayments],
  ['finance: doctor shares', doctorShares],
  ['finance: doctor payouts', doctorPayouts],
  ['finance: fixed assets', fixedAssets],
  ['finance: depreciation', depreciation],
  ['finance: bank statement', bankStatement],
  // support services
  ['facility: housekeeping rounds', hkRounds],
  ['facility: linen condemnation', linenCondemn],
  ['facility: equipment PM', pmRecords],
  ['facility: waste handovers', wasteHandovers],
  ['quality: HAI cases', haiCases],
  ['crm: referral statements', referralStatements],
  ['ipd: bed cleaning tasks', cleaningTasks],
  ['reports: exports and schedules', reportsCentre],
];
