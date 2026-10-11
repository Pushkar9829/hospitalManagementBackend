import { Schema } from 'mongoose';
import { maybeCurrent } from '../tenancy/context.js';

const READS = [
  'find',
  'findOne',
  'countDocuments',
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
  'exists',
];

/**
 * Common fields on every document (spec "Data design rules"): createdBy, updatedBy, timestamps,
 * soft delete and a `version` used for optimistic locking (409 VERSION_CONFLICT).
 * Queries skip soft-deleted documents unless called with `.setOptions({ withDeleted: true })`.
 */
export function basePlugin(schema) {
  schema.add({
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  });
  schema.set('timestamps', true);
  schema.set('versionKey', 'version');
  schema.set('optimisticConcurrency', true);

  schema.pre('save', function () {
    const userId = maybeCurrent()?.userId;
    if (!userId) return;
    if (this.isNew) this.createdBy ??= userId;
    this.updatedBy = userId;
  });

  for (const op of ['findOneAndUpdate', 'updateOne', 'updateMany']) {
    schema.pre(op, function () {
      const userId = maybeCurrent()?.userId;
      if (userId) this.set({ updatedBy: userId });
      // Every write bumps the version so concurrent editors get 409 instead of lost updates.
      const update = this.getUpdate();
      if (
        update &&
        !Array.isArray(update) &&
        update.version === undefined &&
        update.$set?.version === undefined
      ) {
        update.$inc = { ...update.$inc, version: update.$inc?.version ?? 1 };
      }
    });
  }

  for (const op of READS) {
    schema.pre(op, function () {
      if (this.getOptions().withDeleted) return;
      if (this.getFilter().isDeleted === undefined) this.where({ isDeleted: { $ne: true } });
    });
  }

  schema.methods.softDelete = function softDelete() {
    this.isDeleted = true;
    this.deletedAt = new Date();
    return this.save();
  };
}
