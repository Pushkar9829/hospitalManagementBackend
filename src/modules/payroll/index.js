import { Router } from 'express';
import { declarationRoutes, payrollRoutes } from './payroll.routes.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages

/**
 * Payroll (spec "Payroll management"): salary structures through approval, loans, the monthly
 * run from locked attendance with PF, ESI, Professional Tax and TDS, maker-checker release and
 * lock, payslips, the bank file and PF ECR; the locked run's journal goes to Finance.
 */
const router = Router();
router.use(payrollRoutes, declarationRoutes);

export const payrollModule = { name: 'payroll', router };
