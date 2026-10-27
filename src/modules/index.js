import { Router } from 'express';
import { setupModule } from './setup/index.js';
import { usersModule } from './users/index.js';
import { patientsModule } from './patients/index.js';
import { billingModule } from './billing/index.js';
import { opdModule } from './opd/index.js';
import { frontOfficeModule } from './frontoffice/index.js';
import { ipdModule } from './ipd/index.js';
import { labModule } from './lab/index.js';
import { radiologyModule } from './radiology/index.js';
import { inventoryModule } from './inventory/index.js';
import { pharmacyModule } from './pharmacy/index.js';
import { hrModule } from './hr/index.js';
import { payrollModule } from './payroll/index.js';
import { financeModule } from './finance/index.js';
import { mrdModule } from './mrd/index.js';
import { dietModule } from './diet/index.js';
import { facilityModule } from './facility/index.js';
import { qualityModule } from './quality/index.js';
import { crmModule } from './crm/index.js';
import { portalModule } from './portal/index.js';
import { pmjayModule } from './pmjay/index.js';
import { reportsModule } from '../core/reports/reports.routes.js';
import { homeModule } from '../core/home/home.routes.js';

/**
 * Registers every business module. Each module folder exports `{ router, subscriptions? }` from
 * its index.js (PLAN section 3.1). Modules are added here phase by phase:
 *   Phase 1: platform, setup, users, patients, billing
 *   Phase 2: opd, frontoffice
 *   Phase 3: ipd
 *   Phase 4: lab, radiology, inventory, pharmacy
 *   Phase 5: hr, payroll, finance
 *   Phase 6: mrd, diet, facility, quality, crm, portal
 */
const MODULES = [
  setupModule,
  usersModule,
  patientsModule,
  billingModule,
  opdModule,
  frontOfficeModule,
  ipdModule,
  labModule,
  radiologyModule,
  inventoryModule,
  pharmacyModule,
  hrModule,
  payrollModule,
  financeModule,
  mrdModule,
  dietModule,
  facilityModule,
  qualityModule,
  crmModule,
  portalModule,
  pmjayModule,
  homeModule,
  // Last: a module's own /reports/<name> analytics route answers before the reports centre.
  reportsModule,
];

export function mountModules() {
  const router = Router();
  for (const m of MODULES) router.use(m.router);
  return router;
}

/** Routes a module serves before sign-in (e.g. accepting an invitation). */
export function mountPublicModules() {
  const router = Router();
  for (const m of MODULES) if (m.publicRouter) router.use(m.publicRouter);
  return router;
}

/** Called by the worker so event subscribers are registered before events are processed. */
export function registerSubscriptions() {
  for (const m of MODULES) m.subscriptions?.();
}
