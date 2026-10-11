/**
 * Restore drill (Phase 7): back up the database in MONGO_URI, restore it into a scratch
 * database on the same server (<db>_restore_drill), and check that every collection has the same
 * number of documents. The scratch database is dropped afterwards; nothing else is touched.
 *
 *   npm run db:restore-drill
 */
import { rmSync } from 'node:fs';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { backup } from './db-backup.js';
import { restore } from './db-restore.js';

const source = new URL(env.MONGO_URI.replace(/^mongodb(\+srv)?:/, 'http:'));
const dbName = source.pathname.replace(/^\//, '') || 'test';
const drillDb = `${dbName}_restore_drill`;
const drillUri = env.MONGO_URI.replace(`/${dbName}`, `/${drillDb}`);
if (drillUri === env.MONGO_URI) throw new Error('Could not derive the scratch database name.');

// A drill stopped half-way leaves its scratch database behind: clear only that one.
const stale = await mongoose.createConnection(drillUri).asPromise();
if (stale.db.databaseName === drillDb) await stale.db.dropDatabase();
await stale.close();

const t0 = Date.now();
const { dir, manifest } = await backup(env.MONGO_URI);
const t1 = Date.now();
const { restored } = await restore(drillUri, dir);
const t2 = Date.now();

const mismatches = Object.entries(manifest.collections).filter(([n, c]) => restored[n] !== c);
const docs = Object.values(manifest.collections).reduce((a, b) => a + b, 0);
console.log(
  `Backup: ${Object.keys(manifest.collections).length} collections, ${docs} documents in ${((t1 - t0) / 1000).toFixed(1)} s`,
);
console.log(`Restore into ${drillDb}: ${((t2 - t1) / 1000).toFixed(1)} s`);
console.log(
  mismatches.length
    ? `MISMATCH: ${mismatches.map(([n]) => n).join(', ')}`
    : 'Every collection matches.',
);

// Clean up: only the scratch database this drill created, and the drill's backup files.
const conn = await mongoose.createConnection(drillUri).asPromise();
if (conn.db.databaseName === drillDb) await conn.db.dropDatabase();
await conn.close();
rmSync(dir, { recursive: true, force: true });
process.exitCode = mismatches.length ? 1 : 0;
