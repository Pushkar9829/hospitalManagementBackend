import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { registerWalletHandler } from '../billing/index.js';
import { crmRoutes } from './crm.routes.js';
import {
  debitWallet,
  onAdmitted,
  onConsentChanged,
  onVisitClosed,
} from './services/crm.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages
import './patient-sections.js'; // this module's sections of the patient record

/**
 * Patient CRM and outreach (spec "Patient CRM and Outreach"): call-centre lookup and enquiries,
 * leads through stages to conversion on admission or visit, health camps with screening and
 * ROI, consent-aware SMS campaigns, family health cards with free visits and a wallet that the
 * billing counter accepts, referral partners with fee statements, and reports.
 */
const router = Router();
router.use(crmRoutes);

// The membership wallet is a payment mode at every counter.
registerWalletHandler(debitWallet);

export const crmModule = {
  name: 'crm',
  router,
  subscriptions: () => {
    subscribe('ipd.admitted', 'crm.lead-admitted', onAdmitted);
    subscribe('opd.visit.closed', 'crm.lead-seen', onVisitClosed);
    subscribe('patients.consent.changed', 'crm.consent', onConsentChanged);
  },
};
export { Lead, Membership } from './models/crm.models.js';
