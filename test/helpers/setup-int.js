import { inject } from 'vitest';

// A fresh database per test file so files can run in parallel.
const base = new URL(inject('mongoUri'));
base.pathname = `/hms_test_${process.env.VITEST_POOL_ID ?? '0'}_${Math.random().toString(36).slice(2, 8)}`;
process.env.MONGO_URI = base.toString();
