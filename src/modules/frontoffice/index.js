import { Router } from 'express';
import { frontOfficeRoutes } from './frontoffice.routes.js';
import './home.js'; // registers this module's widgets on the role home pages

/**
 * Front office (CORE, board FrontOffice): counter tokens and "now serving", enquiries (leads go
 * to CRM by event), attendant and visitor passes with QR codes and the visitor log, and the
 * patient locator (where a patient is, without clinical details). IPD registers the admitted
 * patients' beds with `registerLocator` and revokes passes at discharge.
 */
const router = Router();
router.use(frontOfficeRoutes);

export const frontOfficeModule = { name: 'frontoffice', router };
export { registerLocator, revokeForPatient } from './services/frontoffice.service.js';
