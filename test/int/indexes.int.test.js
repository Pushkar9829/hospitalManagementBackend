import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { useIntegration } from '../helpers/int.js';
import { ensureIndexes } from '../../src/core/db/indexes.js';

useIntegration();
const quiet = { info() {}, error() {} };

describe('production indexes', () => {
  it('builds every declared index, including the unique ones, and is safe to run again', async () => {
    const first = await ensureIndexes({ log: quiet });
    expect(first.failed).toEqual([]);
    expect(first.models).toBeGreaterThan(100);
    const again = await ensureIndexes({ log: quiet });
    expect(again.failed).toEqual([]);
    const tenants = await mongoose.model('Tenant').collection.indexes();
    expect(tenants.some((i) => i.unique && i.key.subdomain === 1)).toBe(true);
  });
});
