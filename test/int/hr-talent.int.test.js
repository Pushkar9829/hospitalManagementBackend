import { describe, expect, it } from 'vitest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';

const ctx = useIntegration();
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

async function hospital() {
  const t = await makeTenant({ modules: ['OPD', 'HRM'] });
  const users = {
    hr: await makeUser(t, { username: 'hr', roles: ['hr'] }),
    mgr: await makeUser(t, { username: 'mgr', roles: ['employee'] }),
    emp: await makeUser(t, { username: 'emp', roles: ['employee'] }),
  };
  const c = {};
  for (const u of Object.keys(users)) c[u] = await signIn(ctx.app, t.host, u);
  const hire = async (body) => {
    const res = await c.hr
      .post('/hr/employees')
      .send({ joinedOn: '2025-04-01', gender: 'F', ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  return { t, users, c, hire };
}

describe('HR talent', () => {
  it('recruits a candidate through to joining', async () => {
    const { c } = await hospital();
    const o = await c.hr.post('/hr/openings').send({ title: 'Staff nurse', positions: 1 });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    const cand = await c.hr
      .post(`/hr/openings/${o.body.id}/candidates`)
      .send({ name: 'Priya Menon', mobile: '9876543210', source: 'Referral' });
    expect(cand.status).toBe(201);
    let v = cand.body;
    // Cannot skip straight to the offer
    expect(
      (
        await c.hr
          .post(`/hr/candidates/${v.id}/move`)
          .send({ version: v.version, stage: 'OFFERED' })
      ).status,
    ).toBe(409);
    for (const step of [
      { stage: 'SCREENED' },
      { stage: 'INTERVIEW', interview: { rating: 4, notes: 'Good ICU experience' } },
      { stage: 'OFFERED', offer: { ctc: 3_60_000_00, joinOn: today() } },
    ]) {
      const r = await c.hr
        .post(`/hr/candidates/${v.id}/move`)
        .send({ version: v.version, ...step });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      v = r.body;
    }
    expect(v.interviews[0]).toMatchObject({ rating: 4 });
    const hired = await c.hr
      .post(`/hr/candidates/${v.id}/hire`)
      .send({ version: v.version, gender: 'F' });
    expect(hired.status, JSON.stringify(hired.body)).toBe(200);
    expect(hired.body.employee).toMatchObject({ name: 'Priya Menon', designation: 'Staff nurse' });
    expect(hired.body.candidate.stage).toBe('JOINED');
    const list = (await c.hr.get('/hr/openings')).body.items[0];
    expect(list).toMatchObject({ status: 'CLOSED', pipeline: { JOINED: 1 } });
  });

  it('tracks mandatory training, appraises through manager and HR, clears an exit', async () => {
    const { users, c, hire } = await hospital();
    const mgr = await hire({
      name: { first: 'Anil', last: 'Rao' },
      userId: String(users.mgr._id),
      gender: 'M',
    });
    const emp = await hire({
      name: { first: 'Bala' },
      userId: String(users.emp._id),
      managerId: mgr.id,
    });

    // Training: BLS for both; fire safety for nobody yet
    const s = await c.hr
      .post('/hr/training')
      .send({
        title: 'BLS refresher',
        topic: 'bls',
        date: today(),
        hours: 4,
        employeeIds: [mgr.id, emp.id],
      });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect(s.body).toMatchObject({ topic: 'BLS', mandatory: true, validMonths: 24 });
    const marked = await c.hr.put(`/hr/training/${s.body.id}/attendance`).send({
      version: s.body.version,
      attendees: [
        { employeeId: mgr.id, attended: true, score: 90 },
        { employeeId: emp.id, attended: false },
      ],
    });
    expect(marked.status).toBe(200);
    const comp = (await c.hr.get('/hr/training/compliance')).body;
    expect(comp.topics.find((x) => x.topic === 'BLS')).toMatchObject({
      compliant: 1,
      total: 2,
      percent: 50,
    });
    expect(
      comp.gaps
        .filter((g) => g.name === 'Bala')
        .map((g) => g.topic)
        .sort(),
    ).toEqual(['BLS', 'BMW', 'FIRE', 'INFECTION']);

    // Appraisal: weights must add up to 100
    const goals = [
      { title: 'Patient care', weight: 60 },
      { title: 'Teamwork', weight: 40 },
    ];
    expect(
      (
        await c.hr
          .post('/hr/appraisal-cycles')
          .send({
            name: 'FY 2026-27',
            from: '2026-04-01',
            to: '2027-03-31',
            goals: [{ title: 'x', weight: 50 }],
          })
      ).status,
    ).toBe(422);
    const cyc = await c.hr
      .post('/hr/appraisal-cycles')
      .send({ name: 'FY 2026-27', from: '2026-04-01', to: '2027-03-31', goals });
    expect(cyc.status, JSON.stringify(cyc.body)).toBe(201);

    const mine = (await c.emp.get('/me/appraisal')).body;
    expect(mine.appraisal).toMatchObject({ status: 'SELF', managerName: 'Anil Rao' });
    const self = await c.emp
      .post(`/me/appraisal/${mine.appraisal.id}/self`)
      .send({ version: mine.appraisal.version, ratings: [4, 3], comments: 'Handled ICU overflow' });
    expect(self.status, JSON.stringify(self.body)).toBe(200);
    expect(self.body).toMatchObject({ status: 'MANAGER', selfRating: 3.6 });
    // Only the manager can review
    expect(
      (
        await c.emp
          .post(`/me/appraisal/${mine.appraisal.id}/manager`)
          .send({ version: self.body.version, ratings: [5, 5] })
      ).status,
    ).toBe(404);
    const team = (await c.mgr.get('/me/appraisal')).body.team;
    expect(team.map((a) => a.name)).toEqual(['Bala']);
    const rev = await c.mgr
      .post(`/me/appraisal/${team[0].id}/manager`)
      .send({ version: team[0].version, ratings: [4, 4] });
    expect(rev.body).toMatchObject({ status: 'HR', managerRating: 4 });
    const fin = await c.hr
      .post(`/hr/appraisals/${rev.body.id}/final`)
      .send({ version: rev.body.version, finalRating: 4 });
    expect(fin.body.status).toBe('DONE');
    // The manager's own appraisal (no manager) is still open, so the cycle cannot close
    expect(
      (
        await c.hr
          .post(`/hr/appraisal-cycles/${cyc.body.id}/close`)
          .send({ version: cyc.body.version })
      ).status,
    ).toBe(409);

    // Exit and clearances
    const gone = await c.hr
      .post(`/hr/employees/${emp.id}/exit`)
      .send({ exitOn: '2099-01-31', reason: 'Relocating' });
    expect(gone.body.status).toBe('NOTICE');
    let ex = (await c.hr.get('/hr/exits')).body.items[0];
    expect(ex).toMatchObject({ name: 'Bala', cleared: false });
    for (const dept of ['DEPARTMENT', 'IT', 'STORE', 'FINANCE', 'HR']) {
      const r = await c.hr.post(`/hr/exits/${emp.id}/clear`).send({ version: ex.version, dept });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      ex = r.body;
    }
    expect(ex.cleared).toBe(true);
    expect(
      (await c.hr.post(`/hr/exits/${emp.id}/clear`).send({ version: ex.version, dept: 'IT' }))
        .status,
    ).toBe(409);
  });
});
