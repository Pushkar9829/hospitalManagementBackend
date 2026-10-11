import { Router } from 'express';
import { portalRoutes } from './portal.routes.js';

/**
 * Patient portal: sign-in by a one-time code on the registered mobile; the family's reports,
 * bills and receipts, the current stay for attendants, and booking a visit.
 */
const publicRouter = Router();
publicRouter.use(portalRoutes);

export const portalModule = { name: 'portal', router: Router(), publicRouter };
