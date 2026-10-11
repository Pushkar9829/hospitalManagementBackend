import { describe, expect, it } from 'vitest';
import { rupeesInWords, rupeesInWordsHi } from '../../src/modules/billing/print/documents.js';

describe('amount in words on printed bills', () => {
  it('writes Indian amounts in Hindi', () => {
    expect(rupeesInWordsHi(1009_00)).toBe('एक हज़ार नौ रुपये मात्र');
    expect(rupeesInWordsHi(1_25_50_075_50)).toBe(
      'एक करोड़ पच्चीस लाख पचास हज़ार पचहत्तर रुपये और पचास पैसे मात्र',
    );
    expect(rupeesInWordsHi(710_00)).toBe('सात सौ दस रुपये मात्र');
    expect(rupeesInWordsHi(99)).toBe('शून्य रुपये और निन्यानबे पैसे मात्र');
  });

  it('keeps the English wording', () => {
    expect(rupeesInWords(1009_00)).toBe('One Thousand Nine Rupees only');
  });
});
