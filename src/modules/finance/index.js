import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { financeRoutes } from './finance.routes.js';
import { ledgerRoutes } from './ledgers.routes.js';
import {
  onBillCancelled,
  onBillFinalized,
  onCashBanked,
  onCorporateReceipt,
  onDeposit,
  onGrn,
  onPayment,
  onBonusPaid,
  onLoanDisbursed,
  onPayroll,
  onRefund,
} from './services/finance.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './services/ledgers.service.js'; // approval handlers (petty cash)
import './home.js'; // registers this module's widgets on the role home pages

/**
 * Finance (spec "Financial reporting and accounts"): the hospital chart of accounts, journals
 * posted automatically from every money event (bills, receipts, deposits, refunds,
 * cancellations, goods receipts, payroll), vouchers with approval for manual journals, day book,
 * ledgers, trial balance, profit and loss, balance sheet, GST summary and the month close.
 */
const router = Router();
router.use(financeRoutes);
router.use(ledgerRoutes);

export const financeModule = {
  name: 'finance',
  router,
  subscriptions: () => {
    subscribe('billing.billFinalized', 'finance.post-bill', onBillFinalized);
    subscribe('billing.billCancelled', 'finance.reverse-bill', onBillCancelled);
    subscribe('billing.paymentReceived', 'finance.post-receipt', onPayment);
    subscribe('billing.depositReceived', 'finance.post-deposit', onDeposit);
    subscribe('billing.refundPaid', 'finance.post-refund', onRefund);
    subscribe('billing.corporateReceived', 'finance.post-corporate-receipt', onCorporateReceipt);
    subscribe('billing.cashBanked', 'finance.post-cash-banked', onCashBanked);
    subscribe('inventory.grn.posted', 'finance.post-grn', onGrn);
    subscribe('payroll.locked', 'finance.post-payroll', onPayroll);
    subscribe('payroll.loan.disbursed', 'finance.post-loan', onLoanDisbursed);
    subscribe('payroll.bonus.paid', 'finance.post-bonus', onBonusPaid);
  },
};
