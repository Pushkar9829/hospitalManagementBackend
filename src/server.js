import http from 'node:http';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { connectDb, disconnectDb } from './core/db/connection.js';
import { closeRedis, redis } from './core/cache/redis.js';
import { attachRealtime, closeRealtime } from './core/realtime/socket.js';
import { logger } from './core/observability/logger.js';
import { startWorker } from './background.js';
import { ensureIndexes } from './core/db/indexes.js';

await connectDb();
await redis().ping();
// Production does not auto-build indexes per connection: create the missing ones once here.
if (env.isProd) await ensureIndexes();
const server = http.createServer(createApp());
attachRealtime(server);
server.keepAliveTimeout = 65_000; // longer than the ALB idle timeout (60 s)
// Single-service hosting (Render): the outbox relay and scheduled jobs run in this process.
const stopWorker = env.RUN_WORKER ? await startWorker() : null;
server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API listening'));

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'Shutting down');
  const force = setTimeout(() => process.exit(1), 25_000);
  force.unref();
  server.close();
  if (stopWorker) await stopWorker();
  await closeRealtime();
  await disconnectDb();
  await closeRedis();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
