/**
 * Restores a backup made by db-backup.js into an EMPTY database (it refuses one that has data,
 * so it can never overwrite a live hospital by mistake):
 *
 *   RESTORE_URI=mongodb://.../hms_restored npm run db:restore -- backups/hms-2026-10-11T...
 *
 * Then point the API at the restored database and run `npm run db:indexes`.
 */
import { createReadStream, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import mongoose from 'mongoose';

export async function restore(uri, fromDir) {
  const dir = resolve(fromDir);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const conn = await mongoose
    .createConnection(uri, { serverSelectionTimeoutMS: 20_000 })
    .asPromise();
  const db = conn.db;
  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  if (existing.some((c) => !c.name.startsWith('system.'))) {
    await conn.close();
    throw new Error(`Database "${db.databaseName}" is not empty; restore only into an empty one.`);
  }
  const restored = {};
  for (const name of Object.keys(manifest.collections)) {
    await db.createCollection(name);
    // Open the reader only now: lines read while something else is awaited would be lost.
    const lines = createInterface({
      input: createReadStream(join(dir, `${name}.jsonl.gz`)).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    let batch = [];
    let count = 0;
    for await (const line of lines) {
      if (!line) continue;
      batch.push(mongoose.mongo.BSON.EJSON.parse(line, { relaxed: false }));
      if (batch.length === 1000) {
        await db.collection(name).insertMany(batch, { ordered: false });
        count += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await db.collection(name).insertMany(batch, { ordered: false });
      count += batch.length;
    }
    restored[name] = count;
  }
  await conn.close();
  return { database: db.databaseName, manifest, restored };
}

if (process.argv[1]?.endsWith('db-restore.js')) {
  const from = process.argv[2];
  const uri = process.env.RESTORE_URI;
  if (!from || !uri) {
    console.error('Usage: RESTORE_URI=<empty database URI> npm run db:restore -- <backup folder>');
    process.exit(2);
  }
  const { database, restored } = await restore(uri, from);
  const docs = Object.values(restored).reduce((a, b) => a + b, 0);
  console.log(
    `Restored ${Object.keys(restored).length} collections (${docs} documents) into ${database}.`,
  );
}
