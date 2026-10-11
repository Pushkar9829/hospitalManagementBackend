import { describe, expect, it } from 'vitest';
import { client, makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Complaint, Incident } from '../../src/modules/quality/index.js';
import { Feedback } from '../../src/modules/quality/models/quality.models.js';
import { escalateOverdue } from '../../src/modules/quality/services/quality.service.js';

const ctx = useIntegration();
const month = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

async function hospital() {
  const t = await makeTenant({ modules: ['OPD', 'IPD', 'LAB', 'QLT'] });
  for (const [u, r] of [
    ['qm', 'quality'],
    ['qm2', 'quality'],
    ['nurse', 'nurse'],
    ['fo', 'frontoffice'],
  ])
    await makeUser(t, { username: u, roles: [r] });
  const c = { t };
  for (const u of ['qm', 'qm2', 'nurse', 'fo']) c[u] = await signIn(ctx.app, t.host, u);
  return c;
}

async function approve(c, approvalId) {
  const a = (await c.get(`/approvals/${approvalId}`)).body;
  const res = await c
    .post(`/approvals/${approvalId}/decision`)
    .send({ decision: 'APPROVE', version: a.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const fall = {
  type: 'FALL',
  severity: 'MILD',
  occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
  location: 'General Ward bed 3',
  description: 'Patient slipped while walking to the toilet at night',
  immediateAction: 'Assessed by the doctor; no fracture',
};

describe('Quality (Phase 6)', () => {
  it('takes named and anonymous incidents through root cause and CAPA to approved closure', async () => {
    const c = await hospital();
    const named = await c.nurse.post('/quality/incidents').send(fall);
    expect(named.status, JSON.stringify(named.body)).toBe(201);
    expect(named.body.incidentNo).toMatch(/^INC\//);
    const anon = await c.nurse.post('/quality/incidents/anonymous').send({
      ...fall,
      type: 'MEDICATION_ERROR',
      severity: 'NO_HARM',
      description: 'Insulin given at the wrong time; caught at the next check',
    });
    expect(anon.status).toBe(201);
    const stored = await runAsSystem(c.t.tenant._id, () =>
      Incident.findById(anon.body.id).lean().exec(),
    );
    expect(stored.createdBy).toBeUndefined();
    expect(stored.reportedBy?.userId).toBeUndefined();

    // the reporter sees only their named report; quality sees both, anonymous without a name
    expect((await c.nurse.get('/quality/incidents')).body.items.map((i) => i.id)).toEqual([
      named.body.id,
    ]);
    const all = (await c.qm.get('/quality/incidents')).body.items;
    expect(all).toHaveLength(2);
    expect(all.find((i) => i.id === anon.body.id)).toMatchObject({
      anonymous: true,
      reportedBy: null,
    });

    const inv = await c.qm.post(`/quality/incidents/${named.body.id}/investigation`).send({
      investigator: 'Nursing superintendent',
      rootCause: 'Wet floor, no night light near the toilet',
      contributing: ['Sedation', 'Lighting'],
      actions: [
        { text: 'Install night lights', kind: 'CORRECTIVE', owner: 'Facility', dueOn: today() },
        {
          text: 'Falls risk reassessment each shift',
          kind: 'PREVENTIVE',
          owner: 'Nursing',
          dueOn: today(),
        },
      ],
    });
    expect(inv.body.status).toBe('CAPA');
    expect((await c.qm.post(`/quality/incidents/${named.body.id}/close`)).body.error.code).toBe(
      'ACTIONS_OPEN',
    );
    for (const a of inv.body.actions)
      await c.qm.post(`/quality/incidents/${named.body.id}/actions/${a.id}/done`);
    const closing = await c.qm.post(`/quality/incidents/${named.body.id}/close`);
    expect(closing.status, JSON.stringify(closing.body)).toBe(202);
    expect(closing.body.status).toBe('PENDING_CLOSURE');
    const self = (await c.qm.get(`/approvals/${closing.body.approvalId}`)).body;
    expect(
      (
        await c.qm
          .post(`/approvals/${closing.body.approvalId}/decision`)
          .send({ decision: 'APPROVE', version: self.version })
      ).body.error.code,
    ).toBe('MAKER_CANNOT_CHECK');
    await approve(c.qm2, closing.body.approvalId);
    expect((await c.qm.get(`/quality/incidents/${named.body.id}`)).body.status).toBe('CLOSED');
  });

  it('turns poor public feedback into a complaint, escalates overdue complaints and closes with a message', async () => {
    const c = await hospital();
    const token = 'a'.repeat(32);
    await runAsSystem(c.t.tenant._id, () =>
      Feedback.create([
        {
          token,
          source: 'OPD',
          refId: 'v1',
          patient: { name: 'Ravi Kumar', mobile: '9876543210' },
          department: 'Cardiology',
          sentAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ]),
    );
    const anon = client(ctx.app, c.t.host);
    const form = await anon.get(`/feedback/${token}`);
    expect(form.status, JSON.stringify(form.body)).toBe(200);
    expect(form.body).toMatchObject({ patient: 'Ravi', department: 'Cardiology', answered: false });
    const sent = await anon.post(`/feedback/${token}`).send({
      overall: 1,
      doctor: 4,
      billing: 1,
      nps: 2,
      comment: 'Waited two hours at billing',
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(
      (await anon.post(`/feedback/${token}`).send({ overall: 5, nps: 10 })).body.error.code,
    ).toBe('ALREADY_ANSWERED');
    expect((await anon.get(`/feedback/${'b'.repeat(32)}`)).status).toBe(404);

    const fb = (await c.qm.get(`/quality/feedback?from=${today()}&to=${today()}`)).body;
    expect(fb).toMatchObject({ sent: 1, responses: 1, nps: -100 });
    expect(fb.byDepartment[0]).toMatchObject({ department: 'Cardiology', overall: 1 });
    expect(fb.comments[0].complaintId).toBeTruthy();

    const list = (await c.qm.get('/quality/complaints')).body.items;
    expect(list[0]).toMatchObject({ source: 'FEEDBACK', priority: 'HIGH', patient: 'Ravi Kumar' });

    // Front office registers a complaint; it goes overdue and escalates
    const cmp = await c.fo.post('/quality/complaints').send({
      source: 'FRONT_OFFICE',
      contactName: 'Sunita Patil',
      contactMobile: '9822001122',
      category: 'STAFF_BEHAVIOUR',
      description: 'Rude reply at the registration counter',
    });
    expect(cmp.status, JSON.stringify(cmp.body)).toBe(201);
    await runAsSystem(c.t.tenant._id, async () => {
      await Complaint.updateOne(
        { _id: cmp.body.id },
        { $set: { dueAt: new Date(Date.now() - 1000) } },
      );
      expect(await escalateOverdue()).toBe(1);
    });
    expect(
      (await c.qm.post(`/quality/complaints/${cmp.body.id}/action`).send({ action: 'RESOLVE' }))
        .status,
    ).toBe(422);
    await c.qm
      .post(`/quality/complaints/${cmp.body.id}/action`)
      .send({ action: 'RESOLVE', note: 'Counselled the staff member; apology call made' });
    const closed = await c.qm
      .post(`/quality/complaints/${cmp.body.id}/action`)
      .send({ action: 'CLOSE' });
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.messageSentAt).toBeTruthy();
    expect(closed.body.log.map((l) => l.status)).toEqual([
      'OPEN',
      'ESCALATED',
      'RESOLVED',
      'CLOSED',
    ]);
  });

  it('scores audits, controls documents, computes HAI rates and monthly indicators', async () => {
    const c = await hospital();
    const tpl = (await c.qm.get('/quality/audit-templates')).body.items.find(
      (x) => x.code === 'HAND_HYGIENE',
    );
    const answers = tpl.items.map((item, i) => ({ item, result: i === 4 ? 'NO' : 'YES' }));
    expect(
      (
        await c.qm
          .post('/quality/audits')
          .send({ templateCode: 'HAND_HYGIENE', area: 'ICU', answers })
      ).status,
    ).toBe(422);
    const audit = await c.qm.post('/quality/audits').send({
      templateCode: 'HAND_HYGIENE',
      area: 'ICU',
      answers,
      actions: [{ text: 'Re-train on moment 5', owner: 'ICU in-charge', dueOn: today() }],
    });
    expect(audit.status).toBe(201);
    expect(audit.body.score).toBe(80);

    const v1 = await c.qm.post('/quality/documents').send({
      code: 'sop-ns-01',
      title: 'Falls prevention',
      kind: 'SOP',
      reviewOn: '2027-10-01',
    });
    expect(v1.status).toBe(201);
    expect((await c.qm.post(`/quality/documents/${v1.body.id}/approve`)).body.error.code).toBe(
      'MAKER_CANNOT_CHECK',
    );
    await c.qm2.post(`/quality/documents/${v1.body.id}/approve`);
    const seen = (await c.nurse.get('/quality/documents')).body.items;
    expect(seen.map((d) => d.code)).toEqual(['SOP-NS-01']);
    const ack = await c.nurse.post(`/quality/documents/${v1.body.id}/acknowledge`);
    expect(ack.body).toMatchObject({ acknowledged: 1, acknowledgedByMe: true });
    const v2 = await c.qm.post('/quality/documents').send({
      code: 'SOP-NS-01',
      title: 'Falls prevention (revised)',
      reviewOn: '2028-10-01',
    });
    expect(v2.body.docVersion).toBe(2);
    await c.qm2.post(`/quality/documents/${v2.body.id}/approve`);
    const after = (await c.qm.get('/quality/documents?status=ACTIVE,RETIRED')).body.items;
    expect(after.map((d) => `${d.docVersion}:${d.status}`)).toEqual(['2:ACTIVE', '1:RETIRED']);

    await c.qm.put('/quality/infection/device-days').send({
      month: month(),
      ward: 'ICU',
      catheter: 400,
      centralLine: 120,
      ventilator: 90,
    });
    await c.qm
      .post('/quality/infection/cases')
      .send({ type: 'CAUTI', ward: 'ICU', onsetOn: today(), organism: 'E. coli' });
    const hai = (await c.qm.get(`/quality/infection?month=${month()}`)).body;
    expect(hai.cauti).toEqual({ cases: 1, deviceDays: 400, rate: 2.5 });
    expect(hai.vap.rate).toBe(0);

    await c.qm.put('/quality/settings').send({ targets: { opdWaitMin: 20 } });
    const ind = (await c.qm.get(`/quality/indicators?month=${month()}`)).body;
    expect(ind.items.map((i) => i.key)).toEqual([
      'opdWaitMin',
      'dischargeTatMin',
      'labTatMin',
      'criticalCallMin',
      'medErrorsPer1000',
      'fallsPer1000',
      'bedOccupancyPct',
      'icuReturn48h',
      'nps',
      'complaintsOnTimePct',
    ]);
    expect(ind.items.find((i) => i.key === 'opdWaitMin').target).toBe(20);
    expect(ind.items.find((i) => i.key === 'icuReturn48h')).toMatchObject({ value: 0, met: true });
  });
});
