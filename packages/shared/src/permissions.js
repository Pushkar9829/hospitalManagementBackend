/**
 * Permission keys are `module:resource:action`. A role may hold exact keys or wildcards:
 * `billing:invoice:*` (every action on a resource), `billing:*` (whole module), `billing:*:read`
 * (read anything in billing), `*:*:read` (read-only everywhere) or `*` (everything).
 * The same matcher runs on the API (guards) and in the web app (menus, buttons).
 */
export function hasPermission(granted, key) {
  if (!granted || !key) return false;
  const set = granted instanceof Set ? granted : new Set(granted);
  if (set.has('*') || set.has(key)) return true;
  const want = key.split(':');
  for (const pattern of set) {
    if (pattern.includes('*') && matches(pattern.split(':'), want)) return true;
  }
  return false;
}

/**
 * Segment match: `*` matches one segment, and a trailing `*` also covers every deeper segment.
 * `billing:*` covers `billing:bill:create`; `*:*:read` covers every read; `billing:*:read` covers
 * every billing read.
 */
function matches(pattern, want) {
  for (let i = 0; i < pattern.length; i++) {
    const last = i === pattern.length - 1;
    if (pattern[i] === '*') {
      if (last) return want.length >= i + 1;
      if (want[i] === undefined) return false;
      continue;
    }
    if (pattern[i] !== want[i]) return false;
  }
  return pattern.length === want.length;
}

/** True when every key is granted. */
export function hasAll(granted, keys) {
  return keys.every((k) => hasPermission(granted, k));
}

/** True when the key is `*` or 2-3 segments (`module:*`, `module:resource:action`, wildcards allowed). */
export function isPermissionKey(key) {
  return key === '*' || /^([a-z][a-z0-9-]*|\*)(:([a-z][a-z0-9-]*|\*)){1,2}$/.test(key);
}

/** Read-only form of a key: `lab:*` -> `lab:*:read`, `lab:sample:*` -> `lab:sample:read`. */
export function toReadOnly(key) {
  const [mod, res = '*'] = key.split(':');
  return `${mod}:${res}:read`;
}

/** Phase 0 kernel permissions. Module permissions are added by each module. */
export const P = Object.freeze({
  AUDIT_READ: 'audit:log:read',
  AUDIT_EXPORT: 'audit:log:export',
  APPROVALS_READ: 'approvals:inbox:read',
  APPROVALS_DECIDE: 'approvals:inbox:decide',
  SETTINGS_HOSPITAL: 'settings:hospital:*',
  SETTINGS_USERS: 'settings:user:*',
  SETTINGS_ROLES: 'settings:role:*',
  SETTINGS_SUBSCRIPTION_READ: 'settings:subscription:read',
  DASHBOARD_ADMIN: 'dashboard:admin:read',
});
