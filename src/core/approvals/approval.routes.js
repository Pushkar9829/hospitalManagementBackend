import { z } from 'zod';
import { hasPermission } from '@hms/shared';
import { objectId, pageQuery } from '@hms/shared/schemas';
import { defineRoutes } from '../http/route.js';
import { paginate } from '../http/paginate.js';
import { current } from '../tenancy/context.js';
import { errors } from '../errors/index.js';
import { ApprovalRequest, ApprovalRule } from './approval.model.js';
import { checkerCondition, decide, withdraw } from './approval.service.js';

const READ_ALL = 'approvals:inbox:read-all';

/** Levels with their decisions, as in the spec's example response. */
export function toDto(r) {
  const expired = r.status === 'PENDING' && new Date(r.expiresAt) <= new Date();
  return {
    id: String(r._id),
    action: r.action,
    module: r.module,
    entity: r.entity,
    entityId: r.entityId,
    title: r.title,
    before: r.before,
    after: r.after,
    payload: r.payload,
    metrics: r.metrics,
    reason: r.reason,
    status: expired ? 'EXPIRED' : r.status,
    levelIndex: r.levelIndex,
    levels: r.levels.map((l, i) => {
      const d = r.decisions.find((x) => x.level === i);
      return {
        label: l.label,
        permission: l.permission,
        ...(d ? { decision: d.decision, decidedBy: d.byName, comment: d.comment, at: d.at } : {}),
      };
    }),
    makerId: String(r.makerId),
    makerName: r.makerName,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    version: r.version,
  };
}

export function boxFilter(box) {
  const c = current();
  if (box === 'mine') return { makerId: c.userId };
  if (box === 'all') {
    if (!hasPermission(c.permissions, READ_ALL))
      throw errors.forbidden(`You need the permission ${READ_ALL}`);
    return {};
  }
  const cond = checkerCondition(c.permissions);
  if (!cond) return { _id: null };
  return {
    status: 'PENDING',
    expiresAt: { $gt: new Date() },
    currentPermission: cond,
    makerId: { $ne: c.userId },
    'decisions.by': { $ne: c.userId },
  };
}

const listQuery = pageQuery.extend({
  box: z.enum(['inbox', 'mine', 'all']).default('inbox'),
  status: z.enum(['PENDING', 'APPROVED', 'APPLIED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']).optional(),
  module: z.string().max(8).optional(),
});

export const approvalRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/approvals',
  routes: [
    {
      method: 'get',
      path: '/',
      permission: 'authenticated',
      audit: null,
      summary:
        'Approvals: my inbox (default), requests I raised (box=mine) or all (box=all, auditors)',
      schema: { query: listQuery },
      handler: (req) => {
        const { box, status, module, ...page } = req.valid.query;
        const filter = {
          ...boxFilter(box),
          ...(status && box !== 'inbox' ? { status } : {}),
          ...(module ? { module } : {}),
        };
        return paginate(ApprovalRequest, filter, page, { map: toDto });
      },
    },
    {
      method: 'get',
      path: '/count',
      permission: 'authenticated',
      audit: null,
      summary: 'Number of requests waiting for me (menu badge)',
      handler: async () => ({ inbox: await ApprovalRequest.countDocuments(boxFilter('inbox')) }),
    },
    {
      method: 'get',
      path: '/:id',
      permission: 'authenticated',
      audit: null,
      summary: 'One approval request with its levels and decisions',
      schema: { params: z.object({ id: objectId }) },
      handler: async (req) => {
        const c = current();
        const r = await ApprovalRequest.findById(req.valid.params.id).lean();
        if (!r) throw errors.notFound('Approval request');
        const mine =
          String(r.makerId) === String(c.userId) ||
          r.decisions.some((d) => String(d.by) === String(c.userId));
        const canDecide = r.currentPermission && hasPermission(c.permissions, r.currentPermission);
        if (!mine && !canDecide && !hasPermission(c.permissions, READ_ALL))
          throw errors.notFound('Approval request');
        return toDto(r);
      },
    },
    {
      method: 'post',
      path: '/:id/decision',
      permission: 'authenticated',
      audit: 'APPROVE',
      summary: 'Approve or reject the current level (a reason is required to reject)',
      schema: {
        params: z.object({ id: objectId }),
        body: z
          .object({
            decision: z.enum(['APPROVE', 'REJECT']),
            comment: z.string().trim().max(1000).optional(),
            version: z.number().int().min(0),
          })
          .refine((b) => b.decision === 'APPROVE' || (b.comment?.length ?? 0) >= 3, {
            path: ['comment'],
            message: 'Give a reason for rejecting',
          }),
      },
      handler: async (req) => toDto(await decide(req.valid.params.id, req.valid.body)),
    },
    {
      method: 'post',
      path: '/:id/withdraw',
      permission: 'authenticated',
      audit: 'UPDATE',
      summary: 'Withdraw your own pending request',
      schema: {
        params: z.object({ id: objectId }),
        body: z.object({ version: z.number().int().min(0) }),
      },
      handler: async (req) => toDto(await withdraw(req.valid.params.id, req.valid.body)),
    },
  ],
});

const ruleDto = (r) => ({
  action: r.action,
  label: r.label,
  levels: r.levels,
  expiryHours: r.expiryHours,
  enabled: r.enabled,
  version: r.version,
});

export const approvalRuleRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/approval-rules',
  routes: [
    {
      method: 'get',
      path: '/',
      permission: 'settings:approval:read',
      audit: null,
      summary: 'Maker-checker rules of this hospital',
      handler: async () => (await ApprovalRule.find().sort({ action: 1 }).lean()).map(ruleDto),
    },
    {
      method: 'put',
      path: '/:action',
      permission: 'settings:approval:update',
      audit: 'UPDATE',
      summary: 'Change thresholds, expiry or switch a rule off (Super Admin)',
      schema: {
        params: z.object({ action: z.string().regex(/^[a-z]+\.[a-zA-Z.]+$/) }),
        body: z.object({
          version: z.number().int().min(0),
          expiryHours: z.number().int().min(1).max(336),
          enabled: z.boolean(),
          thresholds: z.array(
            z
              .object({
                amountOver: z.number().int().min(0).optional(),
                percentOver: z.number().min(0).max(100).optional(),
              })
              .nullable(),
          ),
        }),
      },
      handler: async (req) => {
        const { version, expiryHours, enabled, thresholds } = req.valid.body;
        const rule = await ApprovalRule.findOne({ action: req.valid.params.action });
        if (!rule) throw errors.notFound('Approval rule');
        if (rule.version !== version) throw errors.versionConflict();
        if (thresholds.length !== rule.levels.length)
          throw errors.validation([
            { path: 'thresholds', message: `Give one entry per level (${rule.levels.length})` },
          ]);
        thresholds.forEach((t, i) => {
          // The first level always applies; later levels may be conditional.
          if (i > 0) rule.levels[i].when = t ?? undefined;
        });
        rule.expiryHours = expiryHours;
        rule.enabled = enabled;
        rule.markModified('levels');
        await rule.save();
        return ruleDto(rule);
      },
    },
  ],
});
