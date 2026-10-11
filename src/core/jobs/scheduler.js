import { Queue, Worker } from 'bullmq';
import { newRedisConnection } from '../cache/redis.js';
import { logger } from '../observability/logger.js';

/**
 * Repeating jobs on one BullMQ queue. Each job has one scheduler id, so several worker replicas
 * never run it twice. `jobs`: [{ id, pattern (cron, IST), run }]. Returns stop().
 */
export async function startScheduler(queueName, jobs) {
  const queue = new Queue(queueName, { connection: newRedisConnection() });
  for (const j of jobs)
    await queue.upsertJobScheduler(
      j.id,
      { pattern: j.pattern, tz: 'Asia/Kolkata' },
      { name: j.id },
    );
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const worker = new Worker(
    queueName,
    async (job) => {
      const j = byId.get(job.name);
      if (!j) return null;
      const result = await j.run();
      logger.info({ job: job.name, result }, 'Scheduled job ran');
      return result;
    },
    { connection: newRedisConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ err, job: job?.name }, 'Scheduled job failed'));
  return async () => {
    await worker.close();
    await queue.close();
  };
}
