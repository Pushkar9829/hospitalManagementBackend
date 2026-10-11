import { connectDb, disconnectDb } from './core/db/connection.js';
import { closeRedis } from './core/cache/redis.js';
import { logger } from './core/observability/logger.js';
import { initErrorReporting, reportError } from './core/observability/errorReporting.js';
import { startWorker } from './background.js';

/** Background worker process: see src/background.js. */
await initErrorReporting('worker');
await connectDb();
const stopWorker = await startWorker();

async function shutdown(signal) {
  logger.info({ signal }, 'Worker shutting down');
  await stopWorker();
  await disconnectDb();
  await closeRedis();
  process.exit(0);
}
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled rejection');
  reportError(err);
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
