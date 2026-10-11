import { maybeCurrent } from '../tenancy/context.js';
import { recordAudit } from './audit.service.js';

const SKIP = new Set(['updatedAt', 'updatedBy', 'version', 'createdAt', 'createdBy']);

/**
 * Logs every create, update and delete with before/after values of the changed fields
 * (spec: "100% of create, update, approve, print and export actions logged").
 * Approve, print and export are recorded by the services that perform them.
 */
export function auditPlugin(schema, { entity }) {
  const ignore = new Set([...SKIP, ...(schema.get('auditIgnore') ?? [])]);
  schema.post('init', function () {
    this.$locals.snapshot = this.toObject({ depopulate: true });
  });

  schema.pre('save', function () {
    this.$locals.wasNew = this.isNew;
    this.$locals.changed = this.isNew
      ? []
      : this.modifiedPaths({ includeChildren: false }).filter(
          (p) => !ignore.has(p) && !p.includes('.'),
        );
  });

  schema.post('save', async function () {
    if (!maybeCurrent()) return;
    const { wasNew, changed = [], snapshot = {} } = this.$locals;
    if (wasNew) {
      await recordAudit({
        action: 'CREATE',
        entity,
        entityId: this._id,
        after: this.toObject({ depopulate: true }),
      });
    } else if (changed.length) {
      const before = {};
      const after = {};
      for (const p of changed) {
        before[p] = snapshot[p];
        after[p] = this.get(p);
      }
      const action = changed.includes('isDeleted') && this.isDeleted ? 'DELETE' : 'UPDATE';
      await recordAudit({ action, entity, entityId: this._id, before, after });
    }
    this.$locals.snapshot = this.toObject({ depopulate: true });
  });

  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
    schema.post(op, async function (result) {
      if (!maybeCurrent()) return;
      const update = this.getUpdate() ?? {};
      const fields = {
        ...update.$set,
        ...Object.fromEntries(Object.entries(update).filter(([k]) => !k.startsWith('$'))),
      };
      for (const k of ignore) delete fields[k];
      const entityId = result?._id ?? this.getFilter()._id;
      if (!Object.keys(fields).length && !update.$unset && !update.$push && !update.$pull) return;
      await recordAudit({
        action: fields.isDeleted ? 'DELETE' : 'UPDATE',
        entity,
        entityId,
        after: { ...fields, ...(update.$unset ? { $unset: update.$unset } : {}) },
      });
    });
  }

  for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete']) {
    schema.post(op, async function () {
      if (!maybeCurrent()) return;
      await recordAudit({
        action: 'DELETE',
        entity,
        entityId: this.getFilter()._id,
        before: this.getFilter(),
      });
    });
  }
}
