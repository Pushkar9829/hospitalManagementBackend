import { describe, expect, it } from 'vitest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';

const ctx = useIntegration();
const DAY = 86_400_000;
const ymd = (offset = 0) =>
  new Date(Date.now() + 330 * 60_000 + offset * DAY).toISOString().slice(0, 10);

async function hospital() {
  const t = await makeTenant({ modules: ['OPD', 'IPD', 'NUR', 'FAC'] });
  for (const [u, r] of [
    ['fac', 'facility'],
    ['fac2', 'facility'],
    ['nurse', 'nurse'],
    ['nurse2', 'nurse'],
    ['admin', 'admin'],
    ['doc', 'doctor'],
  ])
    await makeUser(t, { username: u, roles: [r] });
  const c = {};
  for (const u of ['fac', 'fac2', 'nurse', 'nurse2', 'admin', 'doc'])
    c[u] = await signIn(ctx.app, t.host, u);
  return c;
}

async function approve(c, approvalId) {
  const a = (await c.get(`/approvals/${approvalId}`)).body;
  const res = await c
    .post(`/approvals/${approvalId}/decision`)
    .send({ decision: 'APPROVE', version: a.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

describe('Facility (Phase 6)', () => {
  it('runs cleaning rounds with sign-off, linen par, laundry shortage and condemnation', async () => {
    const c = await hospital();
    const sch = await c.fac.post('/facility/hk-schedules').send({
      area: 'General Ward toilets',
      kind: 'TOILET',
      times: ['08:00', '16:00'],
      checklist: ['Floor mopped', 'Basin cleaned', 'Bin emptied'],
    });
    expect(sch.status, JSON.stringify(sch.body)).toBe(201);
    const day = (await c.fac.get('/facility/hk-tasks')).body;
    expect(day.items).toHaveLength(2);
    expect((await c.fac.get('/facility/hk-tasks')).body.items).toHaveLength(2); // not duplicated
    const r = day.items[0];
    const done = await c.fac
      .post(`/facility/hk-tasks/${r.id}/done`)
      .send({ done: ['Floor mopped', 'Bin emptied'], remarks: 'Basin tap leaking' });
    expect(done.body.items.filter((i) => i.ok)).toHaveLength(2);
    expect((await c.fac.post(`/facility/hk-tasks/${r.id}/verify`)).body.error.code).toBe(
      'MAKER_CANNOT_CHECK',
    );
    expect((await c.fac2.post(`/facility/hk-tasks/${r.id}/verify`)).body).toMatchObject({
      status: 'VERIFIED',
      verifiedBy: 'User fac2',
    });

    await c.fac
      .put('/facility/settings')
      .send({ par: [{ ward: 'General Ward', code: 'BEDSHEET', qty: 40 }] });
    await c.fac
      .post('/facility/linen/issue')
      .send({ ward: 'General Ward', lines: [{ code: 'BEDSHEET', qty: 40 }] });
    const sent = await c.fac
      .post('/facility/laundry')
      .send({ ward: 'General Ward', lines: [{ code: 'BEDSHEET', qty: 10 }] });
    expect(sent.status).toBe(201);
    expect(sent.body.batchNo).toMatch(/^LDY\//);
    let board = (await c.fac.get('/facility/linen')).body.items[0].lines[0];
    expect(board).toMatchObject({ qty: 30, par: 40, inLaundry: 10 });
    const back = await c.fac
      .post(`/facility/laundry/${sent.body.id}/receive`)
      .send({ lines: [{ code: 'BEDSHEET', qty: 9 }] });
    expect(back.body).toMatchObject({ status: 'RECEIVED', shortage: 1 });
    expect(
      (
        await c.fac
          .post('/facility/linen/issue')
          .send({ ward: 'General Ward', lines: [{ code: 'SAREE', qty: 1 }] })
      ).status,
    ).toBe(422);

    const cond = await c.fac
      .post('/facility/linen/condemn')
      .send({ ward: 'General Ward', code: 'BEDSHEET', qty: 2, reason: 'Torn beyond repair' });
    expect(cond.status, JSON.stringify(cond.body)).toBe(202);
    board = (await c.fac.get('/facility/linen')).body.items[0].lines[0];
    expect(board.qty).toBe(39); // nothing written off until approved
    await approve(c.admin, cond.body.approvalId);
    board = (await c.fac.get('/facility/linen')).body.items[0].lines[0];
    expect(board).toMatchObject({ qty: 37, short: 3 });
  });

  it('moves a patient by porter', async () => {
    const c = await hospital();
    const p = await c.nurse.post('/facility/porters').send({
      patient: { name: 'Ravi Kumar' },
      from: 'General Ward GW-03',
      to: 'Radiology',
      mode: 'STRETCHER',
      priority: 'URGENT',
    });
    expect(p.status).toBe(201);
    expect((await c.fac.post(`/facility/porters/${p.body.id}/pick`).send({})).body.error.code).toBe(
      'INVALID_STATE',
    );
    expect((await c.fac.post(`/facility/porters/${p.body.id}/assign`).send({})).status).toBe(422);
    await c.fac.post(`/facility/porters/${p.body.id}/assign`).send({ porter: 'Ganesh' });
    await c.fac.post(`/facility/porters/${p.body.id}/pick`).send({});
    const done = await c.fac.post(`/facility/porters/${p.body.id}/done`).send({});
    expect(done.body).toMatchObject({ status: 'DONE', porter: 'Ganesh' });
    expect((await c.nurse.get('/facility/porters')).body.items).toEqual([]);
  });

  it('takes broken equipment out of service, repairs it, records downtime and PM', async () => {
    const c = await hospital();
    const vent = await c.fac.post('/facility/assets').send({
      code: 'VENT-01',
      name: 'Ventilator',
      category: 'BIOMEDICAL',
      serialNo: 'HAM-77812',
      location: 'ICU bed 4',
      riskClass: 'A',
      pmEveryDays: 90,
      calibrationEveryDays: 180,
      amc: { vendor: 'Hamilton Services', kind: 'CMC', from: ymd(-335), until: ymd(30) },
    });
    expect(vent.status, JSON.stringify(vent.body)).toBe(201);
    expect(vent.body.amc.daysLeft).toBeLessThanOrEqual(31);
    expect((await c.fac.get('/facility/assets/due')).body.amc.map((a) => a.code)).toEqual([
      'VENT-01',
    ]);

    // A nurse reports a breakdown: life-support equipment goes urgent and out of service
    const tk = await c.nurse.post('/facility/tickets').send({
      category: 'BIOMEDICAL',
      location: 'ICU bed 4',
      description: 'Ventilator alarm, will not start',
      assetId: vent.body.id,
      breakdown: true,
    });
    expect(tk.status, JSON.stringify(tk.body)).toBe(201);
    expect(tk.body).toMatchObject({ priority: 'URGENT', status: 'OPEN', raisedBy: 'User nurse' });
    expect((await c.fac.get(`/facility/assets/${vent.body.id}`)).body.status).toBe(
      'OUT_OF_SERVICE',
    );

    // Others without facility access see only their own tickets; the nurse cannot resolve
    // a doctor (no facility read access) sees only the tickets they raised
    expect((await c.doc.get('/facility/tickets')).body.items).toEqual([]);
    expect((await c.fac.get('/facility/tickets')).body.items).toHaveLength(1);
    const deny = await c.nurse
      .post(`/facility/tickets/${tk.body.id}/action`)
      .send({ action: 'RESOLVE', note: 'Fixed' });
    expect(deny.status).toBe(409); // still OPEN
    await c.fac
      .post(`/facility/tickets/${tk.body.id}/action`)
      .send({ action: 'ASSIGN', assignee: 'Biomedical: Sanjay' });
    const noRights = await c.nurse
      .post(`/facility/tickets/${tk.body.id}/action`)
      .send({ action: 'RESOLVE', note: 'Fixed' });
    expect(noRights.status).toBe(403);
    const fixed = await c.fac
      .post(`/facility/tickets/${tk.body.id}/action`)
      .send({ action: 'RESOLVE', note: 'Flow sensor replaced, calibrated' });
    expect(fixed.body.status).toBe('RESOLVED');
    expect(fixed.body.downtimeMin).toBeGreaterThanOrEqual(0);
    const asset = (await c.fac.get(`/facility/assets/${vent.body.id}`)).body;
    expect(asset.status).toBe('IN_SERVICE');
    expect(asset.tickets).toHaveLength(1);
    expect(asset.history.map((h) => h.kind)).toEqual(['ADDED', 'OUT_OF_SERVICE', 'IN_SERVICE']);
    // only the requester (or facility) confirms
    expect(
      (await c.nurse2.post(`/facility/tickets/${tk.body.id}/action`).send({ action: 'CONFIRM' }))
        .status,
    ).toBe(403);
    const closed = await c.nurse
      .post(`/facility/tickets/${tk.body.id}/action`)
      .send({ action: 'CONFIRM' });
    expect(closed.body.status).toBe('CLOSED');

    // A failed calibration takes it out of service again; the next due date moves on
    const cal = await c.fac
      .post(`/facility/assets/${vent.body.id}/pm`)
      .send({ kind: 'CALIBRATION', passed: false, notes: 'Oxygen sensor drift' });
    expect(cal.body).toMatchObject({ status: 'OUT_OF_SERVICE', nextCalibrationDue: ymd(180) });
    const pm = await c.fac.post(`/facility/assets/${vent.body.id}/pm`).send({ kind: 'PM' });
    expect(pm.body.nextPmDue).toBe(ymd(90));
  });

  it('records biomedical waste by colour and flags a handover mismatch', async () => {
    const c = await hospital();
    await c.nurse
      .post('/facility/waste')
      .send({ ward: 'General Ward', yellow: 2.5, red: 1.2, white: 0.3, blue: 0.4 });
    await c.fac
      .post('/facility/waste')
      .send({ ward: 'ICU', yellow: 4, red: 2, white: 0.5, blue: 0 });
    // re-entering a ward's day replaces it
    await c.nurse
      .post('/facility/waste')
      .send({ ward: 'General Ward', yellow: 3, red: 1.2, white: 0.3, blue: 0.4 });
    const day = (await c.fac.get('/facility/waste')).body;
    expect(day.total).toEqual({ yellow: 7, red: 3.2, white: 0.8, blue: 0.4 });
    const ok = await c.fac.post('/facility/waste/handover').send({
      manifestNo: 'MF-1001',
      vehicle: 'MH12AB1234',
      weights: { yellow: 7.1, red: 3.2, white: 0.8, blue: 0.4 },
    });
    expect(ok.body.handovers[0].mismatch).toBe(false);
    const bad = await c.fac.post('/facility/waste/handover').send({
      manifestNo: 'MF-1002',
      weights: { yellow: 5, red: 3.2, white: 0.8, blue: 0.4 },
    });
    expect(bad.body.handovers.find((h) => h.manifestNo === 'MF-1002').mismatch).toBe(true);
    const rep = (await c.fac.get(`/facility/waste/report?month=${ymd().slice(0, 7)}`)).body;
    expect(rep).toMatchObject({ handovers: 2, mismatches: 1, days: 1 });
    expect(rep.byWard.map((w) => w.ward)).toEqual(['General Ward', 'ICU']);
  });
});
