import { describe, expect, it } from 'vitest';
import {
  GRATUITY,
  gratuityAmount,
  serviceYears,
} from '../../src/modules/payroll/services/benefits.service.js';

describe('gratuity (Payment of Gratuity Act)', () => {
  it('counts a part year of more than six months as a full year', () => {
    expect(serviceYears('2020-04-01', '2025-09-30')).toEqual({ completed: 5, counted: 5 });
    expect(serviceYears('2020-04-01', '2025-10-15')).toEqual({ completed: 5, counted: 6 });
    expect(serviceYears('2020-04-01', '2025-03-31')).toEqual({ completed: 4, counted: 5 });
  });

  it('pays 15 days of basic + DA (a month as 26 days) per counted year, up to ₹20 lakh', () => {
    // ₹26,000 a month for 10 years: 26000 x 15 / 26 x 10 = ₹1,50,000.
    expect(gratuityAmount(26_000_00, 10)).toBe(1_50_000_00);
    // A very high wage over a long career stops at the ceiling.
    expect(gratuityAmount(5_00_000_00, 30)).toBe(GRATUITY.ceiling);
  });
});
