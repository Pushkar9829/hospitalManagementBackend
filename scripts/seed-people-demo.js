/**
 * HR, payroll and finance demo (called by seed-dev.js; safe to run again, each stage skips once
 * done): staff linked to the demo logins with salaries, a loan and registrations (two expiring),
 * a ward roster, two months of punches locked for payroll, last-but-one month's payroll released
 * through HR and Finance, last month's calculated and waiting, a leave request for the ward
 * in-charge, and the books opened with capital, an expense and the bills and receipts so far.
 */
import { current, runAsSystem, runInContext } from '../src/core/tenancy/context.js';
import { User } from '../src/core/auth/models/user.model.js';
import { ApprovalRequest } from '../src/core/approvals/approval.model.js';
import { decide } from '../src/core/approvals/approval.service.js';
import { Bill, Payment } from '../src/modules/billing/models/billing.models.js';
import { AttendanceLock, Employee, LeaveRequest } from '../src/modules/hr/models/hr.models.js';
import {
  applyLeave,
  createEmployee,
  daysOfMonth,
  importPunches,
  lockMonth,
  saveRoster,
} from '../src/modules/hr/services/hr.service.js';
import { PayrollRun, SalaryStructure } from '../src/modules/payroll/models/payroll.models.js';
import {
  calculate,
  createLoan,
  createRun,
  submit,
} from '../src/modules/payroll/services/payroll.service.js';
import { Journal } from '../src/modules/finance/models/finance.models.js';
import {
  ensureChart,
  onBillFinalized,
  onPayment,
  post,
} from '../src/modules/finance/services/finance.service.js';

const istNow = () => new Date(Date.now() + 330 * 60_000);
const today = () => istNow().toISOString().slice(0, 10);
const monthsBack = (n) => {
  const d = istNow();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
};
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const sunday = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay() === 0;

/**
 * Demo staff by login: [username, first, last, gender, designation, basic, hra, special,
 * manager username, registration [council, number, days to expiry]]. Salaries in rupees.
 */
const STAFF = [
  ['hr', 'Meera', 'Kulkarni', 'F', 'HR Manager', 40_000, 16_000, 8_000, null],
  ['payroll', 'Sanjay', 'Patil', 'M', 'Payroll Officer', 28_000, 11_200, 5_000, 'hr'],
  ['accounts', 'Kavita', 'Joshi', 'F', 'Finance Controller', 45_000, 18_000, 9_000, 'hr'],
  [
    'wardincharge',
    'Rekha',
    'Pawar',
    'F',
    'Nursing In-charge',
    30_000,
    12_000,
    6_000,
    'hr',
    ['Maharashtra Nursing Council', 'MNC-2011-4410', 400],
  ],
  [
    'nurse',
    'Anita',
    'D’Souza',
    'F',
    'Staff Nurse',
    18_000,
    7_200,
    3_000,
    'wardincharge',
    ['Maharashtra Nursing Council', 'MNC-2018-0932', 25],
  ],
  ['employee', 'Sunil', 'Gaikwad', 'M', 'Ward Attendant', 9_000, 3_600, 1_400, 'wardincharge'],
  ['cashier', 'Rahul', 'Shinde', 'M', 'Cashier', 12_000, 4_800, 1_200, 'accounts'],
  ['frontoffice', 'Pooja', 'More', 'F', 'Front Office Executive', 11_000, 4_400, 1_100, 'hr'],
  [
    'lab',
    'Imran',
    'Shaikh',
    'M',
    'Lab Technician',
    16_000,
    6_400,
    2_600,
    'hr',
    ['Paramedical Council', 'PMC-7781', -5],
  ],
  [
    'pharmacy',
    'Vikas',
    'Jain',
    'M',
    'Pharmacist',
    20_000,
    8_000,
    3_000,
    'hr',
    ['Maharashtra State Pharmacy Council', 'MSPC-55120', 300],
  ],
  ['store', 'Ganesh', 'Kale', 'M', 'Store Keeper', 14_000, 5_600, 1_400, 'accounts'],
];
const BANKS = ['SBIN0000456', 'HDFC0001234', 'ICIC0000789'];

/** Runs `fn` as a demo login (approvals need a real maker and checker). */
async function as(username, fn) {
  const u = await User.findOne({ username }).select('_id name').lean();
  return runInContext({ ...current(), userId: String(u._id), userName: u.name, system: false }, fn);
}

async function approveAll(approvalId, checkers) {
  for (const username of checkers) {
    const req = await ApprovalRequest.findById(approvalId).lean();
    if (!req || req.status !== 'PENDING') return;
    await as(username, () =>
      decide(approvalId, { decision: 'APPROVE', comment: 'Checked', version: req.version }),
    );
  }
}

async function seedStaff() {
  const ids = {};
  for (const [username, first, last, gender, designation, basic, hra, special, mgr, reg] of STAFF) {
    const user = await User.findOne({ username }).select('_id').lean();
    if (!user) continue;
    const i = Object.keys(ids).length;
    const e = await createEmployee({
      name: { first, last },
      gender,
      designation,
      joinedOn: `20${String(19 + (i % 5)).padStart(2, '0')}-0${(i % 9) + 1}-01`,
      mobile: `98200${String(10_000 + i * 37).slice(-5)}`,
      managerId: mgr ? ids[mgr] : undefined,
      pan: `ABCP${String.fromCharCode(65 + i)}${String(1000 + i * 7).slice(-4)}K`,
      uan: String(100_200_300_400 + i),
      bank: {
        name: ['State Bank of India', 'HDFC Bank', 'ICICI Bank'][i % 3],
        accountNo: String(30_000_000_000 + i * 1_013),
        ifsc: BANKS[i % 3],
      },
      registration: reg
        ? { council: reg[0], number: reg[1], expiresOn: addDays(today(), reg[2]) }
        : undefined,
      state: 'MH',
      userId: String(user._id),
    });
    ids[username] = e.id;
    await SalaryStructure.create([
      {
        employeeId: e.id,
        effectiveFrom: monthsBack(4),
        basic: basic * 100,
        hra: hra * 100,
        special: special * 100,
        status: 'ACTIVE',
        reason: 'Joining salary',
      },
    ]);
  }
  if (ids.cashier)
    await createLoan(ids.cashier, {
      kind: 'ADVANCE',
      amount: 6_000_00,
      emi: 1_500_00,
      startMonth: monthsBack(2),
    });
  return ids;
}

async function seedRoster() {
  const ward = await Employee.find({
    designation: { $in: ['Nursing In-charge', 'Staff Nurse', 'Ward Attendant'] },
  }).lean();
  if (!ward.length) return;
  const monday = addDays(today(), -((new Date(`${today()}T12:00:00Z`).getUTCDay() + 6) % 7));
  const pattern = {
    'Nursing In-charge': 'GGGGGGO',
    'Staff Nurse': 'MMEENNO',
    'Ward Attendant': 'EEMMOMM',
  };
  const cells = [];
  for (const e of ward)
    for (let d = 0; d < 14; d += 1) {
      const c = pattern[e.designation][d % 7];
      cells.push({
        employeeId: String(e._id),
        date: addDays(monday, d),
        shift: c === 'O' ? 'OFF' : c,
      });
    }
  await saveRoster({ unit: 'General Ward', cells });
}

/** Punches for a month: working days 09:00–17:00 with a few late, overtime and missed days. */
async function seedAttendance(month, { missFor = [] } = {}) {
  const emps = await Employee.find({ status: { $ne: 'EXITED' } }).lean();
  const rows = [];
  for (const [i, e] of emps.entries())
    for (const [j, d] of daysOfMonth(month).entries()) {
      if (sunday(d)) continue;
      if (missFor.includes(e.empNo) && (j === 3 || j === 17)) continue;
      const late = (i + j) % 11 === 0;
      const ot = e.designation === 'Staff Nurse' && j % 6 === 1;
      rows.push({
        empNo: e.empNo,
        date: d,
        in: late ? '09:40' : '08:58',
        out: ot ? '19:10' : '17:00',
      });
    }
  await importPunches({ rows });
  await lockMonth(month);
}

export async function seedPeopleDemo({ tenant }) {
  return runAsSystem(
    tenant._id,
    async () => {
      let added = false;
      if (!(await Employee.exists({}))) {
        await seedStaff();
        await seedRoster();
        added = true;
      }
      const m2 = monthsBack(2);
      const m1 = monthsBack(1);
      if (!(await AttendanceLock.exists({ month: m2 }))) {
        await seedAttendance(m2);
        added = true;
      }
      if (!(await AttendanceLock.exists({ month: m1 }))) {
        const attendant = await Employee.findOne({ designation: 'Ward Attendant' }).lean();
        await seedAttendance(m1, { missFor: attendant ? [attendant.empNo] : [] });
        added = true;
      }

      // Last-but-one month: released through HR and Finance. Last month: calculated, waiting.
      if (!(await PayrollRun.exists({ month: m2 }))) {
        const run = await as('payroll', () => createRun({ month: m2 }));
        await as('payroll', () => calculate(run.id));
        const sent = await as('payroll', () => submit(run.id));
        if (sent.approvalId) await approveAll(sent.approvalId, ['hr', 'accounts']);
        added = true;
      }
      if (!(await PayrollRun.exists({ month: m1 }))) {
        const run = await as('payroll', () => createRun({ month: m1 }));
        await as('payroll', () => calculate(run.id));
        added = true;
      }

      if (!(await LeaveRequest.exists({}))) {
        const nurse = await Employee.findOne({ designation: 'Staff Nurse' }).lean();
        if (nurse) {
          let from = addDays(today(), 10);
          while (sunday(from)) from = addDays(from, 1);
          await as('nurse', () =>
            applyLeave(nurse._id, { code: 'CL', from, to: from, reason: 'Family function' }),
          );
          added = true;
        }
      }

      // The books: capital, an electricity bill, and the bills and receipts taken so far (their
      // events were delivered before Finance existed, so post them once here).
      if (!(await Journal.exists({ 'source.kind': 'OPENING' }))) {
        await ensureChart();
        const opening = `${monthsBack(3)}-01`;
        await post({
          type: 'RECEIPT',
          date: opening,
          narration: 'Capital introduced by the promoters',
          source: { kind: 'OPENING', ref: 'capital', eventId: 'seed:opening:capital' },
          lines: [
            { key: 'BANK', debit: 50_00_000_00 },
            { key: 'CAPITAL', credit: 50_00_000_00 },
          ],
        });
        await post({
          type: 'PAYMENT',
          date: `${m1}-10`,
          narration: 'MSEDCL electricity bill',
          source: { kind: 'OPENING', ref: 'electricity', eventId: 'seed:opening:electricity' },
          lines: [
            { key: 'GENERAL_EXPENSE', debit: 1_85_000_00 },
            { key: 'BANK', credit: 1_85_000_00 },
          ],
        });
        for (const b of await Bill.find({ status: { $in: ['FINAL', 'PARTLY_PAID', 'PAID'] } })
          .select('_id')
          .lean())
          await onBillFinalized({ billId: String(b._id) }, { eventId: `seed:bill:${b._id}` });
        for (const p of await Payment.find({ status: 'CAPTURED' }).lean())
          await onPayment(
            { paymentId: String(p._id), receiptNo: p.receiptNo, amount: p.amount, mode: p.mode },
            { eventId: `seed:payment:${p._id}` },
          );
        added = true;
      }
      return added;
    },
    { userName: 'Demo seed' },
  );
}
