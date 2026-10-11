import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { registerBillLineSource, registerFinalBillCheck } from '../ipd/index.js';
import { registerPatientMergeHandler } from '../patients/index.js';
import { pharmacyRoutes } from './pharmacy.routes.js';
import { Dispense, Prescription } from './models/pharmacy.models.js';
import {
  fromOpdVisit,
  fromWardOrder,
  pendingReturnsCheck,
  stayBillLines,
} from './services/pharmacy.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages

/**
 * Pharmacy (spec "Pharmacy features"): the queue of OPD prescriptions and ward medicine orders,
 * dispensing from batch stock first-expiry-first-out, generic substitution with consent, the
 * Schedule H1/X/narcotic registers, the weight-based check for children, sales on OP bills at
 * MRP with GST inside, ward issues on the running IP bill, and ward returns settled before the
 * final bill (IPD rule R15).
 */
registerBillLineSource(stayBillLines);
registerFinalBillCheck(pendingReturnsCheck);
registerPatientMergeHandler(async (fromId, toId) => {
  for (const Model of [Prescription, Dispense])
    await Model.updateMany({ 'patient.id': fromId }, { $set: { 'patient.id': toId } });
});

const router = Router();
router.use(pharmacyRoutes);

export const pharmacyModule = {
  name: 'pharmacy',
  router,
  subscriptions: () => {
    subscribe('opd.visit.completed', 'pharmacy.rx-from-opd', fromOpdVisit);
    subscribe('ipd.medicine.ordered', 'pharmacy.stat-order', (e) =>
      e.stat ? fromWardOrder({ ...e, stat: true }) : null,
    );
    subscribe('ipd.medicine.verified', 'pharmacy.ward-order', fromWardOrder);
  },
};
