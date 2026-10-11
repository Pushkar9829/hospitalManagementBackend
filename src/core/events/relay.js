import { Queue, Worker } from 'bullmq';
import { newRedisConnection } from '../cache/redis.js';
import { logger } from '../observability/logger.js';
import { runAsSystem } from '../tenancy/context.js';
import { OutboxEvent } from './outbox.model.js';
import { subscribersFor } from './events.js';

export const EVENTS_QUEUE = 'domain-events';
const BATCH = 100;
const LOCK_MS = 30_000;

/**
 * Moves committed outbox rows to BullMQ: one job per (event, subscriber), with the job id
 * `${eventId}:${subscriber}` so a crash between enqueue and marking SENT cannot double-deliver.
 */
export async function relayOnce(queue) {
  let moved = 0;
  for (;;) {
    const ev = await OutboxEvent.findOneAndUpdate(
      { $or: [{ status: 'PENDING' }, { status: 'SENDING', lockedUntil: { $lt: new Date() } }] },
      {
        $set: { status: 'SENDING', lockedUntil: new Date(Date.now() + LOCK_MS) },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1 }, new: true },
    );
    if (!ev) break;
    try {
      const subs = subscribersFor(ev.type);
      if (subs.length) {
        await queue.addBulk(
          subs.map((s) => ({
            name: ev.type,
            data: {
              eventId: String(ev._id),
              tenantId: String(ev.tenantId),
              type: ev.type,
              payload: ev.payload,
              subscriber: s.name,
              requestId: ev.requestId,
            },
            opts: {
              jobId: `${ev._id}__${s.name}`, // BullMQ ids cannot contain ":"
              attempts: 8,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: 1000,
              removeOnFail: false,
            },
          })),
        );
      }
      await OutboxEvent.updateOne(
        { _id: ev._id },
        { $set: { status: 'SENT' }, $unset: { lockedUntil: 1 } },
      );
    } catch (err) {
      logger.error({ err, eventId: String(ev._id) }, 'Outbox relay failed');
      await OutboxEvent.updateOne(
        { _id: ev._id },
        {
          $set: {
            status: ev.attempts >= 10 ? 'FAILED' : 'PENDING',
            lastError: String(err.message),
          },
        },
      );
    }
    if (++moved >= BATCH) break;
  }
  return moved;
}

/** Worker process: relays every second and runs subscribers. Returns a stop() function. */
export function startEventProcessing({ intervalMs = 1000 } = {}) {
  const queue = new Queue(EVENTS_QUEUE, { connection: newRedisConnection() });
  let stopped = false;
  let timer;
  const tick = async () => {
    try {
      while (!stopped && (await relayOnce(queue)) === BATCH);
    } catch (err) {
      logger.error({ err }, 'Outbox relay tick failed');
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  tick();
  const worker = new Worker(
    EVENTS_QUEUE,
    async (job) => {
      const { tenantId, type, payload, subscriber, eventId, requestId } = job.data;
      const sub = subscribersFor(type).find((s) => s.name === subscriber);
      if (!sub) return;
      await runAsSystem(tenantId, () => sub.handler(payload, { eventId, type }), { requestId });
    },
    { connection: newRedisConnection(), concurrency: 10 },
  );
  worker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'Event handler failed'));
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await worker.close();
    await queue.close();
  };
}
