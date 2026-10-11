import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { runAsSystem } from '../../core/tenancy/context.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { feedbackPublicRoutes, qualityRoutes } from './quality.routes.js';
import { escalateOverdue, onDischarged, onVisitClosed } from './services/quality.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages

/**
 * Quality (spec "Quality, Feedback and Incidents", NABH): feedback by SMS link after OPD visits
 * and discharges with NPS, the complaint register with turnaround and escalation, incident
 * reporting (anonymous allowed) with root cause and CAPA closed through approval, monthly
 * indicators computed from system data, audits, controlled documents and infection control.
 */
const router = Router();
router.use(qualityRoutes);
const publicRouter = Router();
publicRouter.use(feedbackPublicRoutes);

export const qualityModule = {
  name: 'quality',
  router,
  publicRouter,
  subscriptions: () => {
    subscribe('opd.visit.closed', 'quality.feedback-opd', onVisitClosed);
    subscribe('ipd.discharged', 'quality.feedback-ipd', onDischarged);
  },
};

/** Scheduled: complaints past their turnaround escalate (every hospital). */
export async function sweepComplaints(now = new Date()) {
  const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } })
    .select('_id')
    .lean();
  let n = 0;
  for (const t of tenants)
    n += await runAsSystem(t._id, () => escalateOverdue(now), { userName: 'system: complaints' });
  return { escalated: n };
}
export { Complaint, Incident } from './models/quality.models.js';
