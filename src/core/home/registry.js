/**
 * Role home pages (design boards Home*): each module registers the widgets its roles see on
 * their home page. A widget belongs to one or more panels, needs a permission (and its module
 * subscribed), and builds its data for the signed-in user when the home page opens.
 *
 * Kinds and what `build(ctx)` returns:
 *   kpi    { value, format: count|money|percent|text|month, params?, tone?, link? }
 *          The label is the string home.w.<id>.label; `params` fill home.w.<id>.sub.
 *   list   { columns: [{ key, kind }], rows, link? }; kind: text|id|count|money|minutes|status|
 *          date|datetime|time|month. A row may carry its own `link`.
 *          Headers are home.col.<key>; a status cell is { tone, code } (home.status.<code>).
 *   alerts { items: [{ type, tone, params, at?, link? }] } with text home.alert.<type>.
 * ctx: { panel, userId, branchId, today (YYYY-MM-DD, IST), day { start, end }, now }.
 */
const widgets = new Map();

export const PANELS_ALL = Object.freeze([
  'superadmin',
  'admin',
  'medsupt',
  'doctor',
  'hod',
  'clinic',
  'nurse',
  'wardincharge',
  'frontoffice',
  'security',
  'cashier',
  'billingmgr',
  'tpa',
  'lab',
  'phlebotomist',
  'radiology',
  'pharmacy',
  'store',
  'hr',
  'payroll',
  'accounts',
  'auditor',
  'mrd',
  'kitchen',
  'facility',
  'quality',
  'crm',
  'employee',
]);

export function registerHome(def) {
  if (widgets.has(def.id)) throw new Error(`Home widget ${def.id} registered twice`);
  if (!['kpi', 'list', 'alerts'].includes(def.kind)) throw new Error(`Home widget ${def.id}: kind`);
  for (const p of def.panels)
    if (!PANELS_ALL.includes(p)) throw new Error(`Home widget ${def.id}: unknown panel ${p}`);
  widgets.set(def.id, { order: 50, module: 'CORE', ...def });
}

export const homeWidgets = (panel) =>
  [...widgets.values()].filter((w) => w.panels.includes(panel)).sort((a, b) => a.order - b.order);

export const allHomeWidgets = () => [...widgets.values()];

/** Today in IST and the UTC instants of its start and end. */
export function istDay(now = new Date()) {
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return {
    today,
    start: new Date(`${today}T00:00:00+05:30`),
    end: new Date(`${today}T23:59:59.999+05:30`),
  };
}

/** A status cell for a list row. */
export const status = (code, tone = 'neutral') => ({ code, tone });
