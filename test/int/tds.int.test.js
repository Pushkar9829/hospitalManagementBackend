import { describe, expect, it } from 'vitest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Employee } from '../../src/modules/hr/index.js';
import {
  PayrollRun,
  Payslip,
  SalaryStructure,
} from '../../src/modules/payroll/models/payroll.models.js';

const ctx = useIntegration();

const FY = '2024-25'; // a finished year: Form 16 is final
const MONTHS = [
  '2024-04',
  '2024-05',
  '2024-06',
  '2024-07',
  '2024-08',
  '2024-09',
  '2024-10',
  '2024-11',
  '2024-12',
  '2025-01',
  '2025-02',
  '2025-03',
];

/**
 * A finished year of locked payroll seeded directly: Dr Mehta earns ₹1,50,000 a month (new
 * regime) with ₹20,000 TDS a month; Ravi earns ₹20,000 with no TDS and no PAN.
 */
async function seeded() {
  const t = await makeTenant({ modules: ['HRM', 'PAY'] });
  await makeUser(t, { username: 'pay', roles: ['payroll'] });
  const doc = await makeUser(t, { username: 'doc', roles: ['employee'] });
  await runAsSystem(t.tenant._id, async () => {
    const [mehta, ravi] = await Employee.create([
      {
        empNo: 'E001',
        name: { first: 'Asha', last: 'Mehta' },
        joinedOn: new Date('2020-01-01'),
        pan: 'ABCPM1234K',
        designation: 'Consultant',
        userId: doc._id,
      },
      { empNo: 'E002', name: { first: 'Ravi' }, joinedOn: new Date('2023-01-01') },
    ]);
    await SalaryStructure.create([
      {
        employeeId: mehta._id,
        effectiveFrom: '2024-04',
        basic: 1_00_000_00,
        hra: 40_000_00,
        special: 10_000_00,
        status: 'ACTIVE',
        tdsRegime: 'NEW',
      },
      {
        employeeId: ravi._id,
        effectiveFrom: '2024-04',
        basic: 15_000_00,
        hra: 5_000_00,
        status: 'ACTIVE',
      },
    ]);
    for (const month of MONTHS) {
      const run = await PayrollRun.create({
        month,
        status: 'LOCKED',
        lockedAt: new Date(`${month}-28T10:00:00Z`),
      });
      const slip = (e, basic, hra, special, tds) => ({
        runId: run._id,
        month,
        employeeId: e._id,
        empNo: e.empNo,
        name: `${e.name.first}${e.name.last ? ` ${e.name.last}` : ''}`,
        pan: e.pan,
        days: 30,
        payableDays: 30,
        earnings: [
          { code: 'BASIC', name: 'Basic', amount: basic },
          { code: 'HRA', name: 'House rent allowance', amount: hra },
          ...(special ? [{ code: 'SPECIAL', name: 'Special allowance', amount: special }] : []),
        ],
        deductions: tds ? [{ code: 'TDS', name: 'Income tax (TDS)', amount: tds }] : [],
        gross: basic + hra + special,
        net: basic + hra + special - tds,
      });
      await Payslip.create([
        slip(mehta, 1_00_000_00, 40_000_00, 10_000_00, 20_000_00),
        slip(ravi, 15_000_00, 5_000_00, 0, 0),
      ]);
    }
  });
  return {
    t,
    c: { pay: await signIn(ctx.app, t.host, 'pay'), doc: await signIn(ctx.app, t.host, 'doc') },
  };
}

describe('Salary TDS: challans, 24Q and Form 16', () => {
  it('flags missing challans and details, then gives a clean 24Q and a Form 16', async () => {
    const { c } = await seeded();

    // --- the year: ₹20,000 deducted every month, nothing deposited yet
    const year = (await c.pay.get(`/payroll/tds?fy=${FY}`)).body;
    expect(year.months).toHaveLength(12);
    expect(year.tds).toBe(12 * 20_000_00);
    expect(year.deposited).toBe(0);
    expect(year.months[0]).toMatchObject({ month: '2024-04', quarter: 1, tds: 20_000_00 });
    expect(year.months[0].due).toBe('2024-05-07');
    expect(year.months[11].due).toBe('2025-04-30');

    // --- Q1 before any setup: no TAN, no responsible person, no challans, Ravi has no PAN
    let q1 = (await c.pay.get(`/payroll/tds/24q?fy=${FY}&quarter=1`)).body;
    const codes = q1.issues.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining(['NO_TAN', 'NO_RESPONSIBLE', 'NO_CHALLAN', 'NO_PAN']),
    );
    expect(q1.annexure1).toHaveLength(6);
    expect(q1.annexure2).toBeNull();
    expect(q1.annexure1.find((r) => r.empNo === 'E002').pan).toBe('PANNOTAVBL');

    // --- deductor details and the three challans; one is short and late
    const bad = await c.pay.put('/payroll/settings').send({ deductor: { tan: 'BAD' } });
    expect(bad.status).toBe(422);
    const set = await c.pay.put('/payroll/settings').send({
      deductor: {
        name: 'City Hospital',
        tan: 'mumc12345d',
        pan: 'AAACC1234F',
        address: 'Andheri, Mumbai',
        responsibleName: 'R. Shah',
        responsibleDesignation: 'Finance Controller',
      },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.deductor.tan).toBe('MUMC12345D');
    const challan = (month, depositedOn, amount, serial) =>
      c.pay.post('/payroll/tds/challans').send({
        month,
        bsrCode: '0510308',
        challanSerial: serial,
        depositedOn,
        amount,
      });
    expect((await challan('2024-04', '2024-05-06', 20_000_00, '00011')).status).toBe(200);
    expect((await challan('2024-05', '2024-06-05', 20_000_00, '00012')).status).toBe(200);
    expect((await challan('2024-06', '2024-07-10', 19_000_00, '00013')).status).toBe(200);
    expect(
      (
        await c.pay.post('/payroll/tds/challans').send({
          month: '2024-06',
          bsrCode: '123',
          challanSerial: '1',
          depositedOn: '2024-07-10',
          amount: 1,
        })
      ).status,
    ).toBe(422);

    q1 = (await c.pay.get(`/payroll/tds/24q?fy=${FY}&quarter=1`)).body;
    expect(q1.issues.map((i) => i.code).sort()).toEqual(['CHALLAN_SHORT', 'NO_PAN']);
    expect(q1.totals).toEqual({
      amountPaid: 3 * (1_50_000_00 + 20_000_00),
      tds: 60_000_00,
      deposited: 59_000_00,
    });
    expect(q1.csv.split('\n')[1]).toBe(
      '2024-04,E001,Asha Mehta,ABCPM1234K,2024-04-28,150000.00,20000.00,00011,0510308',
    );
    const june = (await c.pay.get(`/payroll/tds?fy=${FY}`)).body.months[2];
    expect(june).toMatchObject({ short: 1_000_00, late: true });

    // --- Q4 carries Annexure II: the year's salary and tax for each employee
    const q4 = (await c.pay.get(`/payroll/tds/24q?fy=${FY}&quarter=4`)).body;
    const a2 = q4.annexure2.find((r) => r.empNo === 'E001');
    expect(a2).toMatchObject({ regime: 'NEW', gross: 18_00_000_00, tdsDeducted: 2_40_000_00 });
    // New regime: ₹18 lakh less ₹75,000 standard deduction; the tax with cess is what the
    // statutory table gives (the balance is what Dr Mehta pays or gets back).
    expect(a2.taxable).toBe(17_25_000_00);
    expect(a2.balance).toBe(a2.tax - a2.tdsDeducted);
    expect(q4.annexure2.find((r) => r.empNo === 'E002').tax).toBe(0);

    // --- Form 16: list, figures, PDF; the employee sees their own
    const list = (await c.pay.get(`/payroll/form16?fy=${FY}`)).body;
    expect(list.provisional).toBe(false);
    expect(list.items.map((r) => r.empNo)).toEqual(['E001', 'E002']);
    const f = (await c.pay.get(`/payroll/form16/${list.items[0].employeeId}?fy=${FY}`)).body;
    expect(f.assessmentYear).toBe('2025-26');
    expect(f.deductor.tan).toBe('MUMC12345D');
    expect(f.quarters[0]).toMatchObject({ tds: 60_000_00, deposited: 60_000_00 });
    expect(f.quarters[0].challans).toHaveLength(3);
    expect(f.quarters[1]).toMatchObject({ tds: 60_000_00, deposited: 0 });
    expect(f.salary.gross).toBe(18_00_000_00);
    expect(f.salary.earnings.find((e) => e.code === 'BASIC').amount).toBe(12_00_000_00);

    const pdf = await c.pay
      .get(`/payroll/form16/${list.items[0].employeeId}/pdf?fy=${FY}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');

    const mine = (await c.doc.get(`/payroll/form16/me?fy=${FY}`)).body;
    expect(mine.employee.empNo).toBe('E001');
    expect((await c.doc.get(`/payroll/form16/${list.items[1].employeeId}?fy=${FY}`)).status).toBe(
      403,
    );
    expect((await c.doc.get(`/payroll/form16/me/pdf?fy=${FY}`)).status).toBe(200);
  });
});
