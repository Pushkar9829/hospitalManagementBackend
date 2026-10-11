import { startScheduler } from '../core/jobs/scheduler.js';
import { runLifecycle } from './services/subscription.service.js';

/** Platform schedules: the subscription lifecycle runs daily at 00:30 IST. */
export function startPlatformJobs() {
  return startScheduler('platform', [
    { id: 'lifecycle', pattern: '30 0 * * *', run: () => runLifecycle() },
  ]);
}
