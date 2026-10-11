import { describe, expect, it } from 'vitest';
import { DEFAULT_APPROVAL_RULES, levelsFor } from '../src/approvals.js';
import { ROLE_GRANTS, systemRolePermissions } from '../src/grants.js';
import { PANELS } from '../src/catalog/panels.js';
import { hasPermission, isPermissionKey } from '../src/permissions.js';

describe('approval rules and role grants', () => {
  it('applies the second discount level above 10% or ₹10,000', () => {
    const discount = DEFAULT_APPROVAL_RULES.find((r) => r.action === 'billing.discount');
    expect(levelsFor(discount, { percent: 10, amount: 10_000_00 })).toHaveLength(1);
    expect(levelsFor(discount, { percent: 10.5, amount: 100 })).toHaveLength(2);
    expect(levelsFor(discount, { percent: 2, amount: 10_000_01 })).toHaveLength(2);
  });

  it('every approval level has at least one system role that can decide it', () => {
    const roles = Object.keys(PANELS).filter((k) => k !== 'superadmin');
    for (const rule of DEFAULT_APPROVAL_RULES) {
      for (const level of rule.levels) {
        if (level.label === 'Super Admin' || level.label === 'Manager') continue;
        const holders = roles.filter((r) =>
          hasPermission(systemRolePermissions(r), level.permission),
        );
        expect(holders.length, `${rule.action} ${level.label}`).toBeGreaterThan(0);
      }
    }
  });

  it('grants only well-formed permission keys to known role panels', () => {
    for (const [panel, keys] of Object.entries(ROLE_GRANTS)) {
      expect(PANELS[panel], panel).toBeDefined();
      for (const k of keys) expect(isPermissionKey(k), `${panel}: ${k}`).toBe(true);
    }
  });
});
