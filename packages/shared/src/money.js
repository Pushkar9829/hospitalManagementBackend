/**
 * Money is stored as integer paise (spec "Data design rules"); never floats.
 * These helpers convert at the edges and format in the Indian numbering system.
 */
export function toPaise(rupees) {
  if (typeof rupees === 'string') rupees = rupees.replace(/[₹,\s]/g, '');
  const n = Number(rupees);
  if (!Number.isFinite(n)) throw new TypeError(`Not an amount: ${rupees}`);
  return Math.round(n * 100);
}

export function fromPaise(paise) {
  assertPaise(paise);
  return paise / 100;
}

export function assertPaise(paise) {
  if (!Number.isSafeInteger(paise)) throw new TypeError(`Paise must be an integer: ${paise}`);
}

/** 12345678 paise -> "₹1,23,456.78" (Indian grouping: last 3 digits, then pairs). */
export function formatINR(paise, { symbol = true, decimals = 2 } = {}) {
  assertPaise(paise);
  const neg = paise < 0;
  const abs = Math.abs(paise);
  let rupees = Math.floor(abs / 100);
  let fraction = abs % 100;
  if (decimals === 0) {
    if (fraction >= 50) rupees += 1;
    fraction = 0;
  }
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  const frac = decimals === 0 ? '' : `.${String(fraction).padStart(2, '0')}`;
  return `${neg ? '-' : ''}${symbol ? '₹' : ''}${grouped}${frac}`;
}

/** Percentage of an amount, rounded half up to the paisa. `rate` is a percent, e.g. 5 or 18. */
export function percentOf(paise, rate) {
  assertPaise(paise);
  return Math.round((paise * rate) / 100);
}

/**
 * Splits GST for an amount.
 * - `inclusive: true` treats `paise` as tax-inclusive (MRP pricing in pharmacy).
 * - Intra-state supply splits into CGST + SGST halves; inter-state is IGST.
 * Returns integer paise that always add up: taxable + tax === gross.
 */
export function gstSplit(paise, rate, { inclusive = false, interState = false } = {}) {
  assertPaise(paise);
  if (rate < 0) throw new RangeError('GST rate cannot be negative');
  let taxable;
  let tax;
  if (inclusive) {
    taxable = Math.round((paise * 100) / (100 + rate));
    tax = paise - taxable;
  } else {
    taxable = paise;
    tax = percentOf(paise, rate);
  }
  const gross = taxable + tax;
  if (interState) return { taxable, tax, gross, igst: tax, cgst: 0, sgst: 0 };
  const cgst = Math.floor(tax / 2);
  return { taxable, tax, gross, igst: 0, cgst, sgst: tax - cgst };
}

/** Rounds to the nearest rupee and returns the round-off, as printed on Indian bills. */
export function roundOff(paise) {
  assertPaise(paise);
  const rounded = Math.round(paise / 100) * 100;
  return { rounded, roundOff: rounded - paise };
}
