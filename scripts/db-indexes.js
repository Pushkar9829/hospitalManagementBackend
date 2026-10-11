/**
 * Builds missing indexes on the database in MONGO_URI (never drops any).
 * Usage: npm run db:indexes        (the API also does this at start in production)
 */
import { connectDb, disconnectDb } from '../src/core/db/connection.js';
import '../src/app.js'; // registers every model (core, platform and modules)
import { closeRedis } from '../src/core/cache/redis.js';
import { ensureIndexes } from '../src/core/db/indexes.js';

await connectDb();
const { models, failed } = await ensureIndexes();
console.log(`Checked indexes on ${models} models; ${failed.length} failed.`);
for (const f of failed) console.log(`  ${f.model}: ${f.error}`);
await disconnectDb();
await closeRedis();
process.exitCode = failed.length ? 1 : 0;
