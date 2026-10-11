import { Router } from 'express';
import { facilityRoutes } from './facility.routes.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages

/**
 * Housekeeping, linen and facility (spec "Housekeeping, Linen and Facility"): area cleaning
 * rounds with supervisor sign-off (bed cleaning itself lives with the IPD bed board), linen par
 * levels, laundry cycles and condemnation through approval, porter requests, the equipment
 * register with PM, calibration and AMC alerts, maintenance tickets that take broken equipment
 * out of service and record downtime, and biomedical waste with CBWTF handover.
 */
const router = Router();
router.use(facilityRoutes);

export const facilityModule = { name: 'facility', router };
export { Asset, Ticket } from './models/facility.models.js';
