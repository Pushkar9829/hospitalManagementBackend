import { current } from '../tenancy/context.js';
import { OutboxEvent } from './outbox.model.js';

/** type -> [{ name, handler }] registered by modules at startup. */
const subscribers = new Map();

/**
 * Publishes a domain event. Call inside withTransaction() so the event is stored only if the
 * change commits; the relay delivers it afterwards (at least once).
 */
export async function publish(type, payload = {}) {
  const c = current();
  const [doc] = await OutboxEvent.create([
    { tenantId: c.tenantId, type, payload, requestId: c.requestId, userId: c.userId ?? undefined },
  ]);
  return doc._id;
}

/**
 * Subscribes a handler. `name` must be unique and stable: it is part of the job id that makes
 * delivery idempotent. Handlers run in a system context for the event's tenant and must
 * tolerate being called twice.
 */
export function subscribe(type, name, handler) {
  const list = subscribers.get(type) ?? [];
  if (list.some((s) => s.name === name))
    throw new Error(`Duplicate subscriber ${name} for ${type}`);
  list.push({ name, handler });
  subscribers.set(type, list);
}

export const subscribersFor = (type) => subscribers.get(type) ?? [];
export const allSubscriptions = () =>
  [...subscribers].flatMap(([type, list]) => list.map((s) => `${type} -> ${s.name}`));
