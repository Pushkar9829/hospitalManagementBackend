import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { dietRoutes } from './diet.routes.js';
import { onAdmitted, onDischarged, onTransferred } from './services/diet.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages

/**
 * Diet and kitchen (spec "Diet and Kitchen"): every admission starts on the default diet,
 * doctors and dietitians change it, nil-by-mouth windows hold trays, the kitchen works from a
 * production sheet per meal with tray labels, wards confirm delivery, meals in private rooms are
 * charged to the running bill, and missed meals are reported.
 */
const router = Router();
router.use(dietRoutes);

export const dietModule = {
  name: 'diet',
  router,
  subscriptions: () => {
    subscribe('ipd.admitted', 'diet.default-order', onAdmitted);
    subscribe('ipd.transferred', 'diet.follow-bed', onTransferred);
    subscribe('ipd.discharged', 'diet.end-order', onDischarged);
  },
};
export { DietOrder } from './models/diet.models.js';
