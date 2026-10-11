import { PANELS } from './catalog/panels.js';

/**
 * Permissions each system role gets beyond what its menu implies (spec section 4.3, role to
 * module access matrix). The catalogue derives screen access from the UI design; this table adds
 * the actions a role performs. Each module adds its rows when it is built.
 */
export const ROLE_GRANTS = Object.freeze({
  admin: [
    'settings:branch:*',
    'settings:department:*',
    'settings:master:*',
    'settings:user:*',
    'settings:role:*',
    'settings:hospital:*',
    'settings:approval:read',
    'patients:*',
    'audit:log:read',
    'approvals:patients-merge:l1',
    'approvals:inventory-po:l1',
    'approvals:facility-condemn:l1',
    'opd:schedule:*',
    'opd:settings:*',
    'opd:appointment:read',
    'reports:opd:read',
    'ipd:bed:block',
    'reports:ipd:read',
    'reports:lab:read',
    'rad:settings:read',
    'reports:inventory:read',
    'reports:pharmacy:read',
    'reports:billing:read',
    'reports:mrd:read',
    'reports:nursing:read',
    'reports:quality:read',
    'reports:facility:read',
    'reports:diet:read',
    'reports:hr:read',
    'reports:crm:read',
    'reports:rad:read',
  ],
  medsupt: [
    'patients:patient:read',
    'approvals:ipd-discharge-dues:l1',
    'approvals:mrd-release:l1',
    'approvals:mrd-destroy:l1',
    'reports:mrd:read',
    'reports:nursing:read',
    'reports:quality:read',
    'reports:rad:read',
    'reports:facility:read',
    'reports:diet:read',
  ],
  doctor: [
    'patients:patient:read',
    'patients:patient:update',
    'opd:consultation:read',
    'opd:consultation:write',
    'opd:schedule:read',
    'lab:order:create',
    'lab:order:cancel',
    'lab:result:acknowledge',
    'rad:order:create',
    'rad:order:cancel',
    'rad:report:acknowledge',
  ],
  hod: [
    'patients:patient:read',
    'approvals:inventory-po:l1',
    'approvals:finance-expense:l1',
    'opd:consultation:read',
    'opd:consultation:write',
    'opd:schedule:read',
    'reports:opd:read',
  ],
  clinic: ['patients:*', 'billing:*', 'settings:master:*', 'opd:*', 'reports:opd:read'],
  nurse: [
    'patients:patient:read',
    'opd:vitals:create',
    'opd:appointment:read',
    'ipd:admission:read',
    'lab:critical:log',
    'pharmacy:return:request',
    'inventory:indent:create',
  ],
  wardincharge: [
    'patients:patient:read',
    'ipd:bed:block',
    'ipd:admission:read',
    'hr:roster:write',
    'hr:employee:read',
    'pharmacy:return:request',
    'inventory:indent:create',
    'reports:nursing:read',
  ],
  frontoffice: [
    'patients:patient:create',
    'patients:patient:update',
    'patients:patient:read',
    'patients:merge:request',
    'opd:appointment:*',
    'opd:visit:create',
    'opd:schedule:read',
    'lab:homevisit:create',
  ],
  cashier: [
    'patients:patient:read',
    'patients:patient:create',
    'billing:bill:read',
    'billing:bill:create',
    'billing:bill:finalize',
    'billing:bill:print',
    'billing:payment:create',
    'billing:payment:read',
    'billing:deposit:create',
    'billing:deposit:read',
    'billing:discount:request',
    'billing:cancel:request',
    'billing:refund:pay',
    'billing:refund:read',
    'billing:shift:open',
    'billing:shift:close',
    'billing:shift:read',
    'opd:appointment:read',
    'billing:ip:read',
    'billing:ip:create',
    'billing:ip:finalize',
    'ipd:admission:read',
  ],
  billingmgr: [
    'patients:patient:read',
    'billing:*',
    'ipd:admission:read',
    'approvals:billing-discount:l1',
    'approvals:billing-refund:l1',
    'reports:finance:read',
    'reports:billing:read',
  ],
  tpa: ['patients:patient:read', 'ipd:preauth:*'],
  lab: [
    'patients:patient:read',
    'approvals:lab-result-release:l1',
    'approvals:lab-report-amend:l1',
  ],
  phlebotomist: [
    'patients:patient:read',
    'lab:sample:collect',
    'lab:homevisit:read',
    'lab:homevisit:update',
  ],
  radiology: ['patients:patient:read', 'approvals:rad-report-signoff:l1', 'reports:rad:read'],
  pharmacy: [
    'patients:patient:read',
    'approvals:inventory-stock-adjust:l1',
    'pharmacy:order:verify',
    'reports:pharmacy:read',
  ],
  store: ['approvals:inventory-grn-variance:l1', 'reports:inventory:read'],
  hr: [
    'approvals:hr-salary:l1',
    'approvals:hr-profile:l1',
    'approvals:payroll-release:l1',
    'reports:hr:read',
    'reports:payroll:read',
  ],
  accounts: [
    'approvals:billing-refund:l2',
    'approvals:payroll-release:l2',
    'approvals:finance-journal:l1',
    'approvals:inventory-stock-adjust:l2',
    'approvals:finance-expense:l2',
    'reports:finance:read',
    'reports:payroll:read',
    'reports:billing:read',
  ],
  auditor: ['audit:log:read', 'audit:log:export', 'approvals:inbox:read-all'],
  mrd: ['patients:patient:read', 'reports:mrd:read', 'reports:ipd:read'],
  facility: ['ipd:bed:clean', 'reports:facility:read'],
  quality: [
    'approvals:quality-incident:l1',
    'reports:quality:read',
    'reports:mrd:read',
    'reports:nursing:read',
    'reports:lab:read',
    'reports:ipd:read',
    'reports:facility:read',
    'reports:crm:read',
  ],
  crm: ['patients:patient:read', 'reports:crm:read', 'reports:opd:read', 'lab:homevisit:create'],
  kitchen: ['reports:diet:read'],
  payroll: ['reports:payroll:read', 'reports:hr:read'],
});

/**
 * Menu-derived permissions that are too broad for a role and are replaced by its grants:
 * the cashier opens the Billing screens but must not verify shifts; the phlebotomist opens the
 * home-visit screens but must not book or assign visits.
 */
export const ROLE_REVOKE = Object.freeze({
  cashier: ['billing:*', 'billing:ip:*', 'billing:shift:*'],
  // The phone screens' menu implies every home-visit action; a phlebotomist only reads and
  // updates their own visits (booking and assigning stay with the desk and the lab).
  phlebotomist: ['lab:homevisit:*'],
});

/** Role codes that count as privileged: creating such a user needs Super Admin approval. */
export const PRIVILEGED_ROLES = Object.freeze([
  'superadmin',
  'admin',
  'billingmgr',
  'accounts',
  'hr',
  'payroll',
]);

/** Default permissions of a system role: menu-derived permissions plus explicit grants. */
export function systemRolePermissions(panel) {
  const revoke = new Set(ROLE_REVOKE[panel] ?? []);
  const base = (PANELS[panel]?.permissions ?? []).filter((k) => !revoke.has(k));
  return [...new Set([...base, ...(ROLE_GRANTS[panel] ?? [])])].sort();
}

/** Default concurrent sessions per role (spec 4.4): doctors 2 devices, cashiers 1. */
export const MAX_SESSIONS = Object.freeze({ doctor: 2, cashier: 1 });
