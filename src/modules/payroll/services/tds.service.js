import { z } from 'zod';
import { renderPdf, STYLES } from '../../../core/print/engine.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { current } from '../../../core/tenancy/context.js';
import { Employee, myEmployee } from '../../hr/index.js';
import { annualTax, declaredOtherDeductions } from '../data/statutory.js';
import { PayrollRun, Payslip, TaxDeclaration, TdsChallan } from '../models/payroll.models.js';
import { activeStructure, financialYearOf, statutory } from './payroll.service.js';

/**
 * Salary TDS (section 192): the challans that deposit each month's tax, the quarterly 24Q return
 * (Annexure I every quarter, Annexure II with the year's salary in Q4) and Form 16 for each
 * employee. Money in paise; the return's figures are what the RPU utility needs, not its
 * FVU file (that is made with NSDL's free utility from this data).
 */

const ymd = (d) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const istMonth = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
const tdsOf = (slip) => slip.deductions?.find((d) => d.code === 'TDS')?.amount ?? 0;
const QUARTER_OF = { '04': 1, '05': 1, '06': 1, '07': 2, '08': 2, '09': 2, 10: 3, 11: 3, 12: 3 };
const quarterOf = (m) => QUARTER_OF[m.slice(5)] ?? 4;
const fyInput = z.string().regex(/^\d{4}-\d{2}$/, 'Use 2026-27');

export const fyMonths = (fy) => {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    return `${i < 9 ? start : start + 1}-${String(m).padStart(2, '0')}`;
  });
};

/** Last month of the financial year has passed (Form 16 is final, not provisional). */
const yearOver = (fy) => istMonth() > fyMonths(fy)[11];

/** The year's locked runs and their payslips. */
async function lockedSlips(fy, filter = {}) {
  const runs = await PayrollRun.find({ month: { $in: fyMonths(fy) }, status: 'LOCKED' }).lean();
  const slips = runs.length
    ? await Payslip.find({ runId: { $in: runs.map((r) => r._id) }, ...filter })
        .sort({ month: 1, empNo: 1 })
        .lean()
    : [];
  return { runs, slips };
}

async function deductor() {
  const d = (await statutory()).deductor ?? {};
  return {
    name: d.name || current().tenant?.name || 'Employer',
    tan: d.tan ?? null,
    pan: d.pan ?? null,
    address: d.address ?? null,
    responsibleName: d.responsibleName ?? null,
    responsibleDesignation: d.responsibleDesignation ?? null,
  };
}

// ---------------------------------------------------------------- challans

const challanOut = (c) => ({
  id: String(c._id),
  month: c.month,
  bsrCode: c.bsrCode,
  challanSerial: c.challanSerial,
  depositedOn: ymd(c.depositedOn),
  amount: c.amount,
  version: c.version ?? 0,
});

export const challanInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  bsrCode: z.string().regex(/^\d{7}$/, 'The BSR code has 7 digits'),
  challanSerial: z.string().regex(/^\d{5}$/, 'The challan serial has 5 digits'),
  depositedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int().min(1),
});

/**
 * Records the challan (ITNS 281) that deposited a month's TDS. Due by the 7th of the next month
 * (30 April for March); a late deposit is flagged, not refused.
 */
export async function recordChallan(input) {
  const run = await PayrollRun.findOne({ month: input.month, status: 'LOCKED' }).lean();
  if (!run) throw new AppError(409, 'NOT_LOCKED', `Payroll for ${input.month} is not locked yet.`);
  const c =
    (await TdsChallan.findOne({ month: input.month })) ?? new TdsChallan({ month: input.month });
  c.set({ ...input, depositedOn: new Date(`${input.depositedOn}T00:00:00+05:30`) });
  await c.save();
  return challanOut(c.toObject());
}

const dueDate = (month) => {
  const [y, m] = month.split('-').map(Number);
  if (m === 3) return `${y}-04-30`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-07`;
};

/** Month by month for the year: TDS deducted, the challan, and what is short or late. */
export async function tdsYear({ fy = financialYearOf(istMonth()) } = {}) {
  const { runs, slips } = await lockedSlips(fy);
  const challans = await TdsChallan.find({ month: { $in: fyMonths(fy) } }).lean();
  const months = fyMonths(fy).map((month) => {
    const run = runs.find((r) => r.month === month);
    const mine = slips.filter((s) => s.month === month);
    const tds = mine.reduce((t, s) => t + tdsOf(s), 0);
    const c = challans.find((x) => x.month === month);
    const due = dueDate(month);
    return {
      month,
      quarter: quarterOf(month),
      locked: Boolean(run),
      employees: mine.length,
      gross: mine.reduce((t, s) => t + s.gross, 0),
      tds,
      due,
      challan: c ? challanOut(c) : null,
      short: c ? Math.max(0, tds - c.amount) : tds,
      late: c ? ymd(c.depositedOn) > due : Boolean(run) && tds > 0 && ymd(new Date()) > due,
    };
  });
  return {
    fy,
    deductor: await deductor(),
    months,
    tds: months.reduce((t, m) => t + m.tds, 0),
    deposited: months.reduce((t, m) => t + (m.challan?.amount ?? 0), 0),
  };
}

// ---------------------------------------------------------------- Form 16 figures

/** The year's salary and tax for one employee, from locked payslips (Form 16 Part B). */
async function salaryYear(employee, fy, slips) {
  const earnings = new Map();
  for (const s of slips)
    for (const e of s.earnings ?? [])
      earnings.set(e.code, {
        code: e.code,
        name: e.name,
        amount: (earnings.get(e.code)?.amount ?? 0) + e.amount,
      });
  const gross = slips.reduce((t, s) => t + s.gross, 0);
  const tdsDeducted = slips.reduce((t, s) => t + tdsOf(s), 0);
  const pt = slips.reduce(
    (t, s) => t + (s.deductions?.find((d) => d.code === 'PT')?.amount ?? 0),
    0,
  );
  const stat = await statutory();
  const declaration = await TaxDeclaration.findOne({
    employeeId: employee._id,
    fy,
    status: { $ne: 'REJECTED' },
  }).lean();
  const lastMonth = slips.at(-1)?.month ?? fyMonths(fy)[11];
  const structure = await activeStructure(employee._id, lastMonth);
  const regime = declaration?.regime ?? structure?.tdsRegime ?? 'NEW';
  const deductions80C =
    regime === 'OLD' ? (declaration?.deductions80C ?? structure?.declarations80C ?? 0) : 0;
  const otherDeductions =
    regime === 'OLD' && declaration && structure
      ? declaredOtherDeductions(declaration, {
          basicDaMonthly: (structure.basic + structure.da) / 100,
          hraMonthly: structure.hra / 100,
        })
      : 0;
  const cfg = stat.tds;
  const r = cfg[regime];
  const { taxable, tax } = annualTax(
    Math.round(gross / 100),
    { regime, deductions80C, otherDeductions },
    cfg,
  );
  const taxPaise = tax * 100;
  return {
    regime,
    earnings: [...earnings.values()],
    gross,
    standardDeduction: r.standardDeduction * 100,
    deductions80C: Math.min(deductions80C, r.max80C ?? deductions80C) * 100,
    otherDeductions: otherDeductions * 100,
    professionalTax: pt,
    taxable: taxable * 100,
    tax: taxPaise,
    tdsDeducted,
    // Positive: still to pay with the return; negative: refund due.
    balance: taxPaise - tdsDeducted,
  };
}

const nameOf = (e) => `${e.name.first}${e.name.last ? ` ${e.name.last}` : ''}`;

/** Form 16 for one employee and year: Part A (TDS by quarter) and Part B (salary and tax). */
export async function form16(employeeId, { fy = financialYearOf(istMonth()) } = {}) {
  const e = await Employee.findById(employeeId).lean();
  if (!e) throw errors.notFound('Employee');
  const { slips } = await lockedSlips(fy, { employeeId: e._id });
  if (!slips.length)
    throw new AppError(404, 'NO_SALARY', `No locked salary for ${nameOf(e)} in ${fy}.`);
  const challans = await TdsChallan.find({ month: { $in: fyMonths(fy) } }).lean();
  const quarters = [1, 2, 3, 4].map((q) => {
    const mine = slips.filter((s) => quarterOf(s.month) === q);
    const tds = mine.reduce((t, s) => t + tdsOf(s), 0);
    return {
      quarter: q,
      amountPaid: mine.reduce((t, s) => t + s.gross, 0),
      tds,
      // Deposited: the months of the quarter whose TDS a challan has covered.
      deposited: mine
        .filter((s) => challans.some((c) => c.month === s.month))
        .reduce((t, s) => t + tdsOf(s), 0),
      challans: challans
        .filter((c) => quarterOf(c.month) === q && mine.some((s) => s.month === c.month))
        .map(challanOut),
    };
  });
  return {
    fy,
    assessmentYear: `${Number(fy.slice(0, 4)) + 1}-${String((Number(fy.slice(0, 4)) + 2) % 100).padStart(2, '0')}`,
    provisional: !yearOver(fy),
    deductor: await deductor(),
    employee: {
      id: String(e._id),
      empNo: e.empNo,
      name: nameOf(e),
      pan: e.pan ?? null,
      designation: e.designation ?? null,
      address: e.address ?? null,
      from: slips[0].month,
      to: slips.at(-1).month,
    },
    quarters,
    salary: await salaryYear(e, fy, slips),
  };
}

export async function myForm16(query) {
  return form16((await myEmployee())._id, query);
}

/** Everyone paid salary in the year, with gross and TDS (the list Form 16s are issued from). */
export async function form16List({ fy = financialYearOf(istMonth()) } = {}) {
  const { slips } = await lockedSlips(fy);
  const by = new Map();
  for (const s of slips) {
    const k = String(s.employeeId);
    const r = by.get(k) ?? {
      employeeId: k,
      empNo: s.empNo,
      name: s.name,
      pan: s.pan ?? null,
      gross: 0,
      tds: 0,
    };
    r.gross += s.gross;
    r.tds += tdsOf(s);
    by.set(k, r);
  }
  return {
    fy,
    provisional: !yearOver(fy),
    items: [...by.values()].sort((a, b) => a.empNo.localeCompare(b.empNo)),
  };
}

// ---------------------------------------------------------------- 24Q

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rupees = (p) => (p / 100).toFixed(2);

/**
 * The quarter's 24Q: the challans, Annexure I (deductee rows: each employee's salary and TDS by
 * month, against the month's challan) and, in Q4, Annexure II (each employee's salary for the
 * year). Problems the return would be rejected or defaulted for are listed first.
 */
export async function return24Q({ fy, quarter }) {
  const months = fyMonths(fy).filter((m) => quarterOf(m) === quarter);
  const { runs, slips } = await lockedSlips(fy);
  const challans = await TdsChallan.find({ month: { $in: months } }).lean();
  const d = await deductor();
  const issues = [];
  if (!d.tan) issues.push({ code: 'NO_TAN', message: 'Add the TAN in payroll settings.' });
  if (!d.responsibleName)
    issues.push({
      code: 'NO_RESPONSIBLE',
      message: 'Add the person responsible for deduction in payroll settings.',
    });
  for (const m of months) {
    if (!runs.some((r) => r.month === m)) {
      issues.push({ code: 'NOT_LOCKED', month: m, message: `Payroll for ${m} is not locked.` });
      continue;
    }
    const tds = slips.filter((s) => s.month === m).reduce((t, s) => t + tdsOf(s), 0);
    const c = challans.find((x) => x.month === m);
    if (tds > 0 && !c)
      issues.push({ code: 'NO_CHALLAN', month: m, message: `No challan for ${m}.` });
    else if (c && c.amount < tds)
      issues.push({
        code: 'CHALLAN_SHORT',
        month: m,
        message: `The ${m} challan is ₹${rupees(tds - c.amount)} short of the TDS deducted.`,
      });
  }
  const quarterSlips = slips.filter((s) => months.includes(s.month));
  const runOf = new Map(runs.map((r) => [r.month, r]));
  const annexure1 = quarterSlips.map((s) => {
    const c = challans.find((x) => x.month === s.month);
    return {
      month: s.month,
      empNo: s.empNo,
      name: s.name,
      pan: s.pan || 'PANNOTAVBL',
      paidOn: runOf.get(s.month)?.lockedAt ? ymd(runOf.get(s.month).lockedAt) : null,
      amountPaid: s.gross,
      tds: tdsOf(s),
      challanSerial: c?.challanSerial ?? null,
      bsrCode: c?.bsrCode ?? null,
    };
  });
  const noPan = [...new Set(annexure1.filter((r) => r.pan === 'PANNOTAVBL').map((r) => r.name))];
  if (noPan.length)
    issues.push({
      code: 'NO_PAN',
      message: `No PAN for ${noPan.join(', ')}: TDS is due at 20% or the slab rate, if higher.`,
    });
  let annexure2 = null;
  if (quarter === 4) {
    annexure2 = [];
    const ids = [...new Set(slips.map((s) => String(s.employeeId)))];
    const staff = await Employee.find({ _id: { $in: ids } }).lean();
    for (const e of staff.sort((a, b) => a.empNo.localeCompare(b.empNo))) {
      const mine = slips.filter((s) => String(s.employeeId) === String(e._id));
      const y = await salaryYear(e, fy, mine);
      annexure2.push({
        empNo: e.empNo,
        name: nameOf(e),
        pan: e.pan || 'PANNOTAVBL',
        regime: y.regime,
        from: mine[0].month,
        to: mine.at(-1).month,
        gross: y.gross,
        standardDeduction: y.standardDeduction,
        deductions: y.deductions80C + y.otherDeductions,
        taxable: y.taxable,
        tax: y.tax,
        tdsDeducted: y.tdsDeducted,
        balance: y.balance,
      });
    }
  }
  const csv = [
    'Month,Employee No,Name,PAN,Date paid,Amount paid,TDS,Challan serial,BSR code',
    ...annexure1.map((r) =>
      [
        r.month,
        r.empNo,
        r.name,
        r.pan,
        r.paidOn,
        rupees(r.amountPaid),
        rupees(r.tds),
        r.challanSerial,
        r.bsrCode,
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n');
  return {
    fy,
    quarter,
    months,
    dueOn: { 1: '07-31', 2: '10-31', 3: '01-31', 4: '05-31' }[quarter],
    deductor: d,
    issues,
    challans: months.map((m) => {
      const c = challans.find((x) => x.month === m);
      return {
        month: m,
        tds: quarterSlips.filter((s) => s.month === m).reduce((t, s) => t + tdsOf(s), 0),
        challan: c ? challanOut(c) : null,
      };
    }),
    annexure1,
    annexure2,
    totals: {
      amountPaid: annexure1.reduce((t, r) => t + r.amountPaid, 0),
      tds: annexure1.reduce((t, r) => t + r.tds, 0),
      deposited: challans.reduce((t, c) => t + c.amount, 0),
    },
    csv,
  };
}

export const yearQuery = z.object({ fy: fyInput.optional() });
export const quarterQuery = z.object({
  fy: fyInput,
  quarter: z.coerce.number().int().min(1).max(4),
});

// ---------------------------------------------------------------- PDF

const inr = (p) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Form 16 (Part A and Part B) as an A4 PDF. */
export async function form16Pdf(f) {
  const s = f.salary;
  const row = (label, value, bold) => [
    { text: label, bold },
    { text: value, alignment: 'right', bold },
  ];
  const kv = (label, value) => [{ text: label, style: 'label' }, value ?? '—'];
  return renderPdf({
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 48],
    styles: STYLES,
    ...(f.provisional ? { watermark: { text: 'PROVISIONAL', opacity: 0.08, bold: true } } : {}),
    footer: (page, pages) => ({
      text: `Form 16 · ${f.employee.name} · FY ${f.fy} · Page ${page} of ${pages}`,
      alignment: 'center',
      fontSize: 7,
      color: '#5B6878',
    }),
    content: [
      { text: 'FORM No. 16', style: 'hospital', alignment: 'center' },
      {
        text: 'Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source on salary',
        alignment: 'center',
        fontSize: 8,
        margin: [0, 2, 0, 8],
      },
      f.provisional
        ? {
            text: 'Provisional: the financial year is not over. The final certificate is issued after March.',
            fontSize: 8,
            italics: true,
            color: '#A15C00',
            margin: [0, 0, 0, 6],
          }
        : '',
      { text: 'PART A', style: 'title' },
      {
        columns: [
          {
            table: {
              widths: [110, '*'],
              body: [
                kv('Employer', f.deductor.name),
                kv('Address', f.deductor.address),
                kv('TAN', f.deductor.tan),
                kv('PAN of employer', f.deductor.pan),
              ],
            },
            layout: 'noBorders',
          },
          {
            table: {
              widths: [110, '*'],
              body: [
                kv('Employee', `${f.employee.name} (${f.employee.empNo})`),
                kv('Designation', f.employee.designation),
                kv('PAN of employee', f.employee.pan),
                kv('Assessment year', f.assessmentYear),
                kv('Period', `${f.employee.from} to ${f.employee.to}`),
              ],
            },
            layout: 'noBorders',
          },
        ],
      },
      {
        margin: [0, 8, 0, 0],
        table: {
          headerRows: 1,
          widths: ['auto', '*', '*', '*', '*'],
          body: [
            [
              { text: 'Quarter', style: 'th' },
              { text: 'Amount paid', style: 'th', alignment: 'right' },
              { text: 'Tax deducted', style: 'th', alignment: 'right' },
              { text: 'Tax deposited', style: 'th', alignment: 'right' },
              { text: 'Challans (BSR / date / serial)', style: 'th' },
            ],
            ...f.quarters.map((q) => [
              `Q${q.quarter}`,
              { text: inr(q.amountPaid), alignment: 'right' },
              { text: inr(q.tds), alignment: 'right' },
              { text: inr(q.deposited), alignment: 'right' },
              {
                text:
                  q.challans
                    .map((c) => `${c.bsrCode} / ${c.depositedOn} / ${c.challanSerial}`)
                    .join('\n') || '—',
                fontSize: 7,
              },
            ]),
            [
              { text: 'Total', bold: true },
              {
                text: inr(f.quarters.reduce((t, q) => t + q.amountPaid, 0)),
                alignment: 'right',
                bold: true,
              },
              {
                text: inr(f.quarters.reduce((t, q) => t + q.tds, 0)),
                alignment: 'right',
                bold: true,
              },
              {
                text: inr(f.quarters.reduce((t, q) => t + q.deposited, 0)),
                alignment: 'right',
                bold: true,
              },
              '',
            ],
          ],
        },
        layout: 'lightHorizontalLines',
      },
      { text: 'PART B (Annexure): details of salary paid and tax deducted', style: 'title' },
      {
        text: `Tax regime: ${s.regime === 'OLD' ? 'Old regime' : 'New regime (section 115BAC)'}`,
        fontSize: 8,
        margin: [0, 0, 0, 4],
      },
      {
        table: {
          widths: ['*', 120],
          body: [
            ...s.earnings.map((e) => row(`  ${e.name}`, inr(e.amount))),
            row('1. Gross salary', inr(s.gross), true),
            row('2. Standard deduction u/s 16(ia)', inr(s.standardDeduction)),
            ...(s.regime === 'OLD'
              ? [
                  row('3. Deductions under Chapter VI-A (80C)', inr(s.deductions80C)),
                  row('4. HRA exemption and 80D', inr(s.otherDeductions)),
                ]
              : []),
            row('Total taxable income', inr(s.taxable), true),
            row('Tax on total income, with health and education cess', inr(s.tax)),
            row('Tax deducted at source', inr(s.tdsDeducted)),
            row(s.balance >= 0 ? 'Tax payable' : 'Refund due', inr(Math.abs(s.balance)), true),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      {
        margin: [0, 16, 0, 0],
        text: [
          'Verification: I, ',
          { text: f.deductor.responsibleName ?? '________________', bold: true },
          f.deductor.responsibleDesignation ? `, ${f.deductor.responsibleDesignation}` : '',
          ', certify that the information given above is true, complete and correct and is based on the books of account, documents and TDS statements.',
        ],
        fontSize: 8,
      },
      {
        margin: [0, 28, 0, 0],
        columns: [
          { text: `Date: ${ymd(new Date())}`, fontSize: 8 },
          { text: 'Signature of the person responsible', fontSize: 8, alignment: 'right' },
        ],
      },
    ],
  });
}

export async function sendForm16(res, f) {
  const pdf = await form16Pdf(f);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Form16-${f.employee.empNo}-${f.fy}.pdf"`);
  res.send(pdf);
}
