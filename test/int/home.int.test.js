import { describe, expect, it } from 'vitest';
import { MODULE_CODES } from '@hms/shared';
import { useIntegration, makeUser, signIn } from '../helpers/int.js';
import { wardHospital } from '../helpers/ward.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { allHomeWidgets, istDay, PANELS_ALL } from '../../src/core/home/registry.js';

const ctx = useIntegration();
const byId = (res) => Object.fromEntries(res.body.widgets.map((w) => [w.id, w]));

describe('role home pages', () => {
  it('builds every widget without an error, on an empty and a busy hospital', async () => {
    const { t, admit } = await wardHospital(ctx, {
      modules: MODULE_CODES.filter((m) => m !== 'CORE'),
    });
    const day = istDay();
    const run = () =>
      runAsSystem(t.tenant._id, async () => {
        const failed = [];
        for (const w of allHomeWidgets())
          for (const panel of w.panels) {
            const ctx2 = {
              panel,
              userId: null,
              branchId: t.branch._id,
              today: day.today,
              day,
              now: new Date(),
            };
            await w.build(ctx2).catch((e) => failed.push(`${w.id} on ${panel}: ${e.message}`));
          }
        return failed;
      });
    expect(await run()).toEqual([]);
    await admit('Ravi', 'GW-01');
    expect(await run()).toEqual([]);
    expect(allHomeWidgets().length).toBeGreaterThan(60);
    expect(
      PANELS_ALL.every(
        (p) => p === 'superadmin' || allHomeWidgets().some((w) => w.panels.includes(p)),
      ),
    ).toBe(true);
  });

  it('shows each role its own widgets, checked against its permissions', async () => {
    const { t, admit } = await wardHospital(ctx, {
      modules: ['LAB'],
      users: [
        ['nurse1', 'nurse'],
        ['cash1', 'cashier'],
      ],
    });
    await admit('Ravi', 'GW-01');
    await admit('Sita', 'PW-01', 'F');
    const nurse = await signIn(ctx.app, t.host, 'nurse1');
    const home = await nurse.get('/home?panel=nurse');
    expect(home.status).toBe(200);
    const w = byId(home);
    expect(w['ipd.inpatients']).toMatchObject({ kind: 'kpi', value: 2, format: 'count' });
    expect(w['ipd.occupancy']).toBeUndefined(); // not on the nurse's panel
    expect(w['lab.critical']).toMatchObject({ kind: 'alerts', items: [] });

    const fo = await signIn(ctx.app, t.host, 'fo');
    const front = byId(await fo.get('/home?panel=frontoffice'));
    expect(front['ipd.occupancy']).toMatchObject({ value: 50, params: { occupied: 2, beds: 4 } });
    expect(front['fo.registered'].value).toBe(2);

    const cash = await signIn(ctx.app, t.host, 'cash1');
    const cashier = byId(await cash.get('/home?panel=cashier'));
    expect(cashier['bill.myShift']).toMatchObject({ value: null, params: { context: 'closed' } });
    // A widget the role has no permission for is never built, whatever panel is asked for.
    const asked = byId(await cash.get('/home?panel=hr'));
    expect(asked['hr.present']).toBeUndefined();

    const doc = await signIn(ctx.app, t.host, 'doc');
    const doctor = byId(await doc.get('/home?panel=doctor'));
    expect(doctor['ipd.myPatients']).toMatchObject({ value: 2, params: { icu: 0 } });
    expect(doctor['opd.myQueue']).toMatchObject({ kind: 'list', rows: [] });

    expect((await nurse.get('/home?panel=nobody')).status).toBe(422);
    await makeUser(t, { username: 'emp1', roles: ['employee'] });
    const emp = await signIn(ctx.app, t.host, 'emp1');
    expect((await emp.get('/home?panel=employee')).status).toBe(200);
  });
});
