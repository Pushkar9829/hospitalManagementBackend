import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { registerBillOverride } from '../ipd/index.js';
import { pmjayPublicRoutes, pmjayRoutes } from './routes.js';
import { PmjayCase } from './models.js';
import { onDischarged } from './service.js';

/**
 * Ayushman Bharat PM-JAY cashless (subscription module PMJ, needs IPD). The hospital is
 * empanelled with its State Health Agency; the Ayushman Mitra verifies the beneficiary in BIS,
 * registers the case here, picks HBP packages, sends the pre-authorisation and later the claim,
 * through TMS (numbers typed in) or NHCX (FHIR over the exchange), on the scheme's clocks.
 * The IP bill is the package rate, billed to the scheme; the patient pays nothing.
 */
registerBillOverride(async (a) => {
  const c = await PmjayCase.findOne({
    admissionId: a._id,
    status: { $nin: ['CANCELLED', 'PREAUTH_REJECTED'] },
    'packages.0': { $exists: true },
  })
    .select('packages')
    .lean();
  if (!c) return null;
  return c.packages.map((p) => ({
    fixed: true,
    code: p.code,
    name: `PM-JAY package ${p.code} · ${p.name}`,
    unitPrice: p.rate,
    source: { type: 'PMJAY', ref: p.code },
  }));
});

const router = Router();
router.use(pmjayRoutes);
const publicRouter = Router();
publicRouter.use(pmjayPublicRoutes);

export const pmjayModule = {
  name: 'pmjay',
  router,
  publicRouter,
  subscriptions: () => {
    subscribe('ipd.discharged', 'pmjay.claim-clock', onDischarged);
  },
};
export { HbpPackage, PmjayCase, PmjaySettings } from './models.js';
export { sweepClocks } from './service.js';
