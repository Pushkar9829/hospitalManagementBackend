import { describe, expect, it } from 'vitest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runInContext, runAsSystem } from '../../src/core/tenancy/context.js';
import { markApplied, requestApproval } from '../../src/core/approvals/approval.service.js';
import { ApprovalRequest, ApprovalRule } from '../../src/core/approvals/approval.model.js';
import { OutboxEvent } from '../../src/core/events/outbox.model.js';

const ctx = useIntegration();

/**
 * The engine is tested with its own action so no module applier (billing applies real
 * discounts) runs; the rule copies the levels of billing.discount.
 */
const ACTION = 'qa.discount';
async function withQaRule(t) {
  const { DEFAULT_APPROVAL_RULES } = await import('@hms/shared');
  const base = DEFAULT_APPROVAL_RULES.find((r) => r.action === 'billing.discount');
  await runAsSystem(t.tenant._id, () => ApprovalRule.create([{ ...base, action: ACTION }]));
  return t;
}

/** A cashier asks for a discount inside their own request context. */
function raise(t, maker, { percent = 15, amount = 5_000_00, entityId = 'OP/26-27/000155' } = {}) {
  return runInContext(
    {
      tenantId: String(t.tenant._id),
      userId: String(maker._id),
      userName: maker.name,
      permissions: new Set(['billing:*']),
    },
    () =>
      requestApproval({
        action: ACTION,
        module: 'CORE',
        entity: 'Bill',
        entityId,
        title: `${percent}% discount on ${entityId}`,
        before: { discount: 0 },
        after: { discount: percent },
        payload: { discountPct: percent },
        metrics: { percent, amount },
        reason: 'Staff family',
      }),
  );
}

describe('maker-checker approvals', () => {
  it('routes a 15% discount through Billing Manager then Super Admin', async () => {
    const t = await withQaRule(await makeTenant());
    const cashier = await makeUser(t, { username: 'cashier1', roles: ['cashier'] });
    await makeUser(t, { username: 'billmgr', roles: ['billingmgr'] });
    const req = await raise(t, cashier);
    expect(req.levels.map((l) => l.label)).toEqual(['Billing Manager', 'Super Admin']);

    const maker = await signIn(ctx.app, t.host, 'cashier1');
    expect((await maker.get('/approvals')).body.total).toBe(0);
    expect((await maker.get('/approvals?box=mine')).body.total).toBe(1);
    const self = await maker
      .post(`/approvals/${req._id}/decision`)
      .send({ decision: 'APPROVE', version: req.version });
    expect(self.status).toBe(403);

    const l1 = await signIn(ctx.app, t.host, 'billmgr');
    expect((await l1.get('/approvals/count')).body.inbox).toBe(1);
    const first = await l1
      .post(`/approvals/${req._id}/decision`)
      .send({ decision: 'APPROVE', comment: 'Policy', version: req.version });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'PENDING', levelIndex: 1 });
    expect(first.body.levels[0]).toMatchObject({ decision: 'APPROVE', decidedBy: 'User billmgr' });
    expect((await l1.get('/approvals/count')).body.inbox).toBe(0);

    const admin = await signIn(ctx.app, t.host);
    const stale = await admin
      .post(`/approvals/${req._id}/decision`)
      .send({ decision: 'APPROVE', version: req.version });
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const reject = await admin
      .post(`/approvals/${req._id}/decision`)
      .send({ decision: 'REJECT', version: first.body.version });
    expect(reject.status).toBe(422);
    const ok = await admin
      .post(`/approvals/${req._id}/decision`)
      .send({ decision: 'APPROVE', version: first.body.version });
    expect(ok.body.status).toBe('APPROVED');

    const types = (
      await OutboxEvent.find({ tenantId: t.tenant._id }).sort({ createdAt: 1 }).lean()
    ).map((e) => e.type);
    expect(types).toEqual(['approval.requested', 'approval.levelApproved', 'approval.decided']);
    await runAsSystem(t.tenant._id, () => markApplied(req._id));
    expect((await admin.get(`/approvals/${req._id}`)).body.status).toBe('APPLIED');
    expect((await admin.get('/audit?entity=Bill&action=APPROVE')).body.total).toBe(2);
  });

  it('skips the second level below the threshold, and needs no approval when the rule is off', async () => {
    const t = await withQaRule(await makeTenant());
    const cashier = await makeUser(t, { username: 'cashier2', roles: ['cashier'] });
    const small = await raise(t, cashier, { percent: 5, amount: 2_000_00, entityId: 'A' });
    expect(small.levels).toHaveLength(1);
    await runAsSystem(t.tenant._id, () =>
      ApprovalRule.updateOne({ action: ACTION }, { $set: { enabled: false } }).exec(),
    );
    expect(await raise(t, cashier, { entityId: 'B' })).toBeNull();
  });

  it('allows one open request per record, and one level per checker', async () => {
    const t = await withQaRule(await makeTenant());
    const cashier = await makeUser(t, { username: 'cashier3', roles: ['cashier'] });
    const req = await raise(t, cashier, { entityId: 'C' });
    await expect(raise(t, cashier, { entityId: 'C' })).rejects.toMatchObject({
      code: 'APPROVAL_ALREADY_PENDING',
    });
    const admin = await signIn(ctx.app, t.host);
    const l1 = await admin
      .post(`/approvals/${req._id}/decision`)
      .send({ decision: 'APPROVE', version: req.version });
    expect(l1.status).toBe(200);
    const l2 = await admin
      .post(`/approvals/${req._id}/decision`)
      .send({ decision: 'APPROVE', version: l1.body.version });
    expect(l2.body.error.code).toBe('ALREADY_DECIDED');
  });

  it('expires requests after the rule expiry', async () => {
    const t = await withQaRule(await makeTenant());
    const cashier = await makeUser(t, { username: 'cashier4', roles: ['cashier'] });
    const req = await raise(t, cashier, { entityId: 'D' });
    await runAsSystem(t.tenant._id, () =>
      ApprovalRequest.updateOne(
        { _id: req._id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      ).exec(),
    );
    const admin = await signIn(ctx.app, t.host);
    expect((await admin.get('/approvals/count')).body.inbox).toBe(0);
    const late = await admin
      .post(`/approvals/${req._id}/decision`)
      .send({ decision: 'APPROVE', version: req.version });
    expect(late.body.error.code).toBe('APPROVAL_CLOSED');
    expect((await admin.get(`/approvals/${req._id}`)).body.status).toBe('EXPIRED');
  });

  it('lets a Super Admin tune thresholds and keeps the first level unconditional', async () => {
    const t = await withQaRule(await makeTenant());
    const admin = await signIn(ctx.app, t.host);
    const rules = (await admin.get('/approval-rules')).body;
    const discount = rules.find((r) => r.action === 'billing.discount');
    const res = await admin.put('/approval-rules/billing.discount').send({
      version: discount.version,
      expiryHours: 24,
      enabled: true,
      thresholds: [{ amountOver: 1 }, { percentOver: 20 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.levels[0].when).toBeUndefined();
    expect(res.body.levels[1].when).toEqual({ percentOver: 20 });
    await makeUser(t, { username: 'billmgr2', roles: ['billingmgr'] });
    const mgr = await signIn(ctx.app, t.host, 'billmgr2');
    expect(
      (
        await mgr.put('/approval-rules/billing.discount').send({
          version: res.body.version,
          expiryHours: 1,
          enabled: false,
          thresholds: [null, null],
        })
      ).status,
    ).toBe(403);
  });
});
