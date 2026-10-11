import { describe, expect, it } from 'vitest';
import {
  annualTax,
  declaredOtherDeductions,
  esi,
  monthlyTds,
  pf,
  pt,
} from '../../src/modules/payroll/data/statutory.js';

describe('payroll statutory rules', () => {
  it('PF at 12% on wages up to the ₹15,000 ceiling', () => {
    expect(pf(20_000_00)).toMatchObject({
      employee: 1_800_00,
      employer: 1_800_00,
      wage: 15_000_00,
    });
    expect(pf(12_000_00)).toMatchObject({ employee: 1_440_00, employer: 1_440_00 });
    expect(
      pf(20_000_00, {
        employeeRate: 12,
        employerRate: 12,
        wageCeiling: 15_000_00,
        applyCeiling: false,
      }).employee,
    ).toBe(2_400_00);
  });

  it('ESI only up to ₹21,000 gross, rounded up to the rupee', () => {
    expect(esi(18_000_00)).toEqual({ employee: 135_00, employer: 585_00 });
    expect(esi(17_333_00)).toEqual({ employee: 130_00, employer: 564_00 }); // 129.9975 → ₹130
    expect(esi(25_000_00)).toEqual({ employee: 0, employer: 0 });
  });

  it('Professional Tax by Maharashtra slab, ₹300 in February', () => {
    expect(pt(7_000_00, { gender: 'M' })).toBe(0);
    expect(pt(9_000_00, { gender: 'M' })).toBe(175_00);
    expect(pt(15_000_00, { gender: 'M' })).toBe(200_00);
    expect(pt(15_000_00, { gender: 'M', month: '02' })).toBe(300_00);
    expect(pt(20_000_00, { gender: 'F' })).toBe(0);
    expect(pt(30_000_00, { gender: 'F' })).toBe(200_00);
    expect(pt(30_000_00, { state: 'KA' })).toBe(200_00);
    expect(pt(30_000_00, { state: 'GJ' })).toBe(0);
  });

  it('income tax: new regime rebate to ₹12 lakh, slabs above, 4% cess; old regime with 80C', () => {
    expect(annualTax(12_00_000)).toEqual({ taxable: 11_25_000, tax: 0 });
    // 15 lakh: taxable 14.25 lakh → 20,000 + 40,000 + 33,750 = 93,750 + 4% = 97,500.
    expect(annualTax(15_00_000)).toEqual({ taxable: 14_25_000, tax: 97_500 });
    // Just above the rebate: marginal relief keeps tax at the income above ₹12 lakh.
    expect(annualTax(12_80_000).tax).toBe(Math.round(5_000 * 1.04));
    // Old regime, 8 lakh with ₹1.5 lakh 80C: taxable 6 lakh → 12,500 + 20,000 = 32,500 + 4%.
    expect(annualTax(8_00_000, { regime: 'OLD', deductions80C: 2_00_000 })).toEqual({
      taxable: 6_00_000,
      tax: 33_800,
    });
    expect(monthlyTds(1_25_000_00)).toBe(8_125_00);
  });

  it('old-regime declarations: 80D capped at ₹25,000 and the least of the three HRA limits', () => {
    // Basic+DA ₹30,000 and HRA ₹12,000 a month; rent ₹15,000 → rent less 10% = ₹1,44,000 a year,
    // HRA received ₹1,44,000, 40% of basic = ₹1,44,000: exemption ₹1,44,000; 80D 30,000 → 25,000.
    expect(
      declaredOtherDeductions(
        { rentMonthly: 15_000, deductions80D: 30_000 },
        { basicDaMonthly: 30_000, hraMonthly: 12_000 },
      ),
    ).toBe(1_69_000);
    expect(
      declaredOtherDeductions(
        { rentMonthly: 2_000 },
        { basicDaMonthly: 30_000, hraMonthly: 12_000 },
      ),
    ).toBe(0);
    const withRent = annualTax(9_00_000, {
      regime: 'OLD',
      deductions80C: 1_50_000,
      otherDeductions: 1_69_000,
    });
    const without = annualTax(9_00_000, { regime: 'OLD', deductions80C: 1_50_000 });
    expect(withRent.taxable).toBe(without.taxable - 1_69_000);
    expect(withRent.tax).toBeLessThan(without.tax);
  });
});
