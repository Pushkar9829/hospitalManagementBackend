import { describe, expect, it } from 'vitest';
import { gstStateCode } from '@hms/shared';
import { taxSplit } from '../../src/platform/services/invoices.service.js';

// The platform company is in Maharashtra (PLATFORM_STATE default, code 27).
describe('platform invoice GST', () => {
  it('finds the GST state from a GSTIN, a code or a name', () => {
    expect(gstStateCode('29AABCU9603R1ZM')).toBe('29');
    expect(gstStateCode('Karnataka')).toBe('29');
    expect(gstStateCode('tamil nadu')).toBe('33');
    expect(gstStateCode('Andaman & Nicobar Islands')).toBe('35');
    expect(gstStateCode('07')).toBe('07');
    expect(gstStateCode('Atlantis')).toBeNull();
    expect(gstStateCode('')).toBeNull();
  });

  it('charges CGST and SGST inside the state and IGST across states', () => {
    expect(taxSplit(18_000, { gstin: '27AAACH1234M1Z5' })).toMatchObject({
      kind: 'INTRA',
      cgst: 9_000,
      sgst: 9_000,
      igst: 0,
      supplyState: '27',
    });
    expect(taxSplit(18_000, { state: 'Karnataka' })).toMatchObject({
      kind: 'INTER',
      igst: 18_000,
      cgst: 0,
      sgst: 0,
      supplyState: '29',
      supplierState: '27',
    });
    // The GSTIN decides over a stale state name.
    expect(taxSplit(18_000, { gstin: '29AABCU9603R1ZM', state: 'Maharashtra' }).kind).toBe('INTER');
    // Unknown state: the supplier's location applies; an odd paisa goes to SGST.
    expect(taxSplit(18_001, {})).toMatchObject({ kind: 'INTRA', cgst: 9_000, sgst: 9_001 });
  });
});
