import { describe, expect, it } from 'vitest';
import { hasPermission, isPermissionKey, toReadOnly } from '../src/permissions.js';

describe('hasPermission', () => {
  it('matches exact keys and wildcards', () => {
    expect(hasPermission(['billing:bill:create'], 'billing:bill:create')).toBe(true);
    expect(hasPermission(['billing:bill:*'], 'billing:bill:create')).toBe(true);
    expect(hasPermission(['billing:*'], 'billing:shift:close')).toBe(true);
    expect(hasPermission(['*'], 'payroll:run:lock')).toBe(true);
  });

  it('supports read-only wildcards', () => {
    expect(hasPermission(['billing:*:read'], 'billing:bill:read')).toBe(true);
    expect(hasPermission(['billing:*:read'], 'billing:bill:create')).toBe(false);
    expect(hasPermission(['*:*:read'], 'lab:result:read')).toBe(true);
    expect(hasPermission(['*:*:read'], 'lab:result:release')).toBe(false);
  });

  it('never leaks across modules or resources', () => {
    expect(hasPermission(['bill:*'], 'billing:bill:create')).toBe(false);
    expect(hasPermission(['billing:bill:*'], 'billing:refund:create')).toBe(false);
    expect(hasPermission(['billing:bill'], 'billing:bill:create')).toBe(false);
    expect(hasPermission([], 'billing:bill:create')).toBe(false);
    expect(hasPermission(undefined, 'x:y:z')).toBe(false);
  });

  it('validates keys and builds read-only forms', () => {
    expect(isPermissionKey('opd:visit:create')).toBe(true);
    expect(isPermissionKey('opd:*')).toBe(true);
    expect(isPermissionKey('self')).toBe(false);
    expect(isPermissionKey('reports:{module}:read')).toBe(false);
    expect(toReadOnly('lab:*')).toBe('lab:*:read');
    expect(toReadOnly('lab:sample:*')).toBe('lab:sample:read');
  });
});
