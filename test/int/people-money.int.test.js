import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { deliverEvents, makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { PriceList, Service, TaxCode } from '../../src/modules/setup/index.js';

const ctx = useIntegration();
const key = (req) => req.set('Idempotency-Key', randomUUID());

/** Last month in IST, its days, and the days that are not Sundays. */
function lastMonth() {
  const now = new Date(Date.now() + 330 * 60_000);
  const y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  const month = `${y}-${String(m).padStart(2, '0')}`;
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const working = days.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
  return { month, days, working };
}

async function approve(c, approvalId) {
  const a = (await c.get(`/approvals/${approvalId}`)).body;
  const res = await c
    .post(`/approvals/${approvalId}/decision`)
    .send({ decision: 'APPROVE', version: a.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** A hospital with HR, payroll, accounts and two linked staff (a manager and a nurse). */
async function hospital() {
  const t = await makeTenant({ modules: ['OPD', 'HRM', 'PAY', 'FIN'] });
  const users = {};
  for (const [u, r] of [
    ['hr', 'hr'],
    ['pay', 'payroll'],
    ['acc', 'accounts'],
    ['acc2', 'accounts'],
    ['mgr', 'employee'],
    ['emp', 'employee'],
    ['cash', 'cashier'],
    ['fo', 'frontoffice'],
  ])
    users[u] = await makeUser(t, { username: u, roles: [r] });
  const c = { sa: await signIn(ctx.app, t.host) };
  for (const u of Object.keys(users)) c[u] = await signIn(ctx.app, t.host, u);
  return { t, users, c };
}

const BANK = { name: 'State Bank', accountNo: '123456789012', ifsc: 'SBIN0001234' };

describe('HR, payroll and finance (Phase 5)', () => {
  it('pays three employees exactly as calculated by hand, then posts a balanced month', async () => {
    const { t, users, c } = await hospital();
    const { month, working } = lastMonth();

    // --- employees (E1 manages E2; E2 is the "emp" user, E1 the "mgr" user)
    const hire = async (body) => {
      const res = await c.hr.post('/hr/employees').send({ joinedOn: '2025-04-01', ...body });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body;
    };
    const e1 = await hire({
      name: { first: 'Anil', last: 'Rao' },
      gender: 'M',
      designation: 'Staff nurse',
      userId: String(users.mgr._id),
      bank: BANK,
    });
    const e2 = await hire({
      name: { first: 'Bala', last: 'Iyer' },
      gender: 'M',
      designation: 'Ward boy',
      managerId: e1.id,
      userId: String(users.emp._id),
      bank: { ...BANK, accountNo: '223456789012' },
    });
    const e3 = await hire({
      name: { first: 'Chitra', last: 'Nair' },
      gender: 'F',
      designation: 'Lab technician',
      bank: { ...BANK, accountNo: '323456789012' },
    });
    expect(e1.empNo).toBeTruthy();

    // --- salary structures: payroll proposes, HR then the Super Admin approve
    const structure = async (e, basic, hra, special) => {
      const res = await c.pay.post(`/payroll/employees/${e.id}/structures`).send({
        effectiveFrom: '2025-04',
        basic: basic * 100,
        hra: hra * 100,
        special: special * 100,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(res.body.status).toBe('PENDING_APPROVAL');
      await approve(c.hr, res.body.approvalId);
      await approve(c.sa, res.body.approvalId);
    };
    await structure(e1, 20_000, 8_000, 4_000);
    await structure(e2, 10_000, 4_000, 2_000);
    await structure(e3, 15_000, 6_000, 3_000);
    const s1 = (await c.pay.get(`/payroll/employees/${e1.id}/structures`)).body.items[0];
    expect(s1.status).toBe('ACTIVE');
    expect(
      (
        await c.pay
          .post(`/payroll/employees/${e2.id}/loans`)
          .send({ amount: 5_000_00, emi: 1_000_00, startMonth: month })
      ).status,
    ).toBe(201);

    // --- attendance: everyone punches on working days except E3, who misses two days
    const rows = [];
    for (const [e, skip] of [
      [e1, 0],
      [e2, 0],
      [e3, 2],
    ])
      for (const d of working.slice(skip))
        rows.push({ empNo: e.empNo, date: d, in: '09:00', out: '17:00' });
    const imp = await c.hr.post('/hr/attendance/import').send({ rows });
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    expect(imp.body.saved).toBe(rows.length);

    // a run cannot start before attendance is locked
    expect((await c.pay.post('/payroll/runs').send({ month })).body.error.code).toBe(
      'ATTENDANCE_NOT_LOCKED',
    );
    expect((await c.hr.post('/hr/attendance/lock').send({ month })).status).toBe(200);
    const late = await c.hr
      .post('/hr/attendance/import')
      .send({ rows: [{ empNo: e3.empNo, date: working[0], in: '09:00', out: '17:00' }] });
    expect(late.body.skipped[0].reason).toBe('Month locked');

    // --- the run
    const run = await c.pay.post('/payroll/runs').send({ month });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    await c.pay
      .put(`/payroll/runs/${run.body.id}/inputs`)
      .send({ inputs: [{ employeeId: e1.id, overtimeHours: 4 }] });
    const calc = await c.pay.post(`/payroll/runs/${run.body.id}/calculate`);
    expect(calc.status, JSON.stringify(calc.body)).toBe(200);
    expect(calc.body.status).toBe('CALCULATED');

    const slips = Object.fromEntries(
      (await c.pay.get(`/payroll/runs/${run.body.id}/payslips`)).body.items.map((p) => [
        p.empNo,
        p,
      ]),
    );
    const amt = (lines, code) => lines.find((l) => l.code === code)?.amount ?? 0;
    const feb = month.endsWith('-02');

    // E1: ₹32,000 fixed + 4 h overtime at double the hourly basic (20,000 / 26 / 8 × 2 × 4)
    const p1 = slips[e1.empNo];
    expect(amt(p1.earnings, 'OT')).toBe(769_00);
    expect(p1.gross).toBe(32_769_00);
    expect(amt(p1.deductions, 'PF')).toBe(1_800_00); // 12% of the ₹15,000 ceiling
    expect(amt(p1.deductions, 'ESI')).toBe(0); // gross above ₹21,000
    expect(amt(p1.deductions, 'PT')).toBe(feb ? 300_00 : 200_00);
    expect(amt(p1.deductions, 'TDS')).toBe(0); // ₹3.93 lakh a year: no tax
    expect(p1.net).toBe(p1.gross - 1_800_00 - (feb ? 300_00 : 200_00));

    // E2: ₹16,000; PF 1,200; ESI 0.75% = 120 (employer 3.25% = 520); PT 200; loan EMI 1,000
    const p2 = slips[e2.empNo];
    expect(p2.gross).toBe(16_000_00);
    expect(amt(p2.deductions, 'PF')).toBe(1_200_00);
    expect(amt(p2.deductions, 'ESI')).toBe(120_00);
    expect(amt(p2.employer, 'ESI_ER')).toBe(520_00);
    expect(amt(p2.employer, 'PF_ER')).toBe(1_200_00);
    expect(amt(p2.deductions, 'LOAN')).toBe(1_000_00);
    expect(p2.net).toBe(16_000_00 - 1_200_00 - 120_00 - (feb ? 300_00 : 200_00) - 1_000_00);

    // E3: two days' loss of pay; each head prorated and rounded to the rupee
    const p3 = slips[e3.empNo];
    const n = p3.days;
    const pro = (rupees) => Math.round((rupees * (n - 2)) / n) * 100;
    expect(p3.lop).toBe(2);
    expect(amt(p3.earnings, 'BASIC')).toBe(pro(15_000));
    expect(p3.gross).toBe(pro(15_000) + pro(6_000) + pro(3_000));
    expect(amt(p3.deductions, 'PF')).toBe(Math.round(Math.min(pro(15_000), 15_000_00) * 0.12));
    expect(amt(p3.deductions, 'ESI')).toBe(0);
    expect(amt(p3.deductions, 'PT')).toBe(0); // women up to ₹25,000 in Maharashtra
    expect(p3.net).toBe(p3.gross - amt(p3.deductions, 'PF'));

    // --- release: HR then Finance; the maker cannot approve
    const sub = await c.pay.post(`/payroll/runs/${run.body.id}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(202);
    await approve(c.hr, sub.body.approvalId);
    expect((await c.pay.get(`/payroll/runs/${run.body.id}/bank-file`)).body.error.code).toBe(
      'INVALID_STATE',
    );
    await approve(c.acc, sub.body.approvalId);
    const locked = (await c.pay.get(`/payroll/runs/${run.body.id}`)).body;
    expect(locked.status).toBe('LOCKED');
    expect(locked.totals.net).toBe(p1.net + p2.net + p3.net);
    expect((await c.pay.get(`/payroll/employees/${e2.id}/loans`)).body.items[0].balance).toBe(
      4_000_00,
    );
    const bank = (await c.pay.get(`/payroll/runs/${run.body.id}/bank-file`)).body;
    expect(bank.csv).toContain('223456789012');
    const mine = (await c.emp.get('/payroll/payslips/me')).body.items;
    expect(mine).toHaveLength(1);
    expect(mine[0].net).toBe(p2.net);

    // --- leave: the nurse applies, cannot approve it, the manager does
    const leaveDay = working.at(-1).replace(month, '');
    const nextMonth = (() => {
      const [y, m] = month.split('-').map(Number);
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    })();
    const future = `${nextMonth}${leaveDay}`.slice(0, 10);
    const fwd = new Date(Date.now() + 330 * 60_000 + 20 * 86_400_000).toISOString().slice(0, 10);
    let day = future > fwd ? future : fwd;
    // Move off a Sunday or a holiday: leave on a day off is refused.
    let applied;
    for (let i = 0; i < 10; i += 1) {
      applied = await c.emp
        .post('/me/leave')
        .send({ code: 'CL', from: day, to: day, reason: 'Family function' });
      if (applied.status !== 422) break;
      day = new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    expect(
      (
        await c.emp
          .post(`/hr/leave-requests/${applied.body.id}/decision`)
          .send({ decision: 'APPROVE' })
      ).status,
    ).toBe(403);
    expect((await c.mgr.get('/hr/leave-requests')).body.items.map((l) => l.id)).toContain(
      applied.body.id,
    );
    const ok = await c.mgr
      .post(`/hr/leave-requests/${applied.body.id}/decision`)
      .send({ decision: 'APPROVE' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const bal = (await c.emp.get('/me/leave')).body.balances.items.find((b) => b.code === 'CL');
    expect(bal.used).toBe(1);

    // --- an OPD bill paid by UPI
    const svc = await runAsSystem(t.tenant._id, async () => {
      const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
      const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
      const [s] = await Service.create([
        {
          code: 'CONS',
          name: 'Consultation',
          category: 'CONSULTATION',
          taxCodeId: exempt._id,
          status: 'ACTIVE',
          isActive: true,
          rates: [{ priceListId: general._id, amount: 50000 }],
        },
      ]);
      return String(s._id);
    });
    const patient = (
      await c.fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first: 'Ravi', last: 'Kumar' },
        gender: 'M',
        mobile: '9876543210',
        birth: { age: { years: 40 } },
        category: 'GENERAL',
        confirmNotDuplicate: true,
      })
    ).body;
    expect(
      (await c.cash.post('/billing/shifts').send({ counter: 'C1', openingCash: 0 })).status,
    ).toBe(201);
    const draft = (
      await c.cash
        .post('/billing/bills')
        .send({ patientId: patient.id, lines: [{ serviceId: svc }] })
    ).body;
    const bill = (
      await c.cash.post(`/billing/bills/${draft.id}/finalize`).send({ version: draft.version })
    ).body;
    expect(bill.status).toBe('FINAL');
    const paid = await key(c.cash.post('/billing/payments')).send({
      patientId: patient.id,
      mode: 'UPI',
      amount: 500,
      reference: 'UPI123456',
      allocations: [{ billId: bill.id, amount: 500 }],
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);

    // --- the worker posts journals; delivering twice posts once
    await deliverEvents(t.tenant._id);
    await deliverEvents(t.tenant._id);
    const vouchers = (await c.acc.get('/finance/vouchers')).body.items;
    const types = vouchers.map((v) => v.type).sort();
    expect(types).toEqual(['PAYMENT', 'PAYROLL', 'RECEIPT', 'SALES']); // PAYMENT: the loan paid out
    for (const v of vouchers) {
      const dr = v.lines.reduce((s, l) => s + l.debit, 0);
      const cr = v.lines.reduce((s, l) => s + l.credit, 0);
      expect(dr).toBe(cr);
    }

    const tb = (await c.acc.get('/finance/trial-balance')).body;
    expect(tb.balanced).toBe(true);
    expect(tb.debit).toBeGreaterThan(0);
    const bs = (await c.acc.get('/finance/balance-sheet')).body;
    expect(bs.balanced).toBe(true);
    // ₹5,000 lent, ₹1,000 recovered through payroll
    expect(bs.assets.find((a) => a.code === '1220').amount).toBe(4_000_00);
    const pl = (await c.acc.get('/finance/profit-loss')).body;
    expect(pl.totalIncome).toBe(50000);
    const salaries = pl.expenses.find((e) => e.key === 'SALARIES' || e.code === '5000');
    expect(salaries.amount).toBe(locked.totals.gross);
    expect(pl.profit).toBe(
      50000 - locked.totals.gross - locked.totals.pfEmployer - locked.totals.esiEmployer,
    );

    // --- a manual journal waits for a second accountant
    const accounts = (await c.acc.get('/finance/accounts')).body.items;
    const byCode = (code) => accounts.find((a) => a.code === code).id;
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const jv = await c.acc.post('/finance/vouchers').send({
      type: 'JOURNAL',
      date: today,
      narration: 'Electricity bill accrued',
      lines: [
        { accountId: byCode('5510'), debit: 12_000_00 },
        { accountId: byCode('2000'), credit: 12_000_00 },
      ],
    });
    expect(jv.status, JSON.stringify(jv.body)).toBe(202);
    expect(jv.body.status).toBe('PENDING_APPROVAL');
    const unbalanced = await c.acc.post('/finance/vouchers').send({
      type: 'PAYMENT',
      date: today,
      narration: 'Wrong one',
      lines: [
        { accountId: byCode('5520'), debit: 100 },
        { accountId: byCode('1000'), credit: 99 },
      ],
    });
    expect(unbalanced.status).toBe(422);
    await approve(c.acc2, jv.body.approvalId);
    const pl2 = (await c.acc.get('/finance/profit-loss')).body;
    expect(pl2.profit).toBe(pl.profit - 12_000_00);
    expect((await c.acc.get('/finance/trial-balance')).body.balanced).toBe(true);
    expect((await c.acc.get('/finance/balance-sheet')).body.balanced).toBe(true);

    // --- gratuity: earned so far, not payable before 5 years
    const gr = (await c.pay.get('/payroll/gratuity')).body;
    const anil = gr.items.find((r) => r.name === 'Anil Rao');
    expect(anil).toMatchObject({ monthlyWage: 20_000_00, eligible: false });
    expect(anil.amount).toBe(Math.round((20_000_00 * 15 * anil.countedYears) / 26));
    expect(gr.payableNow).toBe(0);

    // --- statutory bonus: drafted from the locked month, paid after Finance approves
    const fyOfMonth = (m) => {
      const [y, mm] = m.split('-').map(Number);
      const start = mm >= 4 ? y : y - 1;
      return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
    };
    expect(
      (await c.pay.post('/payroll/bonus').send({ fy: fyOfMonth(month), percent: 25 })).status,
    ).toBe(422);
    const bonus = await c.pay.post('/payroll/bonus').send({ fy: fyOfMonth(month), percent: 8.33 });
    expect(bonus.status, JSON.stringify(bonus.body)).toBe(200);
    // Bonus on at most ₹7,000 a month: Anil (basic ₹20,000) gets 8.33% of ₹7,000.
    const anilBonus = bonus.body.lines.find((l) => l.name === 'Anil Rao');
    if (anilBonus) expect(anilBonus.bonus).toBe(Math.round((7_000_00 * 8.33) / 100));
    expect(bonus.body.total).toBe(bonus.body.lines.reduce((t, l) => t + l.bonus, 0));
    if (bonus.body.total > 0) {
      const sent = await c.pay
        .post(`/payroll/bonus/${bonus.body.id}/pay`)
        .send({ version: bonus.body.version });
      expect(sent.status, JSON.stringify(sent.body)).toBe(202);
      await approve(c.acc, sent.body.approvalId);
      const paid = (await c.pay.get('/payroll/bonus')).body.items[0];
      expect(paid.status).toBe('PAID');
      await deliverEvents(t.tenant._id);
      const tb2 = (await c.acc.get('/finance/trial-balance')).body;
      expect(tb2.items.find((r) => r.key === 'BONUS_EXPENSE').debit).toBe(bonus.body.total);
      expect(tb2.balanced).toBe(true);
    }

    // --- month close: nothing more can be posted into last month
    expect((await c.acc.post('/finance/period/lock').send({ month })).status).toBe(200);
    const closed = await c.acc.post('/finance/vouchers').send({
      type: 'PAYMENT',
      date: working[0],
      narration: 'Back-dated repair',
      lines: [
        { accountId: byCode('5520'), debit: 100 },
        { accountId: byCode('1000'), credit: 100 },
      ],
    });
    expect(closed.status).toBe(409);
    expect(
      (
        await c.acc
          .post('/finance/period/reopen')
          .send({ month, reason: 'Audit adjustment needed' })
      ).status,
    ).toBe(403);
  });

  it('My Space: profile changes through HR approval; tax declaration saved, reviewed by payroll', async () => {
    const { users, c } = await hospital();
    const hire = await c.hr.post('/hr/employees').send({
      joinedOn: '2025-04-01',
      name: { first: 'Bala', last: 'Iyer' },
      gender: 'M',
      designation: 'Ward boy',
      userId: String(users.emp._id),
      bank: BANK,
    });
    expect(hire.status).toBe(201);

    const change = await c.emp.post('/me/profile-changes').send({
      mobile: '9820041220',
      address: 'Flat 12, Green Park, Pune',
      emergencyContact: { name: 'Suresh Iyer', relation: 'Brother', mobile: '9820041221' },
    });
    expect(change.status).toBe(202);
    expect(
      (await c.emp.post('/me/profile-changes').send({ mobile: '9820041299' })).body.error.code,
    ).toBe('CHANGE_PENDING');
    expect((await c.emp.get('/me/employee')).body.mobile).not.toBe('9820041220');
    await approve(c.hr, change.body.approvalId);
    const me = (await c.emp.get('/me/employee')).body;
    expect(me).toMatchObject({
      mobile: '9820041220',
      address: 'Flat 12, Green Park, Pune',
      emergencyContact: { name: 'Suresh Iyer', relation: 'Brother', mobile: '9820041221' },
    });
    expect((await c.emp.get('/me/profile-changes')).body.items[0].status).toBe('APPLIED');

    expect((await c.emp.get('/me/tax-declaration')).body.declaration).toBeNull();
    const saved = await c.emp
      .put('/me/tax-declaration')
      .send({ regime: 'OLD', rentMonthly: 12000, deductions80C: 60000, deductions80D: 18000 });
    expect(saved.status).toBe(200);
    expect(saved.body.declaration).toMatchObject({ regime: 'OLD', status: 'SUBMITTED' });
    const listed = (await c.pay.get('/payroll/tax-declarations')).body.items;
    expect(listed[0]).toMatchObject({ employee: { name: 'Bala Iyer' }, deductions80C: 60000 });
    expect((await c.emp.get('/payroll/tax-declarations')).status).toBe(403);
    const verified = await c.pay
      .post(`/payroll/tax-declarations/${listed[0].id}/review`)
      .send({ version: listed[0].version, outcome: 'VERIFIED' });
    expect(verified.body.status).toBe('VERIFIED');
    // A new change goes back to payroll for checking.
    const again = await c.emp
      .put('/me/tax-declaration')
      .send({ regime: 'OLD', rentMonthly: 15000, deductions80C: 150000, deductions80D: 18000 });
    expect(again.body.declaration.status).toBe('SUBMITTED');
  });
});
