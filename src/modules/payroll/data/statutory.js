/**
 * Indian statutory deductions, all in paise. Rates and slabs are defaults the hospital can
 * change in payroll settings; confirm with the payroll consultant before go-live.
 *
 * - PF: 12% of basic + DA for the employee and 12% for the employer, on wages up to ₹15,000 when
 *   the ceiling applies.
 * - ESI: 0.75% employee and 3.25% employer of gross, when gross is ₹21,000 or less; rounded up
 *   to the rupee.
 * - Professional Tax: by state slab (Maharashtra and Karnataka here); February is ₹300 in
 *   Maharashtra so the year totals ₹2,500.
 * - TDS: annual tax on the projected salary under the new regime (FY 2025-26 slabs, standard
 *   deduction ₹75,000, rebate up to ₹12 lakh with marginal relief) or the old regime (standard
 *   deduction ₹50,000, 80C up to ₹1.5 lakh, rebate up to ₹5 lakh), plus 4% cess, spread evenly
 *   over the months.
 */
export const DEFAULT_STATUTORY = {
  pf: { employeeRate: 12, employerRate: 12, wageCeiling: 15_000_00, applyCeiling: true },
  esi: { employeeRate: 0.75, employerRate: 3.25, wageLimit: 21_000_00 },
  pt: {
    MH: {
      M: [
        [7_500_00, 0],
        [10_000_00, 175_00],
        [null, 200_00, 300_00],
      ],
      F: [
        [25_000_00, 0],
        [null, 200_00, 300_00],
      ],
    },
    KA: {
      ANY: [
        [24_999_00, 0],
        [null, 200_00],
      ],
    },
  },
  tds: {
    NEW: {
      standardDeduction: 75_000,
      slabs: [
        [4_00_000, 0],
        [8_00_000, 5],
        [12_00_000, 10],
        [16_00_000, 15],
        [20_00_000, 20],
        [24_00_000, 25],
        [null, 30],
      ],
      rebateUpto: 12_00_000,
    },
    OLD: {
      standardDeduction: 50_000,
      max80C: 1_50_000,
      slabs: [
        [2_50_000, 0],
        [5_00_000, 5],
        [10_00_000, 20],
        [null, 30],
      ],
      rebateUpto: 5_00_000,
    },
    cessRate: 4,
  },
  overtimeMultiplier: 2,
  nightAllowance: 300_00, // per night shift worked
};

export function pf(wage, cfg = DEFAULT_STATUTORY.pf) {
  const base = cfg.applyCeiling ? Math.min(wage, cfg.wageCeiling) : wage;
  return {
    employee: Math.round((base * cfg.employeeRate) / 100),
    employer: Math.round((base * cfg.employerRate) / 100),
    wage: base,
  };
}

const ceilRupee = (paise) => Math.ceil(paise / 100) * 100;

/** ESI applies when the month's gross is within the wage limit. */
export function esi(gross, cfg = DEFAULT_STATUTORY.esi) {
  if (gross > cfg.wageLimit || gross <= 0) return { employee: 0, employer: 0 };
  return {
    employee: ceilRupee((gross * cfg.employeeRate) / 100),
    employer: ceilRupee((gross * cfg.employerRate) / 100),
  };
}

/** Professional Tax for the month by state slab; [upTo, amount, februaryAmount]. */
export function pt(
  gross,
  { state = 'MH', gender = 'M', month = '01' } = {},
  table = DEFAULT_STATUTORY.pt,
) {
  const st = table[state];
  if (!st) return 0;
  const slabs = st[gender === 'F' ? 'F' : 'M'] ?? st.ANY ?? st.M;
  for (const [upTo, amount, feb] of slabs)
    if (upTo == null || gross <= upTo) return month === '02' && feb != null ? feb : amount;
  return 0;
}

function slabTax(income, slabs) {
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of slabs) {
    const top = upTo ?? Infinity;
    if (income > lower) tax += ((Math.min(income, top) - lower) * rate) / 100;
    lower = top;
    if (income <= top) break;
  }
  return tax;
}

/**
 * Annual income tax in rupees on an annual salary in rupees. Returns { taxable, tax }.
 * `deductions80C` applies under the old regime only.
 */
export function annualTax(
  annualSalary,
  { regime = 'NEW', deductions80C = 0, otherDeductions = 0 } = {},
  cfg = DEFAULT_STATUTORY.tds,
) {
  const r = cfg[regime];
  const taxable = Math.max(
    0,
    annualSalary -
      r.standardDeduction -
      (regime === 'OLD' ? Math.min(deductions80C, r.max80C) + otherDeductions : 0),
  );
  let tax = slabTax(taxable, r.slabs);
  if (taxable <= r.rebateUpto) tax = 0;
  else if (regime === 'NEW') tax = Math.min(tax, taxable - r.rebateUpto); // marginal relief
  tax = Math.round(tax * (1 + cfg.cessRate / 100));
  return { taxable, tax };
}

/** This month's TDS in paise: the projected year's tax spread evenly over 12 months. */
export function monthlyTds(monthlyGross, opts, cfg) {
  const { tax } = annualTax(Math.round((monthlyGross * 12) / 100), opts, cfg);
  return Math.round(tax / 12) * 100;
}

/**
 * Old-regime deductions besides 80C from an employee's declaration, in rupees a year: 80D health
 * insurance (up to ₹25,000) and the HRA exemption (least of HRA received, rent paid less 10% of
 * basic and DA, and 40% of basic and DA; non-metro).
 */
export function declaredOtherDeductions(
  { rentMonthly = 0, deductions80D = 0 },
  { basicDaMonthly, hraMonthly },
) {
  const d80D = Math.min(deductions80D, 25_000);
  const hra = Math.max(
    0,
    Math.min(
      hraMonthly * 12,
      rentMonthly * 12 - 0.1 * basicDaMonthly * 12,
      0.4 * basicDaMonthly * 12,
    ),
  );
  return Math.round(d80D + hra);
}
