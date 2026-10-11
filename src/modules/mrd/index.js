import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { mrdRoutes } from './mrd.routes.js';
import { openRecord } from './services/mrd.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages

/**
 * Medical records (spec "Medical Records and Certificates"): each discharged stay arrives with a
 * completion checklist, deficiencies go to the consultant, the coder closes it with ICD-10 codes;
 * physical files are tracked; copies are released with Medical Superintendent approval and a
 * billed fee; birth, death (MCCD, mortuary) and medico-legal registers; monthly statistics.
 */
const router = Router();
router.use(mrdRoutes);

export const mrdModule = {
  name: 'mrd',
  router,
  subscriptions: () => {
    subscribe('ipd.discharged', 'mrd.open-record', openRecord);
  },
};
export { BirthRecord, DeathRecord, MrdRecord } from './models/mrd.models.js';
