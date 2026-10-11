import { describe, expect, it } from 'vitest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Bill } from '../../src/modules/billing/index.js';
import { Grn, Store, Vendor } from '../../src/modules/inventory/index.js';

const ctx = useIntegration();
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

async function hospital() {
  const t = await makeTenant({ modules: ['OPD', 'INV', 'FIN'] });
  const acc = await makeUser(t, { username: 'acc', roles: ['accounts'] });
  const doc = await makeUser(t, { username: 'drk', roles: ['doctor'] });
  const c = { sa: await signIn(ctx.app, t.host), acc: await signIn(ctx.app, t.host, 'acc') };
  void acc;
  return { t, c, doc };
}

describe('Finance sub-ledgers', () => {
  it('ages and pays vendor payables, ages receivables, tracks budgets', async () => {
    const { t, c } = await hospital();
    const tid = t.tenant._id;
    const { vendor } = await runAsSystem(tid, async () => {
      const [v] = await Vendor.create([{ code: 'MEDI', name: 'Medi Distributors' }]);
      const [s] = await Store.create([
        { code: 'MAIN', name: 'Main store', branchId: t.branch._id },
      ]);
      const grn = (no, total, tax, at) => ({
        grnNo: no,
        vendorId: v._id,
        vendorName: v.name,
        storeId: s._id,
        status: 'POSTED',
        total,
        tax,
        postedAt: at,
        lines: [],
      });
      await Grn.create([
        grn('GRN/1', 10_000_00, 1_200_00, daysAgo(75)),
        grn('GRN/2', 5_000_00, 600_00, daysAgo(10)),
      ]);
      await Bill.create([
        {
          billNo: 'OP/1',
          type: 'OP',
          branchId: t.branch._id,
          patient: { id: t.branch._id, name: 'Kiran Sharma', uhid: 'CC1' },
          status: 'PARTLY_PAID',
          totals: { total: 2_000_00, paid: 500_00, balance: 1_500_00 },
          finalizedAt: daysAgo(40),
        },
      ]);
      return { vendor: v };
    });

    const pay = (await c.acc.get('/finance/payables')).body;
    expect(pay.total).toBe(16_800_00);
    expect(pay.buckets).toEqual({ d30: 5_600_00, d60: 0, d90: 11_200_00, over90: 0 });
    expect(pay.items[0]).toMatchObject({ vendorName: 'Medi Distributors', outstanding: 16_800_00 });

    // Too much is refused; a payment clears the oldest receipt first, with TDS withheld.
    expect(
      (
        await c.acc
          .post('/finance/vendor-payments')
          .send({ vendorId: String(vendor._id), amount: 20_000_00, mode: 'BANK_TRANSFER' })
      ).status,
    ).toBe(422);
    const p = await c.acc
      .post('/finance/vendor-payments')
      .send({
        vendorId: String(vendor._id),
        amount: 12_000_00,
        tds: 200_00,
        mode: 'CHEQUE',
        reference: 'CHQ 1001',
      });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body.allocations.map((a) => [a.grnNo, a.amount])).toEqual([
      ['GRN/1', 11_200_00],
      ['GRN/2', 800_00],
    ]);
    const after = (await c.acc.get('/finance/payables')).body;
    expect(after.total).toBe(4_800_00);
    expect(after.buckets.d90).toBe(0);
    const tb = (await c.acc.get('/finance/trial-balance')).body;
    const tds = tb.items.find((r) => r.key === 'TDS_PAYABLE');
    expect(tds.credit).toBe(200_00);
    expect(tb.balanced).toBe(true);

    // Receivables: the patient bill is 40 days old.
    const rec = (await c.acc.get('/finance/receivables')).body;
    expect(rec.patients).toMatchObject({ total: 1_500_00, buckets: { d60: 1_500_00 } });
    expect(rec.patients.items[0]).toMatchObject({ billNo: 'OP/1', patient: 'Kiran Sharma' });

    // Budgets: an annual figure is spread over twelve months; actuals come from the journals.
    const b0 = (await c.acc.get('/finance/budgets')).body;
    const repairs = b0.items.find((r) => r.code === '5520');
    const set = await c.acc
      .put('/finance/budgets')
      .send({ fy: b0.fy, accountId: repairs.accountId, annual: 1_20_000_00 + 5 });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.budget[0]).toBe(10_000_00);
    expect(set.body.budget[11]).toBe(10_000_05);
    expect(set.body.budgetTotal).toBe(1_20_000_05);
  });

  it('runs petty cash with approval above the limit, and pays a doctor’s share', async () => {
    const { t, c, doc } = await hospital();
    const tid = t.tenant._id;
    const accounts = (await c.acc.get('/finance/accounts')).body.items;
    const general = accounts.find((a) => a.key === 'GENERAL_EXPENSE');

    // Nothing in the box yet
    const short = await c.acc.post('/finance/petty-cash').send({
      kind: 'EXPENSE',
      amount: 500_00,
      accountId: general.id,
      payee: 'Tea vendor',
    });
    expect(short.status).toBe(422);
    expect(short.body.code ?? short.body.error?.code).toBe('PETTY_CASH_SHORT');

    expect(
      (await c.acc.post('/finance/petty-cash').send({ kind: 'TOPUP', amount: 10_000_00 })).status,
    ).toBe(201);
    const small = await c.acc
      .post('/finance/petty-cash')
      .send({ kind: 'EXPENSE', amount: 500_00, accountId: general.id, payee: 'Tea vendor' });
    expect(small.status).toBe(201);
    expect(small.body.status).toBe('POSTED');
    const big = await c.acc
      .post('/finance/petty-cash')
      .send({
        kind: 'EXPENSE',
        amount: 3_000_00,
        accountId: general.id,
        payee: 'Plumber',
        note: 'OT drain',
      });
    expect(big.status, JSON.stringify(big.body)).toBe(202);
    expect(big.body.status).toBe('PENDING_APPROVAL');
    let book = (await c.acc.get('/finance/petty-cash')).body;
    expect(book).toMatchObject({ balance: 9_500_00, pending: 3_000_00, approvalOver: 2_000_00 });

    // Raise the limit (version-checked)
    const lim = await c.acc
      .put('/finance/petty-cash/settings')
      .send({ version: book.version, float: 25_000_00, approvalOver: 5_000_00 });
    expect(lim.status, JSON.stringify(lim.body)).toBe(200);
    expect(lim.body.approvalOver).toBe(5_000_00);

    // Doctor share: 60% of consultation, 10% TDS
    const shares = await c.acc
      .put('/finance/doctor-shares')
      .send({ userId: String(doc._id), shares: { CONSULTATION: 60 }, tdsPercent: 10 });
    expect(shares.status, JSON.stringify(shares.body)).toBe(200);
    expect(shares.body.shares).toEqual({ CONSULTATION: 60 });
    await runAsSystem(tid, () =>
      Bill.create([
        {
          billNo: 'OP/9',
          type: 'OP',
          branchId: t.branch._id,
          doctorUserId: doc._id,
          patient: { id: t.branch._id, name: 'Asha' },
          status: 'PAID',
          finalizedAt: new Date(),
          lines: [
            { name: 'Consultation', category: 'CONSULTATION', qty: 1, net: 1_000_00 },
            { name: 'ECG', category: 'PROCEDURE', qty: 1, net: 500_00 },
          ],
          totals: { total: 1_500_00, paid: 1_500_00, balance: 0 },
        },
      ]),
    );
    const draft = await c.acc.post('/finance/doctor-payouts/draft').send({ month: thisMonth() });
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    const po = draft.body.items[0];
    expect(po).toMatchObject({ gross: 600_00, tds: 60_00, net: 540_00, bills: 1, status: 'DRAFT' });
    const paid = await c.acc
      .post(`/finance/doctor-payouts/${po.id}/pay`)
      .send({ version: po.version, mode: 'BANK_TRANSFER', reference: 'NEFT 77' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.status).toBe('PAID');
    expect(
      (
        await c.acc
          .post(`/finance/doctor-payouts/${po.id}/pay`)
          .send({ version: paid.body.version, mode: 'CASH' })
      ).status,
    ).toBe(409);
    // A redraft leaves the paid payout alone.
    const again = (await c.acc.post('/finance/doctor-payouts/draft').send({ month: thisMonth() }))
      .body;
    expect(again.items[0]).toMatchObject({ status: 'PAID', gross: 600_00 });
    book = (await c.acc.get('/finance/petty-cash')).body;
    expect(book.items).toHaveLength(3);
  });
});
