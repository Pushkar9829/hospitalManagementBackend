/**
 * Report registry (spec "Reports"): each module registers the reports over its own data; the
 * reports centre lists, runs, exports and schedules them. Modules never read each other's
 * collections for a report: a report lives with the module that owns the data.
 *
 *   registerReport({
 *     code: 'daily-collection', name: 'Daily collection by mode', group: GROUPS.BILLING,
 *     module: 'CORE', permission: 'reports:billing:read', description: '…',
 *     columns: [['mode', 'Mode', 'text'], ['amount', 'Amount', 'money']],
 *     filters: [{ key: 'mode', label: 'Mode', options: async () => ['CASH', 'UPI'] }],
 *     run: async ({ from, to, filters }) => ({ items: [...], kpis: [['total', 'Total', 1000, 'money']] }),
 *   });
 *
 * Column and KPI kinds: text, id, money (paise), count, percent, date, datetime, minutes, days,
 * number, status ({ label, tone }).
 */
export const GROUPS = Object.freeze({
  OPD: 'Front office and OPD',
  IPD: 'IPD and beds',
  CLINICAL: 'Clinical',
  DIAGNOSTICS: 'Diagnostics',
  STOCK: 'Pharmacy and stock',
  BILLING: 'Billing and finance',
  PEOPLE: 'HR and payroll',
  SUPPORT: 'Support and quality',
});
export const GROUP_ORDER = Object.values(GROUPS);

const reports = new Map();

export function registerReport(def) {
  if (!def.code || !def.name || !def.permission || typeof def.run !== 'function')
    throw new Error(`registerReport: incomplete definition ${def.code}`);
  if (reports.has(def.code)) throw new Error(`registerReport: duplicate code ${def.code}`);
  reports.set(def.code, { module: 'CORE', filters: [], description: '', ...def });
}

/**
 * Dashboard tiles: today's live numbers a module contributes to the management dashboard.
 *   registerTile({ key, label, group, module, permission, kind, run: async () => ({ value, note, tone }) })
 */
const tiles = new Map();
export function registerTile(def) {
  if (tiles.has(def.key)) throw new Error(`registerTile: duplicate key ${def.key}`);
  tiles.set(def.key, { module: 'CORE', kind: 'count', ...def });
}
export const allTiles = () => [...tiles.values()];

export const allReports = () => [...reports.values()];
export const reportByCode = (code) => reports.get(code);

/** Status cell helpers. */
export const tone = {
  ok: (label) => ({ label, tone: 'success' }),
  warn: (label) => ({ label, tone: 'warning' }),
  bad: (label) => ({ label, tone: 'critical' }),
  info: (label) => ({ label, tone: 'info' }),
  plain: (label) => ({ label, tone: 'neutral' }),
};

/** IST day bounds for a period of YYYY-MM-DD dates. */
export function period({ from, to }) {
  return {
    from: new Date(`${from}T00:00:00+05:30`),
    to: new Date(`${to}T23:59:59.999+05:30`),
  };
}

/** YYYY-MM-DD in IST. */
export const istDate = (d) =>
  new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
