import { describe, expect, it } from 'vitest';
import { makeUser, signIn, useIntegration } from '../helpers/int.js';
import { wardHospital } from '../helpers/ward.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { ReportSchedule } from '../../src/core/reports/report.models.js';
import { nextRun, runDueSchedules } from '../../src/core/reports/reports.service.js';

const ctx = useIntegration();
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const ALL = ['LAB', 'RAD', 'PHR', 'INV', 'HRM', 'PAY', 'FIN', 'MRD', 'DIET', 'FAC', 'QLT', 'CRM'];

describe('Reports centre (Phase 6)', () => {
  it('lists, runs and exports reports by permission, and every report runs', async () => {
    const h = await wardHospital(ctx, { modules: ALL });
    await makeUser(h.t, { username: 'cash', roles: ['cashier'] });
    await makeUser(h.t, { username: 'hrm', roles: ['hr'] });
    const sa = await signIn(ctx.app, h.t.host);
    const cash = await signIn(ctx.app, h.t.host, 'cash');
    const hrm = await signIn(ctx.app, h.t.host, 'hrm');
    await h.admit('Arun', 'GW-01');
    await h.admit('Bina', 'PW-01', 'F');

    // Catalogue by permission
    const cat = (await sa.get('/reports')).body.groups;
    const codes = cat.flatMap((g) => g.reports.map((r) => r.code));
    expect(codes.length).toBe(44);
    expect(cat.map((g) => g.name)[0]).toBe('Front office and OPD');
    expect((await cash.get('/reports')).body.groups).toEqual([]);
    const hrCodes = (await hrm.get('/reports')).body.groups.flatMap((g) =>
      g.reports.map((r) => r.code),
    );
    expect(hrCodes).toContain('payroll-register');
    expect(hrCodes).not.toContain('daily-collection');
    expect((await cash.get('/reports/ipd-admission-register')).status).toBe(403);

    // Every registered report runs for today without error
    for (const code of codes) {
      const res = await sa.get(`/reports/${code}?from=${today()}&to=${today()}`);
      expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toMatchObject({ code, period: { from: today(), to: today() } });
      expect(Array.isArray(res.body.items)).toBe(true);
    }

    const reg = (await sa.get(`/reports/ipd-admission-register?from=${today()}&to=${today()}`))
      .body;
    expect(reg.total).toBe(2);
    expect(reg.kpis.find((k) => k.key === 'admissions').value).toBe(2);
    expect(reg.columns.map((c) => c.key)).toContain('ipNo');
    const searched = (await sa.get(`/reports/ipd-admission-register?q=bina`)).body;
    expect(searched.items.map((r) => r.patient)).toEqual(['Bina Kumar']);
    // a module's own analytics route still answers before the reports centre
    expect((await sa.get('/reports/ipd-census')).body.code).toBeUndefined();
    expect((await sa.get('/reports/nope-nope')).status).toBe(404);
    expect(
      (await sa.get('/reports/ipd-admission-register?from=2026-01-10&to=2026-01-01')).status,
    ).toBe(422);

    // Exports to XLSX and PDF, with a download link
    for (const format of ['XLSX', 'PDF']) {
      const ex = await sa
        .post('/reports/ipd-admission-register/export')
        .send({ format, filters: { from: today(), to: today() } });
      expect(ex.status, JSON.stringify(ex.body)).toBe(201);
      expect(ex.body).toMatchObject({ status: 'READY', rows: 2, format });
      const dl = await sa.get(`/reports/exports/${ex.body.id}/download`);
      expect(dl.body.url).toMatch(/\/api\/files\/local\//);
    }
    expect((await sa.get('/reports/exports')).body.total).toBe(2);
    expect((await hrm.get('/reports/exports')).body.total).toBe(0); // only one's own

    // Dashboard tiles by permission
    const dash = (await sa.get('/reports/dashboard')).body.groups;
    const tiles = dash.flatMap((g) => g.items.map((i) => i.key));
    expect(tiles).toEqual(expect.arrayContaining(['ipd-census', 'billing-today', 'staff-today']));
    expect(dash.flatMap((g) => g.items).find((i) => i.key === 'ipd-census').value).toBe(2);
    expect((await cash.get('/reports/dashboard')).body.groups).toEqual([]);
  });

  it('runs a schedule when due with its creator’s permissions', async () => {
    const h = await wardHospital(ctx, { modules: ['HRM', 'PAY'] });
    await makeUser(h.t, { username: 'hrm', roles: ['hr'] });
    const hrm = await signIn(ctx.app, h.t.host, 'hrm');
    expect(
      (
        await hrm
          .post('/reports/schedules')
          .send({ reportCode: 'daily-collection', frequency: 'DAILY', time: '07:00' })
      ).status,
    ).toBe(403);
    const s = await hrm.post('/reports/schedules').send({
      reportCode: 'headcount-attrition',
      frequency: 'WEEKLY',
      dayOfWeek: 1,
      time: '07:30',
      recipients: ['hr@example.org'],
    });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const next = new Date(s.body.nextRunAt);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    // Monday 07:30 IST is 02:00 UTC
    expect([next.getUTCDay(), next.getUTCHours(), next.getUTCMinutes()]).toEqual([1, 2, 0]);
    expect(
      nextRun(
        { frequency: 'MONTHLY', dayOfMonth: 1, time: '06:00' },
        new Date('2026-10-15T00:00:00Z'),
      ).toISOString(),
    ).toBe('2026-11-01T00:30:00.000Z');

    const ran = await runAsSystem(
      h.t.tenant._id,
      () => runDueSchedules(new Date(next.getTime() + 60_000)),
      { modules: new Set(['CORE', 'HRM', 'PAY']) },
    );
    expect(ran).toBe(1);
    const exports = (await hrm.get('/reports/exports')).body.items;
    expect(exports[0]).toMatchObject({
      reportCode: 'headcount-attrition',
      status: 'READY',
      format: 'XLSX',
    });
    const after = await runAsSystem(h.t.tenant._id, () =>
      ReportSchedule.findById(s.body.id).lean().exec(),
    );
    expect(after.nextRunAt.getTime()).toBeGreaterThan(next.getTime());
    expect(
      (await hrm.put(`/reports/schedules/${s.body.id}`).send({ active: false })).body.active,
    ).toBe(false);
    expect((await hrm.delete(`/reports/schedules/${s.body.id}`)).status).toBe(204);
  });
});
