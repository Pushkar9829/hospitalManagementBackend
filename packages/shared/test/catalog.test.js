import { describe, expect, it } from 'vitest';
import { PANELS, SCREENS, buildMenu, canSeeScreen } from '../src/catalog/index.js';
import { BLOOD_GROUPS } from '../src/enums/patient.js';
import { BED_STATUS } from '../src/enums/status.js';

describe('catalogue', () => {
  it('has every role panel from the design with a home screen', () => {
    expect(Object.keys(PANELS)).toHaveLength(28);
    for (const p of Object.values(PANELS)) expect(SCREENS[p.home], p.name).toBeDefined();
  });

  it('hides unsubscribed modules and screens without permission', () => {
    const ctx = { modules: ['IPD'], permissions: PANELS.nurse.permissions };
    expect(canSeeScreen(SCREENS.OpdTriage, ctx)).toBe(false);
    expect(canSeeScreen(SCREENS.Nursing, { ...ctx, modules: ['IPD', 'NUR'] })).toBe(true);
    const menu = buildMenu(['nurse'], {
      modules: ['IPD', 'NUR'],
      permissions: PANELS.nurse.permissions,
    });
    const labels = menu.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain('Nursing Station');
    expect(labels).not.toContain('OPD Triage');
  });

  it('shows screens to roles with read-only access to them', () => {
    const nurse = { modules: ['IPD', 'NUR', 'LAB'], permissions: PANELS.nurse.permissions };
    expect(PANELS.nurse.permissions).toContain('lab:*:read');
    expect(canSeeScreen(SCREENS.Lab, nurse)).toBe(true);
    expect(canSeeScreen(SCREENS.Lab, { ...nurse, permissions: ['opd:visit:read'] })).toBe(false);
    expect(
      canSeeScreen(SCREENS.OpdCheckin, { modules: ['OPD'], permissions: ['opd:visit:read'] }),
    ).toBe(true);
  });

  it('keeps read-only panels read-only', () => {
    const writes = PANELS.auditor.permissions.filter(
      (k) => !/:read$|^audit:log:export$|^myspace:\*$/.test(k),
    );
    expect(writes).toEqual([]);
  });

  it('includes Rh-negative blood groups and never shows a normal bed state in red', () => {
    expect(BLOOD_GROUPS).toEqual(expect.arrayContaining(['A-', 'B-', 'AB-', 'O-']));
    expect(BED_STATUS.OCCUPIED.tone).not.toBe('critical');
  });
});
