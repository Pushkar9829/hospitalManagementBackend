import { describe, expect, it } from 'vitest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Asset } from '../../src/modules/facility/index.js';

const ctx = useIntegration();

async function approve(c, approvalId) {
  const a = (await c.get(`/approvals/${approvalId}`)).body;
  const res = await c
    .post(`/approvals/${approvalId}/decision`)
    .send({ decision: 'APPROVE', version: a.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function hospital() {
  const t = await makeTenant({ modules: ['OPD', 'FIN'] });
  await makeUser(t, { username: 'acc', roles: ['accounts'] });
  await makeUser(t, { username: 'acc2', roles: ['accounts'] });
  const c = {
    acc: await signIn(ctx.app, t.host, 'acc'),
    acc2: await signIn(ctx.app, t.host, 'acc2'),
  };
  const accounts = (await c.acc.get('/finance/accounts')).body.items;
  const byCode = (code) => accounts.find((a) => a.code === code).id;
  const tb = async (key) => {
    const r = (await c.acc.get('/finance/trial-balance')).body;
    expect(r.balanced).toBe(true);
    return r.items.find((i) => i.key === key) ?? { debit: 0, credit: 0 };
  };
  return { t, c, byCode, tb };
}

describe('Treasury: fixed assets and depreciation', () => {
  it('capitalises, depreciates month by month (SLM and WDV), disposes and schedules', async () => {
    const { t, c, tb } = await hospital();
    const eq = await runAsSystem(t.tenant._id, () =>
      Asset.create({ code: 'EQ-MRI', name: 'MRI 1.5T', cost: 13_00_000_00 }),
    );
    let pick = (await c.acc.get('/finance/assets/equipment')).body.items;
    expect(pick.map((e) => e.code)).toEqual(['EQ-MRI']);

    // MRI bought from the bank: SLM over 13 years (Schedule II), 5% salvage.
    const mri = await c.acc.post('/finance/assets').send({
      code: 'fa-001',
      name: 'MRI 1.5T',
      block: 'MEDICAL_EQUIPMENT',
      equipmentId: String(eq._id),
      putToUseOn: '2025-04-16',
      cost: 13_00_000_00,
    });
    expect(mri.status, JSON.stringify(mri.body)).toBe(201);
    expect(mri.body).toMatchObject({ code: 'FA-001', usefulLifeYears: 13, method: 'SLM' });
    pick = (await c.acc.get('/finance/assets/equipment')).body.items;
    expect(pick).toHaveLength(0);
    // A computer already in the books: WDV 40%, ₹40,000 charged through March 2025.
    const pc = await c.acc.post('/finance/assets').send({
      code: 'FA-002',
      name: 'Billing server',
      block: 'COMPUTERS',
      putToUseOn: '2023-04-01',
      cost: 1_00_000_00,
      method: 'WDV',
      fundedFrom: 'EXISTING',
      openingAccumulated: 40_000_00,
      depreciatedThrough: '2025-03',
    });
    expect(pc.status, JSON.stringify(pc.body)).toBe(201);
    expect(pc.body).toMatchObject({ wdvRate: 40, bookValue: 60_000_00 });
    expect((await tb('FIXED_ASSETS')).debit).toBe(13_00_000_00);

    // April: MRI for 15 of 30 days; the server 40% / 12 of ₹60,000.
    const mriMonth = (1_30_000_000 - 6_500_000) / 156; // paise
    const april = await c.acc.post('/finance/assets/depreciation').send({ month: '2025-04' });
    expect(april.status, JSON.stringify(april.body)).toBe(200);
    expect(april.body.total).toBe(Math.round(mriMonth / 2) + 2_000_00);
    expect(
      (await c.acc.post('/finance/assets/depreciation').send({ month: '2025-04' })).body.error.code,
    ).toBe('ALREADY_RUN');
    expect(
      (await c.acc.post('/finance/assets/depreciation').send({ month: '2099-01' })).body.error.code,
    ).toBe('FUTURE_MONTH');

    // June catches up May as well.
    const may = Math.round(((6_000_000 - 200_000) * 0.4) / 12);
    const june = Math.round(((6_000_000 - 200_000 - may) * 0.4) / 12);
    const expected = 2 * Math.round(mriMonth) + may + june;
    expect((await c.acc.get('/finance/assets/depreciation/preview?month=2025-06')).body.total).toBe(
      expected,
    );
    const jun = await c.acc.post('/finance/assets/depreciation').send({ month: '2025-06' });
    expect(jun.body.total).toBe(expected);
    const charged = april.body.total + expected;
    expect((await tb('DEPRECIATION')).debit).toBe(charged);
    expect((await tb('ACC_DEPRECIATION')).credit).toBe(charged);

    // Disposal: the MRI is not depreciated through August; the server sells at a loss.
    let reg = (await c.acc.get('/finance/assets')).body;
    const m = reg.items.find((a) => a.code === 'FA-001');
    const s = reg.items.find((a) => a.code === 'FA-002');
    expect(
      (
        await c.acc
          .post(`/finance/assets/${m.id}/dispose`)
          .send({ version: m.version, on: '2025-09-10', proceeds: 0, reason: 'Scrapped' })
      ).body.error.code,
    ).toBe('DEPRECIATION_DUE');
    const sale = await c.acc
      .post(`/finance/assets/${s.id}/dispose`)
      .send({ version: s.version, on: '2025-07-10', proceeds: 50_000_00, reason: 'Sold to staff' });
    expect(sale.status, JSON.stringify(sale.body)).toBe(202);
    await approve(c.acc2, sale.body.approvalId);
    reg = (await c.acc.get('/finance/assets')).body;
    const sold = reg.items.find((a) => a.code === 'FA-002');
    expect(sold.status).toBe('DISPOSED');
    const loss = sold.bookValue - 50_000_00;
    expect(sold.disposal.gain).toBe(-loss);
    expect((await tb('ASSET_GAIN_LOSS')).debit).toBe(loss);
    expect(reg.totals.cost).toBe(13_00_000_00);

    // Schedule for 2025-26.
    const sch = (await c.acc.get('/finance/assets/schedule?fy=2025-26')).body;
    const med = sch.items.find((r) => r.block === 'MEDICAL_EQUIPMENT');
    expect(med).toMatchObject({ openingGross: 0, additions: 13_00_000_00, openingDep: 0 });
    expect(med.netBlock).toBe(13_00_000_00 - med.closingDep);
    const it = sch.items.find((r) => r.block === 'COMPUTERS');
    expect(it).toMatchObject({
      openingGross: 1_00_000_00,
      openingDep: 40_00_000,
      disposals: 1_00_000_00,
      closingGross: 0,
      closingDep: 0,
      netBlock: 0,
    });
    expect(it.onDisposals).toBe(it.openingDep + it.forYear);
  });
});

describe('Treasury: bank reconciliation', () => {
  it('imports a statement, matches it, books bank charges and reconciles to the bank', async () => {
    const { c, byCode, tb } = await hospital();
    const voucher = async (type, date, narration, lines) => {
      const r = await c.acc.post('/finance/vouchers').send({ type, date, narration, lines });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body;
    };
    await voucher('RECEIPT', '2025-04-01', 'Capital introduced', [
      { accountId: byCode('1010'), debit: 20_00_000_00 },
      { accountId: byCode('3000'), credit: 20_00_000_00 },
    ]);
    await c.acc.post('/finance/assets').send({
      code: 'FA-001',
      name: 'MRI',
      block: 'MEDICAL_EQUIPMENT',
      putToUseOn: '2025-04-16',
      cost: 13_00_000_00,
    });
    const receipt = await voucher('RECEIPT', '2025-04-20', 'TPA settlement', [
      { accountId: byCode('1010'), debit: 50_000_00 },
      { accountId: byCode('4090'), credit: 50_000_00 },
    ]);
    const cheque = await voucher('PAYMENT', '2025-04-22', 'Electricity, cheque 100231', [
      { accountId: byCode('5510'), debit: 12_000_00 },
      { accountId: byCode('1010'), credit: 12_000_00 },
    ]);

    const lines = [
      {
        date: '2025-04-01',
        description: 'Capital',
        ref: 'NEFT1',
        amount: 20_00_000_00,
        balance: 20_00_000_00,
      },
      {
        date: '2025-04-17',
        description: 'RTGS MRI vendor',
        ref: 'RTGS7',
        amount: -13_00_000_00,
        balance: 7_00_000_00,
      },
      {
        date: '2025-04-21',
        description: 'TPA credit',
        ref: 'NEFT9',
        amount: 50_000_00,
        balance: 7_50_000_00,
      },
      {
        date: '2025-04-30',
        description: 'Service charges',
        ref: '',
        amount: -590_00,
        balance: 7_49_410_00,
      },
    ];
    const imp = await c.acc.post('/finance/bank/statement').send({ lines });
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    expect(imp.body).toEqual({ added: 4, skipped: 0, matched: 3 });
    expect((await c.acc.post('/finance/bank/statement').send({ lines })).body).toEqual({
      added: 0,
      skipped: 4,
      matched: 0,
    });

    let rec = (await c.acc.get('/finance/bank/reconciliation?asOf=2025-04-30')).body;
    expect(rec.bookBalance).toBe(7_38_000_00);
    expect(rec.chequesNotPresented.map((x) => x.amount)).toEqual([12_000_00]);
    expect(rec.bankOnly.map((x) => x.amount)).toEqual([-590_00]);
    expect(rec.computedBankBalance).toBe(7_49_410_00);
    expect(rec.difference).toBe(0);

    // Manual matching: a different amount is refused; the right entry is accepted.
    const st = (await c.acc.get('/finance/bank/statement')).body.items;
    const tpa = st.find((l) => l.ref === 'NEFT9');
    expect(tpa.matchedBy).toBe('AUTO');
    const un = await c.acc
      .post(`/finance/bank/statement/${tpa.id}/unmatch`)
      .send({ version: tpa.version });
    expect(un.body.status).toBe('UNMATCHED');
    expect(
      (
        await c.acc
          .post(`/finance/bank/statement/${tpa.id}/match`)
          .send({ journalId: cheque.id, version: un.body.version })
      ).body.error.code,
    ).toBe('AMOUNT_MISMATCH');
    const open = (await c.acc.get('/finance/bank/statement?status=UNMATCHED')).body.items;
    expect(open.find((l) => l.id === tpa.id).candidates[0].journalId).toBe(receipt.id);
    const back = await c.acc
      .post(`/finance/bank/statement/${tpa.id}/match`)
      .send({ journalId: receipt.id, version: un.body.version });
    expect(back.status, JSON.stringify(back.body)).toBe(200);

    // The bank's charges go to the books and the line matches the new voucher.
    const fee = st.find((l) => l.amount === -590_00);
    const booked = await c.acc.post(`/finance/bank/statement/${fee.id}/book`).send({
      version: fee.version,
      accountId: byCode('5500'),
      narration: 'Bank service charges, April',
    });
    expect(booked.status, JSON.stringify(booked.body)).toBe(200);
    expect(booked.body).toMatchObject({ status: 'MATCHED', matchedBy: 'CREATED' });
    expect((await tb('GENERAL_EXPENSE')).debit).toBe(590_00);

    rec = (await c.acc.get('/finance/bank/reconciliation?asOf=2025-04-30')).body;
    expect(rec.bookBalance).toBe(7_37_410_00);
    expect(rec.bankOnly).toHaveLength(0);
    expect(rec.difference).toBe(0);
    expect(rec.counts).toEqual({ lines: 4, matched: 4, ignored: 0, open: 0 });
  });
});
