import { describe, expect, it } from 'vitest';
import { westgard } from '../../src/modules/lab/services/qc.service.js';
import { resistanceAlert } from '../../src/modules/lab/services/registers.service.js';

describe('laboratory rules', () => {
  it('applies the analyser’s Westgard rules', () => {
    expect(westgard(0.5, 1)).toEqual({ status: 'IN_CONTROL', rules: [] });
    expect(westgard(2.4, 0)).toEqual({ status: 'WARNING', rules: ['1-2s'] });
    expect(westgard(3.2, 0)).toEqual({ status: 'REJECTED', rules: ['1-3s'] });
    expect(westgard(2.4, 2.2)).toEqual({ status: 'REJECTED', rules: ['2-2s'] });
    // 2-2s not chosen for this analyser: a warning only.
    expect(westgard(2.4, 2.2, { warning: '1-2s', reject: ['1-3s'] }).status).toBe('WARNING');
    // R-4s: two runs more than 4 SD apart.
    expect(westgard(2.1, -2.1, { warning: '1-2s', reject: ['1-3s', 'R-4s'] })).toEqual({
      status: 'REJECTED',
      rules: ['R-4s'],
    });
  });

  it('names alert organisms from the sensitivity pattern', () => {
    const c = (organism, rows) => ({
      organism,
      sensitivity: rows.map(([antibiotic, result]) => ({ antibiotic, result })),
    });
    expect(resistanceAlert(c('Staphylococcus aureus', [['Cefoxitin', 'R']]))).toBe('MRSA');
    expect(resistanceAlert(c('Enterococcus faecium', [['Vancomycin', 'R']]))).toBe('VRE');
    expect(resistanceAlert(c('Klebsiella pneumoniae', [['Meropenem', 'R']]))).toBe('CRE');
    expect(resistanceAlert(c('Acinetobacter baumannii', [['Imipenem', 'R']]))).toBe('CRAB');
    expect(resistanceAlert(c('Escherichia coli', [['Ceftriaxone', 'R']]))).toBe('ESBL');
    expect(resistanceAlert(c('Escherichia coli', [['Ceftriaxone', 'S']]))).toBeNull();
  });
});
