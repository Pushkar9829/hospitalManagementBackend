import mongoose from 'mongoose';
import { logger } from '../observability/logger.js';

/**
 * Creates every index the models declare that the database does not have yet. Production turns
 * Mongoose's autoIndex off (building indexes on each connection would lock busy collections),
 * so this runs once at API start and from `npm run db:indexes`. It never drops an index:
 * removing one is a deliberate migration, not a side effect of a deploy.
 * Returns { models, failed: [{ model, error }] }.
 */
export async function ensureIndexes({ log = logger } = {}) {
  const failed = [];
  const names = mongoose.modelNames();
  for (const name of names) {
    try {
      await mongoose.model(name).createIndexes();
    } catch (err) {
      // Usually duplicate data under a new unique index: the rest still get built.
      failed.push({ model: name, error: err.message });
      log.error({ model: name, err: err.message }, 'Index build failed');
    }
  }
  log.info({ models: names.length, failed: failed.length }, 'Indexes checked');
  return { models: names.length, failed };
}
