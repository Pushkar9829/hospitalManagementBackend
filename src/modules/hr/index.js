import { Router } from 'express';
import { hrRoutes, meRoutes } from './hr.routes.js';
import { myTalentRoutes, talentRoutes } from './talent.routes.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages

/**
 * HR (spec "HR management"): the employee master with statutory numbers and clinical
 * registrations, leave with balances and roster cover, attendance from biometric punches with
 * the monthly lock that payroll reads, shift rosters with swaps, and employee self-service.
 */
const router = Router();
router.use(talentRoutes, hrRoutes, meRoutes, myTalentRoutes);

export const hrModule = { name: 'hr', router };
export { Employee } from './models/hr.models.js';
export { daysOfMonth, employeeOut, myEmployee, payInputs } from './services/hr.service.js';
