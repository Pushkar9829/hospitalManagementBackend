import { describe, expect, it } from 'vitest';
import { prorate, quote, unmetDependencies, withGst } from '../src/pricing-book.js';

describe('platform pricing', () => {
  it('reproduces the spec proration example: Laboratory added on 11 Oct of a 1-30 Oct cycle', () => {
    const charge = prorate(2_500_00, {
      periodStart: '2026-10-01T00:00:00+05:30',
      periodEnd: '2026-10-30T23:59:59+05:30',
      at: new Date('2026-10-11T10:00:00+05:30'),
    });
    expect(charge).toBe(1_666_67);
    expect(withGst([{ amount: charge }])).toMatchObject({ gst: 300_00, total: 1_966_67 });
  });

  it('quotes a plan with a-la-carte add-ons and annual pricing', () => {
    const q = quote({
      plan: 'CLINIC',
      addOns: ['RAD', 'LAB'],
      quantities: { branches: 2, beds: 0, entities: 1, users: 12 },
    });
    expect(q.lines.map((l) => l.item)).toEqual(['PLAN:CLINIC', 'MODULE:RAD']);
    expect(q.subtotal).toBe(6_000_00 + 2 * 2_500_00);
    const annual = quote({
      plan: 'HOSPITAL',
      cycle: 'ANNUAL',
      quantities: { branches: 1, beds: 50, entities: 1, users: 40 },
    });
    expect(annual.subtotal).toBe(10 * 35_000_00);
    const alacarte = quote({
      addOns: ['CORE', 'IPD', 'HRM'],
      quantities: { branches: 1, beds: 6, entities: 1, users: 14 },
    });
    expect(alacarte.lines.map((l) => [l.item, l.amount])).toEqual([
      ['MODULE:CORE', 3_000_00],
      ['ADDON:USERS', 4 * 150_00],
      ['MODULE:IPD', 10 * 40_00],
    ]);
  });

  it('checks module dependencies', () => {
    expect(unmetDependencies(['CORE', 'PAY'])).toEqual([{ module: 'PAY', needs: 'HRM' }]);
    expect(unmetDependencies(['CORE', 'IPD', 'NUR'])).toEqual([]);
  });
});
