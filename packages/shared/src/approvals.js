/**
 * Default maker-checker rules (spec section 4.5, "Default maker-checker rules"). Seeded into
 * every hospital; Super Admins can tune thresholds and expiry in settings.
 *
 * Each level names the permission a checker needs: `approvals:<slug>:l1` / `:l2`. Roles get
 * these through ROLE_GRANTS, so who approves what stays a matter of role configuration.
 * A level with `when` applies only if the request's metrics cross a threshold
 * (`amountOver` in paise, `percentOver` in percent); otherwise it is skipped.
 */
const rule = (action, label, levels, expiryHours = 48) => ({ action, label, levels, expiryHours });
const lvl = (slug, n, label, when) => ({
  permission: `approvals:${slug}:l${n}`,
  label,
  ...(when ? { when } : {}),
});

export const DEFAULT_APPROVAL_RULES = Object.freeze([
  rule('billing.discount', 'Bill discount', [
    lvl('billing-discount', 1, 'Billing Manager'),
    lvl('billing-discount', 2, 'Super Admin', { percentOver: 10, amountOver: 10_000_00 }),
  ]),
  rule('billing.refund', 'Bill cancellation or refund', [
    lvl('billing-refund', 1, 'Billing Manager'),
    lvl('billing-refund', 2, 'Finance Controller', { amountOver: 25_000_00 }),
  ]),
  rule('billing.tariffChange', 'Tariff or price change', [lvl('billing-tariff', 1, 'Super Admin')]),
  rule('ipd.dischargeWithDues', 'Discharge with pending dues', [
    lvl('ipd-discharge-dues', 1, 'Medical Superintendent'),
  ]),
  rule('lab.resultRelease', 'Lab result release', [lvl('lab-result-release', 1, 'Pathologist')]),
  rule('lab.reportAmend', 'Amend released lab report', [
    lvl('lab-report-amend', 1, 'Lab In-charge'),
  ]),
  rule('rad.reportSignoff', 'Radiology report sign-off', [
    lvl('rad-report-signoff', 1, 'Radiologist'),
  ]),
  rule('inventory.stockAdjust', 'Stock adjustment or write-off', [
    lvl('inventory-stock-adjust', 1, 'Pharmacy In-charge'),
    lvl('inventory-stock-adjust', 2, 'Finance', { amountOver: 5_000_00 }),
  ]),
  rule('inventory.purchaseOrder', 'Purchase order', [
    lvl('inventory-po', 1, 'HOD / Admin'),
    lvl('inventory-po', 2, 'Super Admin', { amountOver: 1_00_000_00 }),
  ]),
  rule('inventory.grnVariance', 'GRN with price variance', [
    lvl('inventory-grn-variance', 1, 'Purchase Manager'),
  ]),
  rule('hr.salaryChange', 'Employee salary change', [
    lvl('hr-salary', 1, 'HR Manager'),
    lvl('hr-salary', 2, 'Super Admin'),
  ]),
  rule('hr.profileChange', 'Employee profile change (contact, bank)', [
    lvl('hr-profile', 1, 'HR Manager'),
  ]),
  rule('payroll.release', 'Payroll run release', [
    lvl('payroll-release', 1, 'HR Manager'),
    lvl('payroll-release', 2, 'Finance Controller'),
  ]),
  rule('finance.manualJournal', 'Manual journal entry', [
    lvl('finance-journal', 1, 'Finance Controller'),
  ]),
  rule('patients.merge', 'Patient record merge', [lvl('patients-merge', 1, 'Hospital Admin')]),
  rule('opd.cancellationPolicy', 'OPD cancellation and refund rules', [
    lvl('opd-cancellation', 1, 'Super Admin'),
  ]),
  rule('setup.department', 'Department create or close', [
    lvl('setup-department', 1, 'Super Admin'),
  ]),
  rule('setup.branch', 'Branch create or close', [lvl('setup-branch', 1, 'Super Admin')]),
  rule('users.privilegedRole', 'User with a privileged role', [
    lvl('users-privileged', 1, 'Super Admin'),
  ]),
  rule('users.rolePermission', 'Role permission change', [lvl('users-role', 1, 'Super Admin')]),
  rule('mrd.recordRelease', 'Medical record release', [
    lvl('mrd-release', 1, 'Medical Superintendent'),
  ]),
  rule('mrd.recordDestruction', 'Destruction of records past retention', [
    lvl('mrd-destroy', 1, 'Medical Superintendent'),
    lvl('mrd-destroy', 2, 'Super Admin'),
  ]),
  rule('facility.condemnation', 'Linen or asset condemnation', [
    lvl('facility-condemn', 1, 'Hospital Admin'),
  ]),
  rule('finance.expenseClaim', 'Expense claim or petty cash', [
    lvl('finance-expense', 1, 'Manager'),
    lvl('finance-expense', 2, 'Finance', { amountOver: 10_000_00 }),
  ]),
  rule('quality.incidentClosure', 'Incident closure', [
    lvl('quality-incident', 1, 'Quality Manager'),
  ]),
]);

/** Levels that apply to a request with these metrics ({ amount, percent }). */
export function levelsFor(rule, metrics = {}) {
  return rule.levels.filter((l) => {
    if (!l.when) return true;
    const { amountOver, percentOver } = l.when;
    return (
      (amountOver !== undefined && (metrics.amount ?? 0) > amountOver) ||
      (percentOver !== undefined && (metrics.percent ?? 0) > percentOver)
    );
  });
}
