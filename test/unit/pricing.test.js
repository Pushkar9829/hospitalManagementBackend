import { describe, expect, it } from 'vitest';
import {
  applyDiscount,
  billTotals,
  discountAmount,
  istDate,
  priceLine,
  spreadDiscount,
  taxLine,
} from '../../src/modules/billing/services/pricing.js';

const general = { _id: 'g', code: 'GENERAL' };
const senior = { _id: 's', code: 'SENIOR' };
const svc = (code, rates) => ({
  _id: code,
  code,
  name: code,
  category: 'LAB',
  rates: Object.entries(rates).map(([id, amount]) => ({ priceListId: id, amount })),
});

describe('billing arithmetic', () => {
  it('prices by the payer list and falls back to the default list', () => {
    expect(
      priceLine({
        service: svc('CBC', { g: 30000, s: 25000 }),
        qty: 1,
        priceList: senior,
        defaultList: general,
      }).line.unitPrice,
    ).toBe(25000);
    const fallback = priceLine({
      service: svc('ECG', { g: 30000 }),
      qty: 2,
      priceList: senior,
      defaultList: general,
    });
    expect(fallback).toMatchObject({
      priceListCode: 'GENERAL',
      line: { unitPrice: 30000, gross: 60000 },
    });
    expect(
      priceLine({ service: svc('MRI', {}), qty: 1, priceList: senior, defaultList: general }).error,
    ).toMatch(/no rate/);
  });

  it('spreads a discount to the exact paisa and taxes after discount', () => {
    const lines = [
      { gross: 10000, taxRate: 0, discount: 0 },
      { gross: 650000, taxRate: 5, discount: 0 },
      { gross: 333, taxRate: 18, discount: 0 },
    ];
    const spread = spreadDiscount(lines, 99_999);
    expect(spread.reduce((s, l) => s + l.discount, 0)).toBe(99_999);
    const room = taxLine({ gross: 650000, discount: 0, taxRate: 5 });
    expect(room).toMatchObject({ taxable: 650000, cgst: 16250, sgst: 16250, net: 682500 });
  });

  it('rounds the bill to the rupee and keeps line and bill totals equal', () => {
    const { lines, totals } = applyDiscount(
      [
        { gross: 50050, taxRate: 0, discount: 0 },
        { gross: 45025, taxRate: 0, discount: 0 },
      ],
      discountAmount({ kind: 'PERCENT', value: 15 }, 95075),
    );
    expect(totals.discount).toBe(14261);
    expect(lines.reduce((s, l) => s + l.net, 0)).toBe(totals.net);
    expect(totals.total % 100).toBe(0);
    expect(totals.total - totals.net).toBe(totals.roundOff);
    expect(billTotals(lines, { paid: 20000 }).balance).toBe(totals.total - 20000);
  });

  it('dates cash in IST', () => {
    expect(istDate(new Date('2026-10-09T19:00:00Z'))).toBe('2026-10-10');
  });
});
