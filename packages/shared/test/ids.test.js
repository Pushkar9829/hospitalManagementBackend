import { describe, expect, it } from 'vitest';
import {
  financialYear,
  formatAbhaNumber,
  formatSequence,
  formatUhid,
  isAbhaNumber,
  isGstin,
  isMobile,
  maskAadhaar,
  normaliseMobile,
} from '../src/ids.js';

describe('Indian identifiers', () => {
  it('validates mobiles with or without +91', () => {
    expect(isMobile('98765 43210')).toBe(true);
    expect(isMobile('+919876543210')).toBe(true);
    expect(isMobile('5876543210')).toBe(false);
    expect(normaliseMobile('+91 98765-43210')).toBe('9876543210');
  });

  it('checks GSTIN check characters', () => {
    expect(isGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isGstin('27AAPFU0939F1ZA')).toBe(false);
  });

  it('formats ABHA numbers and masks Aadhaar', () => {
    expect(isAbhaNumber('91-4421-7781-2290')).toBe(true);
    expect(formatAbhaNumber('91442177812290')).toBe('91-4421-7781-2290');
    expect(maskAadhaar('1234 5678 4321')).toBe('XXXX XXXX 4321');
  });

  it('computes the Indian financial year in IST', () => {
    expect(financialYear('2026-10-09T10:00:00Z')).toBe('26-27');
    expect(financialYear('2027-03-31T18:00:00Z')).toBe('26-27'); // 31 Mar 23:30 IST
    expect(financialYear('2027-03-31T18:31:00Z')).toBe('27-28'); // 1 Apr 00:01 IST
  });

  it('formats document numbers', () => {
    expect(formatSequence('OP', '26-27', 154)).toBe('OP/26-27/000154');
    expect(formatUhid('CC', 123)).toBe('CC0000123');
  });
});
