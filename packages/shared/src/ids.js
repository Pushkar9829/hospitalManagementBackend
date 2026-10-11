/** Indian identifier checks and document numbering helpers. */

export const isMobile = (v) =>
  /^[6-9]\d{9}$/.test(
    String(v ?? '')
      .replace(/[\s-]/g, '')
      .replace(/^(\+91|0)/, ''),
  );

export const normaliseMobile = (v) =>
  String(v ?? '')
    .replace(/[\s-]/g, '')
    .replace(/^(\+91|0)/, '');

export const isPinCode = (v) => /^[1-9]\d{5}$/.test(String(v ?? ''));

/** ABHA number: 14 digits, shown as 91-4421-7781-2290. */
export const isAbhaNumber = (v) => /^\d{14}$/.test(String(v ?? '').replace(/-/g, ''));

export const formatAbhaNumber = (v) =>
  String(v ?? '')
    .replace(/-/g, '')
    .replace(/^(\d{2})(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3-$4');

/** ABHA address, e.g. ravi.kumar@abdm (also @sbx in sandbox). */
export const isAbhaAddress = (v) => /^[a-z0-9][a-z0-9._]{2,31}@(abdm|sbx)$/i.test(String(v ?? ''));

export const isPan = (v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(v ?? ''));

export const isIfsc = (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v ?? ''));

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN with its mod-36 check character. */
export function isGstin(v) {
  const s = String(v ?? '').toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(s[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === s[14];
}

/** Aadhaar is never stored in full: keep only the last 4 digits. */
export const maskAadhaar = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 12 ? `XXXX XXXX ${d.slice(-4)}` : '';
};

/**
 * Indian financial year label for a date, using IST: 9 Oct 2026 -> "26-27", 15 Mar 2027 -> "26-27".
 */
export function financialYear(date = new Date()) {
  const ist = new Date(new Date(date).getTime() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

/** Document number, e.g. formatSequence('OP', '26-27', 154) -> "OP/26-27/000154". */
export function formatSequence(prefix, fy, n, width = 6) {
  return `${prefix}/${fy}/${String(n).padStart(width, '0')}`;
}

/** UHID, e.g. formatUhid('CC', 123) -> "CC0000123". */
export function formatUhid(prefix, n, width = 7) {
  return `${prefix}${String(n).padStart(width, '0')}`;
}
