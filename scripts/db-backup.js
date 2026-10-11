/**
 * Logical backup of the database in MONGO_URI: every collection as gzipped Extended JSON lines
 * (types such as ObjectId and Date survive), plus a manifest with document counts.
 *
 *   npm run db:backup                    -> backups/<db>-<timestamp>/
 *   npm run db:backup -- --out <folder>
 *
 * Atlas paid tiers also take their own snapshots; this works on any host (and the free tier).
 * Backups hold patient data: keep them encrypted at rest and off shared drives.
 */
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';

export async function backup(uri, outDir) {
  const conn = await mongoose
    .createConnection(uri, { serverSelectionTimeoutMS: 20_000 })
    .asPromise();
  const db = conn.db;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(outDir ?? join('backups', `${db.databaseName}-${stamp}`));
  mkdirSync(dir, { recursive: true });
  const manifest = {
    database: db.databaseName,
    startedAt: new Date().toISOString(),
    collections: {},
  };
  const cols = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();
  for (const name of cols) {
    const gz = createGzip();
    const file = createWriteStream(join(dir, `${name}.jsonl.gz`));
    gz.pipe(file);
    let count = 0;
    for await (const doc of db.collection(name).find({}, { batchSize: 1000 })) {
      if (!gz.write(`${mongoose.mongo.BSON.EJSON.stringify(doc, { relaxed: false })}\n`))
        await once(gz, 'drain');
      count += 1;
    }
    gz.end();
    await once(file, 'finish');
    manifest.collections[name] = count;
  }
  manifest.finishedAt = new Date().toISOString();
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await conn.close();
  return { dir, manifest };
}

if (process.argv[1]?.endsWith('db-backup.js')) {
  const i = process.argv.indexOf('--out');
  const { dir, manifest } = await backup(env.MONGO_URI, i > 0 ? process.argv[i + 1] : undefined);
  const docs = Object.values(manifest.collections).reduce((a, b) => a + b, 0);
  console.log(
    `Backed up ${Object.keys(manifest.collections).length} collections (${docs} documents) to ${dir}`,
  );
}
