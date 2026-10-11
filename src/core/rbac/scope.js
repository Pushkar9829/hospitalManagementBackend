import mongoose from 'mongoose';
import { current } from '../tenancy/context.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Query filter for the user's data scope (spec 4.1: OWN, DEPARTMENT, BRANCH, ALL; ward comes
 * with nursing). Modules name the fields their records use; a field left out means the scope
 * does not apply to that collection and the next wider rule is used.
 *
 *   Bill.find({ ...scopeFilter({ own: 'createdBy', branch: 'branchId' }), status: 'DUE' })
 *
 * BRANCH limits to the branch the user is working in (x-branch-id), not every branch they hold.
 */
export function scopeFilter({ own, department, branch } = {}) {
  const c = current();
  if (c.system || c.permissions?.has('*')) return {};
  switch (c.scope) {
    case 'all':
      return {};
    case 'own':
      if (own) return { [own]: oid(c.userId) };
    // falls through: no owner field on this collection
    case 'ward':
    case 'department':
      if (department && c.departmentIds?.length)
        return { [department]: { $in: c.departmentIds.map(oid) } };
      if (department) return { [department]: { $in: [] } };
    // falls through
    case 'branch':
    default:
      return branch && c.branchId ? { [branch]: oid(c.branchId) } : {};
  }
}

/** Throws 404 (not 403, so records are not revealed) when a loaded record is outside scope. */
export function assertInScope(doc, fields, notFound) {
  const f = scopeFilter(fields);
  for (const [path, cond] of Object.entries(f)) {
    const value = String(doc[path] ?? '');
    const ok = cond?.$in ? cond.$in.some((v) => String(v) === value) : String(cond) === value;
    if (!ok) throw notFound;
  }
}
