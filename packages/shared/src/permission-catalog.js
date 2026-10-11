import { SCREENS } from './catalog/screens.js';
import { ROLE_GRANTS } from './grants.js';
import { DEFAULT_APPROVAL_RULES } from './approvals.js';
import { MODULES } from './modules.js';
import { isPermissionKey } from './permissions.js';

/** Module of a permission key, for grouping in the role editor. */
const MODULE_OF = {
  opd: 'OPD',
  ipd: 'IPD',
  nursing: 'NUR',
  lab: 'LAB',
  rad: 'RAD',
  pharmacy: 'PHR',
  inventory: 'INV',
  hr: 'HRM',
  payroll: 'PAY',
  finance: 'FIN',
  mrd: 'MRD',
  diet: 'DIET',
  facility: 'FAC',
  quality: 'QLT',
  crm: 'CRM',
};

/**
 * Every permission the product knows, grouped by module, for the custom role editor:
 * screen permissions (UI design), role grants and approval levels.
 */
export function permissionCatalog() {
  const keys = new Set();
  for (const s of Object.values(SCREENS)) for (const k of s.permissions) keys.add(k);
  for (const list of Object.values(ROLE_GRANTS)) for (const k of list) keys.add(k);
  for (const r of DEFAULT_APPROVAL_RULES) for (const l of r.levels) keys.add(l.permission);
  const groups = {};
  for (const k of [...keys].filter(isPermissionKey).sort()) {
    const [head, res] = k.split(':');
    // Approval levels group with the module whose work they approve (approvals:lab-result-release:l1 -> LAB).
    const area = head === 'approvals' ? res.split('-')[0] : head;
    const mod = MODULE_OF[area] ?? 'CORE';
    (groups[mod] ??= []).push(k);
  }
  return Object.entries(groups).map(([module, permissions]) => ({
    module,
    name: MODULES[module]?.name ?? module,
    permissions,
  }));
}
