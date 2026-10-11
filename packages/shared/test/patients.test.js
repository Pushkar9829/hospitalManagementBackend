import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  duplicateScore,
  DUPLICATE_THRESHOLD,
  estimatedDob,
  isSeniorCitizen,
  jaroWinkler,
} from '../src/patients.js';
import { patientCreateInput } from '../src/schemas/patients.js';

const now = new Date('2026-10-10T00:00:00Z');

describe('patient ages', () => {
  it('stores age as an estimated date of birth and prints Indian case-sheet ages', () => {
    expect(ageLabel(estimatedDob({ years: 47 }, now), now)).toBe('47Y');
    expect(ageLabel(estimatedDob({ years: 1, months: 2 }, now), now)).toBe('14M');
    expect(ageLabel(estimatedDob({ days: 12 }, now), now)).toBe('12D');
    expect(ageLabel(new Date('1979-05-14'), now)).toBe('47Y');
  });

  it('knows a senior citizen is 60 or older', () => {
    expect(isSeniorCitizen(new Date('1966-10-09'), now)).toBe(true);
    expect(isSeniorCitizen(new Date('1979-05-14'), now)).toBe(false);
  });
});

describe('duplicate detection', () => {
  const ravi = { first: 'Ravi', last: 'Kumar', mobile: '9876543210', dob: '1979-05-14' };
  it('warns on the same mobile with a similar name, or the same ID', () => {
    expect(duplicateScore(ravi, { ...ravi, last: 'Kumaar' })).toBeGreaterThan(DUPLICATE_THRESHOLD);
    expect(duplicateScore({ first: 'X', idHashes: ['h1'] }, { first: 'Y', idHashes: ['h1'] })).toBe(
      1,
    );
    expect(jaroWinkler('Ravi Kumar', 'Sana Sheikh')).toBeLessThan(0.6);
  });

  it('does not flag family members who share a mobile', () => {
    expect(duplicateScore(ravi, { ...ravi, first: 'Priya', dob: '1982-01-01' })).toBeLessThan(
      DUPLICATE_THRESHOLD,
    );
    expect(duplicateScore({ first: 'Baby of Priya', mobile: ravi.mobile }, ravi)).toBeLessThan(
      DUPLICATE_THRESHOLD,
    );
  });
});

describe('registration input', () => {
  it('accepts a quick registration with age only and rejects allergies with "no known allergies"', () => {
    const quick = patientCreateInput.parse({
      registrationType: 'QUICK',
      name: { first: 'Ravi' },
      gender: 'M',
      mobile: '+91 98765 43210',
      birth: { age: { years: 47 } },
    });
    expect(quick.mobile).toBe('9876543210');
    const bad = patientCreateInput.safeParse({
      registrationType: 'FULL',
      name: { first: 'Ravi' },
      gender: 'M',
      mobile: '9876543210',
      birth: { dob: '1979-05-14' },
      allergies: [{ substance: 'Penicillin', severity: 'MODERATE' }],
      noKnownAllergies: true,
    });
    expect(bad.success).toBe(false);
    expect(
      patientCreateInput.safeParse({
        registrationType: 'QUICK',
        name: { first: 'A' },
        gender: 'M',
        mobile: '9876543210',
        birth: {},
      }).success,
    ).toBe(false);
  });
});
