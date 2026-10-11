import { Router } from 'express';
import { registerPatientMergeHandler, registerPatientTimelineSource } from '../patients/index.js';
import { billRoutes, paymentRoutes, shiftRoutes } from './billing.routes.js';
import { corporateRoutes } from './corporate.routes.js';
import { cashbookRoutes } from './cashbook.routes.js';
import { Bill, Deposit, Payment, Refund } from './models/billing.models.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages
import './patient-sections.js'; // this module's sections of the patient record

/**
 * Billing engine (CORE): payer-priced bills, finalisation with gap-free numbers, payments split
 * across bills, deposits, discounts and cancellations through approval, credit notes, refunds
 * to the original mode, cashier shifts and PDFs. Rules R1-R18 of docs/modules/BILLING.md;
 * ledger posting (R20) consumes the billing.* events when Finance is built.
 */
registerPatientTimelineSource(async (patientId) => {
  const bills = await Bill.find({ 'patient.id': patientId, status: { $ne: 'DRAFT' } })
    .select('billNo totals.total status finalizedAt')
    .lean();
  return bills.map((b) => ({
    at: b.finalizedAt,
    type: 'BILL',
    title: `Bill ${b.billNo} · ₹${(b.totals.total / 100).toFixed(2)} · ${b.status}`,
    ref: String(b._id),
  }));
});

registerPatientMergeHandler(async (fromId, toId) => {
  await Bill.updateMany({ 'patient.id': fromId }, { $set: { 'patient.id': toId } });
  for (const Model of [Payment, Deposit])
    await Model.updateMany(
      { patientId: fromId },
      { $set: { patientId: toId, 'patient.id': toId } },
    );
  await Refund.updateMany({ patientId: fromId }, { $set: { patientId: toId } });
});

const router = Router();
router.use(billRoutes, paymentRoutes, shiftRoutes, corporateRoutes, cashbookRoutes);

export const billingModule = { name: 'billing', router };
export { Bill, CorporateInvoice, Deposit, Payment } from './models/billing.models.js';
export { createBill, finalizeBill, getBill, replaceLines } from './services/bills.service.js';
export { receivePayment, registerWalletHandler } from './services/payments.service.js';
