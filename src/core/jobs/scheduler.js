import { Queue, Worker } from 'bullmq';
import cronParser from 'cron-parser';
import { inMemory, newRedisConnection } from '../cache/redis.js';
import { logger } from '../observability/logger.js';

/**
 * Repeating jobs on one BullMQ queue. Each job has one scheduler id, so several worker replicas
 * never run it twice. `jobs`: [{ id, pattern (cron, IST), run }]. Returns stop().
 */
export async function startScheduler(queueName, jobs) {
  if (inMemory) return startTimers(jobs);
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

/**
 * Without Redis (single-instance demo): each job runs on a timer at its next cron time (IST).
 * One instance only, so nothing can run twice.
 */
function startTimers(jobs) {
  const timers = new Map();
  let stopped = false;
  const plan = (j) => {
    if (stopped) return;
    const next = cronParser
      .parseExpression(j.pattern, { tz: 'Asia/Kolkata', currentDate: new Date() })
      .next()
      .getTime();
    // setTimeout tops out near 24.8 days; re-plan before that.
    const wait = Math.min(Math.max(next - Date.now(), 1000), 2 ** 31 - 1);
    timers.set(
      j.id,
      setTimeout(async () => {
        try {
          const result = await j.run();
          logger.info({ job: j.id, result }, 'Scheduled job ran');
        } catch (err) {
          logger.error({ err, job: j.id }, 'Scheduled job failed');
        }
        plan(j);
      }, wait),
    );
  };
  jobs.forEach(plan);
  return async () => {
    stopped = true;
    for (const t of timers.values()) clearTimeout(t);
  };
}
