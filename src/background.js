import { startEventProcessing } from './core/events/relay.js';
import { allSubscriptions } from './core/events/events.js';
import { logger } from './core/observability/logger.js';
import { registerSubscriptions } from './modules/index.js';
import { startPlatformJobs } from './platform/jobs.js';
import { startScheduler } from './core/jobs/scheduler.js';
import { sweepExpiredApprovals } from './core/approvals/approval.jobs.js';
import { midnightCensus, sweepOverdueReplies, sweepReservations } from './modules/ipd/index.js';
import { sweepCriticalCalls } from './modules/lab/index.js';
import { sweepComplaints } from './modules/quality/index.js';
import { sweepReportSchedules } from './core/reports/reports.routes.js';

/**
 * Background work: outbox relay, domain event subscribers and scheduled jobs. Runs in its own
 * process (src/worker.js), or inside the API when RUN_WORKER=true (single-service hosting).
 * Returns a function that stops it.
 */
export async function startWorker() {
  registerSubscriptions();
  const stop = startEventProcessing();
  const stopPlatform = await startPlatformJobs();
  const stopCore = await startScheduler('core', [
    { id: 'approval-expiry', pattern: '*/15 * * * *', run: () => sweepExpiredApprovals() },
    // IPD rule R6: room days posted at the midnight census.
    { id: 'ipd-midnight-census', pattern: '5 0 * * *', run: () => midnightCensus() },
    { id: 'ipd-bed-reservations', pattern: '*/5 * * * *', run: () => sweepReservations() },
    // IRDAI: no insurer reply within the hour alerts the TPA desk.
    { id: 'ipd-insurer-replies', pattern: '*/15 * * * *', run: () => sweepOverdueReplies() },
    // Lab rule R7: critical values not phoned in time go to the HOD.
    { id: 'lab-critical-calls', pattern: '*/5 * * * *', run: () => sweepCriticalCalls() },
    // Quality: complaints past their turnaround go to the Medical Superintendent.
    { id: 'quality-complaints', pattern: '7 * * * *', run: () => sweepComplaints() },
    // Scheduled reports (the schedule's own time is checked inside).
    { id: 'report-schedules', pattern: '*/15 * * * *', run: () => sweepReportSchedules() },
  ]);
  logger.info({ subscriptions: allSubscriptions() }, 'Worker started');
  return async () => {
    await stop();
    await stopPlatform();
    await stopCore();
  };
}
