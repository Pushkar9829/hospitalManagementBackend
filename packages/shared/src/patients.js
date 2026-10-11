/** Patient helpers shared by the API and the web app. */

const DAY = 86_400_000;

/**
 * Spec 5.4: "Age is stored as an estimated date of birth so it stays correct over time."
 * Mid-year for years-only ages, so the age is right for half a year either side.
 */
export function estimatedDob({ years = 0, months = 0, days = 0 }, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() - days);
  if (years && !months && !days) d.setUTCMonth(d.getUTCMonth() - 6);
  return d;
}

/** Whole years, months and days between dob and now. */
export function ageParts(dob, now = new Date()) {
  const b = new Date(dob);
  let years = now.getUTCFullYear() - b.getUTCFullYear();
  let months = now.getUTCMonth() - b.getUTCMonth();
  let days = now.getUTCDate() - b.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days, totalDays: Math.floor((now - b) / DAY) };
}

/** "47Y", "14M" under two years, "12D" under a month (as printed on Indian case sheets). */
export function ageLabel(dob, now = new Date()) {
  if (!dob) return '';
  const a = ageParts(dob, now);
  if (a.years >= 2) return `${a.years}Y`;
  if (a.totalDays >= 31) return `${a.years * 12 + a.months}M`;
  return `${Math.max(a.totalDays, 0)}D`;
}

export const isMinor = (dob, now = new Date()) => ageParts(dob, now).years < 18;
/** Senior citizen in India: 60 years or older. */
export const isSeniorCitizen = (dob, now = new Date()) => ageParts(dob, now).years >= 60;

export function fullName({ title, first, middle, last } = {}) {
  return [title, first, middle, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Lower-case letters only, for matching "Ravi  Kumar" and "ravi kumar". */
export const nameKey = (n) =>
  String(n ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Jaro-Winkler similarity in [0, 1]; tolerant of typos such as "Kumar" / "Kumaar". */
export function jaroWinkler(a, b) {
  a = nameKey(a);
  b = nameKey(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const range = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(i + range + 1, b.length); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export const DUPLICATE_THRESHOLD = 0.75;

/**
 * Likelihood two registrations are the same person (spec 5.4: same mobile and similar name, or
 * same ID number). Above DUPLICATE_THRESHOLD the desk sees a warning; nothing merges silently.
 * Families in India often share one mobile, so the first name must match on its own:
 * Ravi Kumar and Priya Kumar on the same number are different people.
 * Inputs: { first, last, mobile, dob, idHashes[] }.
 */
export function duplicateScore(a, b) {
  if (a.idHashes?.some((h) => b.idHashes?.includes(h))) return 1;
  const first = jaroWinkler(a.first, b.first);
  if (first < 0.85) return 0;
  const last = a.last && b.last ? jaroWinkler(a.last, b.last) : 0.9;
  const name = first * 0.7 + last * 0.3;
  const sameMobile = Boolean(a.mobile) && a.mobile === b.mobile;
  const sameDob = a.dob && b.dob && Math.abs(new Date(a.dob) - new Date(b.dob)) <= 366 * DAY;
  if (sameMobile) return Math.min(0.99, 0.55 + name * 0.35 + (sameDob ? 0.09 : 0));
  if (sameDob && name >= 0.93) return 0.78;
  return 0;
}
