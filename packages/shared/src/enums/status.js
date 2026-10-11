/** Status catalogues: every status has a label and a tone; badges always show both. */
const freeze = (o) =>
  Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v)])));

export const BED_STATUS = freeze({
  AVAILABLE: { label: 'Available', tone: 'success' },
  OCCUPIED: { label: 'Occupied', tone: 'neutral' },
  RESERVED: { label: 'Reserved', tone: 'info' },
  DISCHARGE_DUE: { label: 'Discharge due', tone: 'warning' },
  CLEANING: { label: 'Cleaning', tone: 'warning' },
  MAINTENANCE: { label: 'Maintenance', tone: 'neutral' },
  BLOCKED: { label: 'Blocked', tone: 'neutral' },
});

export const BILL_STATUS = freeze({
  DRAFT: { label: 'Draft', tone: 'neutral' },
  FINAL: { label: 'Due', tone: 'warning' },
  DUE: { label: 'Due', tone: 'warning' },
  PARTIALLY_PAID: { label: 'Partly paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  REFUNDED: { label: 'Refunded', tone: 'info' },
});

export const APPROVAL_STATUS = freeze({
  PENDING: { label: 'Pending approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'critical' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
});

export const TENANT_STATUS = freeze({
  TRIAL: { label: 'Trial', tone: 'info' },
  ACTIVE: { label: 'Active', tone: 'success' },
  PAST_DUE: { label: 'Payment due', tone: 'warning' },
  READ_ONLY: { label: 'Read-only', tone: 'warning' },
  SUSPENDED: { label: 'Suspended', tone: 'critical' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
});

export const USER_STATUS = freeze({
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'warning' },
  ACTIVE: { label: 'Active', tone: 'success' },
  INVITED: { label: 'Invited', tone: 'info' },
  LOCKED: { label: 'Locked', tone: 'warning' },
  DISABLED: { label: 'Disabled', tone: 'neutral' },
});

export function statusMeta(catalogue, code) {
  return catalogue[code] ?? { label: code ?? '-', tone: 'neutral' };
}
