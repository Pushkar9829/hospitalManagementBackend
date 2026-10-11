import { describe, expect, it } from 'vitest';
import { formatINR, gstSplit, percentOf, roundOff, toPaise } from '../src/money.js';

describe('money', () => {
  it('converts rupees to integer paise', () => {
    expect(toPaise('₹1,009.28')).toBe(100928);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(() => toPaise('abc')).toThrow();
  });

  it('formats in the Indian numbering system', () => {
    expect(formatINR(48235000)).toBe('₹4,82,350.00');
    expect(formatINR(1234567890)).toBe('₹1,23,45,678.90');
    expect(formatINR(99900, { decimals: 0 })).toBe('₹999');
    expect(formatINR(-5312)).toBe('-₹53.12');
  });

  it('splits GST so the parts always add up', () => {
    // Pharmacy MRP is tax-inclusive: ₹1,009.28 at 5% (medicines since 22 Sep 2025).
    const g = gstSplit(100928, 5, { inclusive: true });
    expect(g.taxable + g.tax).toBe(100928);
    expect(g.cgst + g.sgst).toBe(g.tax);
    expect(g.tax).toBe(4806);
    const e = gstSplit(10000, 18, { interState: true });
    expect(e).toMatchObject({ taxable: 10000, tax: 1800, igst: 1800, cgst: 0, gross: 11800 });
    const odd = gstSplit(101, 5);
    expect(odd.cgst + odd.sgst).toBe(odd.tax);
  });

  it('rounds bills to the rupee and reports the round-off', () => {
    expect(roundOff(100928)).toEqual({ rounded: 100900, roundOff: -28 });
    expect(percentOf(106240, 5)).toBe(5312);
  });
});
