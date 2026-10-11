import { DEFAULT_APPROVAL_RULES, hasPermission, levelsFor } from '@hms/shared';
import { AppError, errors } from '../errors/index.js';
import { current } from '../tenancy/context.js';
import { withTransaction } from '../db/model.js';
import { publish } from '../events/events.js';
import { recordAudit } from '../audit/audit.service.js';
import { ApprovalRequest, ApprovalRule } from './approval.model.js';

/** action -> async (request, outcome) applied inside the decision's transaction. */
const appliers = new Map();

/**
 * Modules register how an approved (or rejected) request takes effect. The handler runs in the
 * same transaction as the final decision, so "approved" and "applied" can never disagree; on
 * approval the request is marked APPLIED.
 */
export function onApprovalDecided(action, handler) {
  if (appliers.has(action))
    throw new Error(`An approval handler for ${action} is already registered`);
  appliers.set(action, handler);
}

/** The hospital's rule for an action, falling back to the product default. */
export async function ruleFor(action) {
  const own = await ApprovalRule.findOne({ action }).lean();
  if (own) return own;
  return DEFAULT_APPROVAL_RULES.find((r) => r.action === action) ?? null;
}

/** Copies the default rules into a new hospital (idempotent). */
export async function seedApprovalRules() {
  for (const r of DEFAULT_APPROVAL_RULES) {
    if (!(await ApprovalRule.exists({ action: r.action }))) await ApprovalRule.create([r]);
  }
}

/**
 * Asks for approval when the hospital's rule requires it. Returns the request (the API answers
 * 202 APPROVAL_PENDING) or null when no approval is needed (rule disabled, or no level applies),
 * in which case the caller applies the change straight away.
 */
export async function requestApproval({
  action,
  module,
  entity,
  entityId,
  title,
  before,
  after,
  payload,
  metrics,
  reason,
}) {
  const c = current();
  const rule = await ruleFor(action);
  if (!rule) throw new Error(`No approval rule for ${action}`);
  if (rule.enabled === false) return null;
  const levels = levelsFor(rule, metrics);
  if (!levels.length) return null;
  if (!reason?.trim())
    throw errors.validation([{ path: 'reason', message: 'Give a reason for this request' }]);
  return withTransaction(async () => {
    const open = await ApprovalRequest.exists({
      action,
      entity,
      entityId: String(entityId),
      status: 'PENDING',
      expiresAt: { $gt: new Date() },
    });
    if (open)
      throw new AppError(
        409,
        'APPROVAL_ALREADY_PENDING',
        'This change is already waiting for approval',
      );
    const [req] = await ApprovalRequest.create([
      {
        action,
        module,
        entity,
        entityId: String(entityId),
        title,
        before,
        after,
        payload,
        metrics,
        reason,
        levels,
        currentPermission: levels[0].permission,
        makerId: c.userId,
        makerName: c.userName,
        branchId: c.branchId ?? undefined,
        expiresAt: new Date(Date.now() + (rule.expiryHours ?? 48) * 3_600_000),
      },
    ]);
    await publish('approval.requested', {
      approvalId: String(req._id),
      action,
      entity,
      entityId: String(entityId),
      permission: levels[0].permission,
    });
    return req;
  });
}

async function expireIfDue(req) {
  if (req.status === 'PENDING' && req.expiresAt <= new Date()) {
    req.status = 'EXPIRED';
    req.currentPermission = undefined;
    await appliers.get(req.action)?.(req, 'EXPIRED');
    await req.save();
    await publish('approval.decided', {
      approvalId: String(req._id),
      action: req.action,
      entity: req.entity,
      entityId: req.entityId,
      status: 'EXPIRED',
    });
    return true;
  }
  return false;
}

/**
 * Closes every overdue request of the current hospital and runs its applier (which releases
 * holds, e.g. a bill waiting for a discount). Runs from the worker every 15 minutes, so holds do
 * not wait for someone to open the request.
 */
export async function expireDueApprovals(now = new Date()) {
  const due = await ApprovalRequest.find({ status: 'PENDING', expiresAt: { $lte: now } })
    .select('_id')
    .lean();
  let expired = 0;
  for (const { _id } of due) {
    const done = await withTransaction(async () => {
      const req = await ApprovalRequest.findById(_id);
      return req ? expireIfDue(req) : false;
    });
    if (done) expired += 1;
  }
  return expired;
}

/**
 * Approve or reject the current level. The maker can never check their own request, and one
 * person decides at most one level of a request.
 */
export async function decide(id, { decision, comment, version }) {
  const c = current();
  return withTransaction(async () => {
    const req = await ApprovalRequest.findById(id);
    if (!req) throw errors.notFound('Approval request');
    // Expiry first: an expired request is closed whatever version the client holds.
    if (await expireIfDue(req))
      throw new AppError(409, 'APPROVAL_CLOSED', 'This request has expired. Raise it again.');
    if (req.status !== 'PENDING')
      throw new AppError(
        409,
        'APPROVAL_CLOSED',
        `This request is already ${req.status.toLowerCase()}`,
      );
    if (req.version !== version) throw errors.versionConflict();
    const level = req.levels[req.levelIndex];
    if (!hasPermission(c.permissions, level.permission))
      throw errors.forbidden(`This level needs ${level.label} (${level.permission})`);
    if (String(req.makerId) === String(c.userId))
      throw new AppError(403, 'MAKER_CANNOT_CHECK', 'You cannot approve a request you raised');
    if (req.decisions.some((d) => String(d.by) === String(c.userId))) {
      throw new AppError(
        403,
        'ALREADY_DECIDED',
        'You already decided an earlier level of this request',
      );
    }
    req.decisions.push({
      level: req.levelIndex,
      decision,
      by: c.userId,
      byName: c.userName,
      comment,
      at: new Date(),
    });
    const last = req.levelIndex === req.levels.length - 1;
    if (decision === 'REJECT') req.status = 'REJECTED';
    else if (last) req.status = 'APPROVED';
    else req.levelIndex += 1;
    req.currentPermission =
      req.status === 'PENDING' ? req.levels[req.levelIndex].permission : undefined;
    const applier = appliers.get(req.action);
    if (applier && req.status !== 'PENDING') {
      await applier(req, req.status);
      if (req.status === 'APPROVED') {
        req.status = 'APPLIED';
        req.appliedAt = new Date();
      }
    }
    await req.save();
    await recordAudit({
      action: decision === 'APPROVE' ? 'APPROVE' : 'REJECT',
      entity: req.entity,
      entityId: req.entityId,
      summary: `${req.title} (level ${req.decisions.length} of ${req.levels.length}: ${level.label})`,
      after: { approvalId: String(req._id), comment, status: req.status },
    });
    const event = req.status === 'PENDING' ? 'approval.levelApproved' : 'approval.decided';
    await publish(event, {
      approvalId: String(req._id),
      action: req.action,
      entity: req.entity,
      entityId: req.entityId,
      status: req.status,
      payload: req.payload,
      permission: req.currentPermission,
    });
    return req;
  });
}

/** Maker withdraws their own pending request. */
export async function withdraw(id, { version }) {
  const c = current();
  const req = await ApprovalRequest.findById(id);
  if (!req) throw errors.notFound('Approval request');
  if (String(req.makerId) !== String(c.userId))
    throw errors.forbidden('Only the person who raised the request can withdraw it');
  if (req.version !== version) throw errors.versionConflict();
  if (req.status !== 'PENDING')
    throw new AppError(
      409,
      'APPROVAL_CLOSED',
      `This request is already ${req.status.toLowerCase()}`,
    );
  return withTransaction(async () => {
    req.status = 'WITHDRAWN';
    req.currentPermission = undefined;
    await appliers.get(req.action)?.(req, 'WITHDRAWN');
    await req.save();
    return req;
  });
}

/** Called by the owning module after it applied an approved change. */
export async function markApplied(id) {
  const res = await ApprovalRequest.updateOne(
    { _id: id, status: 'APPROVED' },
    { $set: { status: 'APPLIED', appliedAt: new Date() } },
  );
  if (!res.modifiedCount)
    throw new AppError(409, 'APPROVAL_CLOSED', 'Only an approved request can be applied');
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mongo condition on `currentPermission` matching the user's approval permissions, including
 * wildcards (`approvals:*`, `approvals:billing-discount:*`). Null when the user can decide nothing.
 */
export function checkerCondition(permissions) {
  if (permissions.has('*')) return { $exists: true };
  const exact = [];
  const patterns = [];
  for (const p of permissions) {
    const [mod, res, act] = p.split(':');
    if (mod !== 'approvals' && mod !== '*') continue;
    if (!p.includes('*')) exact.push(p);
    else if (res === '*' || res === undefined) patterns.push(/^approvals:[^:]+:l\d$/);
    else if (act === '*') patterns.push(new RegExp(`^approvals:${escape(res)}:l\\d$`));
  }
  return exact.length || patterns.length ? { $in: [...exact, ...patterns] } : null;
}
