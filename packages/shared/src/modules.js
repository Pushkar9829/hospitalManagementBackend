/**
 * Subscription modules (spec section "Module catalogue"). CORE is always on.
 * `dependsOn` lists modules that must also be subscribed.
 */
export const MODULES = Object.freeze({
  CORE: { name: 'Core (setup, patients, billing, staff)', dependsOn: [] },
  OPD: { name: 'OPD and appointments', dependsOn: ['CORE'] },
  IPD: { name: 'IPD and beds', dependsOn: ['CORE'] },
  NUR: { name: 'Nursing', dependsOn: ['IPD'] },
  LAB: { name: 'Laboratory', dependsOn: ['CORE'] },
  RAD: { name: 'Radiology', dependsOn: ['CORE'] },
  PHR: { name: 'Pharmacy', dependsOn: ['CORE'] },
  INV: { name: 'Inventory and purchase', dependsOn: ['CORE'] },
  HRM: { name: 'HR, attendance and leave', dependsOn: ['CORE'] },
  PAY: { name: 'Payroll', dependsOn: ['HRM'] },
  FIN: { name: 'Finance and accounts', dependsOn: ['CORE'] },
  MRD: { name: 'Medical records', dependsOn: ['CORE'] },
  DIET: { name: 'Diet and kitchen', dependsOn: ['IPD'] },
  FAC: { name: 'Housekeeping and facility', dependsOn: ['CORE'] },
  QLT: { name: 'Quality and incidents', dependsOn: ['CORE'] },
  CRM: { name: 'Patient CRM', dependsOn: ['CORE'] },
});

export const MODULE_CODES = Object.freeze(Object.keys(MODULES));

export function isModuleCode(code) {
  return Object.hasOwn(MODULES, code);
}

/** Returns the codes missing for `code` to work, given the active set. */
export function missingDependencies(code, active) {
  const set = active instanceof Set ? active : new Set(active);
  return (MODULES[code]?.dependsOn ?? []).filter((d) => !set.has(d));
}
