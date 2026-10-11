import { z } from 'zod';
import {
  billCreateInput,
  billLinesUpdate,
  cancelRequestInput,
  depositInput,
  discountRequestInput,
  finalizeInput,
  objectId,
  pageQuery,
  paymentInput,
  refundPayInput,
  shiftCloseInput,
  shiftOpenInput,
  shiftVerifyInput,
} from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { AppError, errors } from '../../core/errors/index.js';
import { recordAudit } from '../../core/audit/audit.service.js';
import { scopeFilter } from '../../core/rbac/scope.js';
import { paginate } from '../../core/http/paginate.js';
import { Bill, CashierShift, Payment } from './models/billing.models.js';
import * as bills from './services/bills.service.js';
import * as payments from './services/payments.service.js';
import * as shifts from './services/shift.service.js';
import { billingAnalytics } from './services/analytics.service.js';
import { getSettings, updateSettings } from './services/settings.service.js';
import { billPdf, receiptPdf } from './print/documents.js';

const id = z.object({ id: objectId });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rupees = z
  .number()
  .min(0)
  .max(10_00_000)
  .transform((r) => Math.round(r * 100));
const settingsInput = z.object({
  version: z.number().int().min(0),
  shiftVarianceLimit: rupees,
  defaultOpeningCash: rupees,
  billPaper: z.enum(['A4', 'A5']),
  receiptPaper: z.enum(['THERMAL_80', 'A5']),
  billFooter: z.string().trim().max(200).default(''),
});
const analyticsQuery = z
  .object({ from: day, to: day })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'The end is before the start' })
  .refine((q) => new Date(q.to) - new Date(q.from) <= 366 * 86_400_000, {
    path: ['from'],
    message: 'Pick a period of a year or less',
  });
const accepted = (res, result) => {
  if (result.approvalId) res.locals.status = 202;
  return result;
};

/**
 * Rule R18: the first print is the original; every reprint needs a reason, carries a DUPLICATE
 * watermark and is logged.
 */
async function sendPdf(res, Model, docId, render, entity, reason) {
  const doc = await Model.findOne({ _id: docId, ...scopeFilter({ branch: 'branchId' }) });
  if (!doc) throw errors.notFound(entity);
  if (entity === 'Bill' && !doc.billNo)
    throw new AppError(409, 'INVALID_STATE', 'Finalise the bill before printing it');
  const duplicate = doc.printCount > 0;
  if (duplicate && !reason)
    throw errors.validation([{ path: 'reason', message: 'Give a reason to reprint' }]);
  const pdf = await render(doc, { duplicate });
  await Model.updateOne({ _id: doc._id }, { $inc: { printCount: 1 } });
  await recordAudit({
    action: 'PRINT',
    entity,
    entityId: doc._id,
    summary: duplicate ? `Reprint (DUPLICATE): ${reason}` : 'Printed',
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${(doc.billNo ?? doc.receiptNo).replace(/\//g, '-')}.pdf"`,
  );
  res.send(pdf);
}

const reprint = z.object({ reason: z.string().trim().min(3).max(200).optional() });

export const billRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/billing',
  routes: [
    {
      method: 'get',
      path: '/analytics',
      permission: 'reports:billing:read',
      audit: null,
      summary: 'Revenue, collection, receivables by age and payer, leakage checks for a period',
      schema: { query: analyticsQuery },
      handler: (req) => billingAnalytics(req.valid.query),
    },
    {
      method: 'get',
      path: '/settings',
      permission: 'authenticated',
      audit: null,
      summary: 'Billing settings: shift variance, opening cash, paper sizes, bill footer',
      handler: () => getSettings(),
    },
    {
      method: 'put',
      path: '/settings',
      permission: 'billing:settings:update',
      audit: 'UPDATE',
      summary: 'Change the billing settings (amounts in rupees)',
      schema: { body: settingsInput },
      handler: (req) => updateSettings(req.valid.body),
    },
    {
      method: 'get',
      path: '/bills',
      permission: 'billing:bill:read',
      audit: null,
      summary: 'Bills in this branch, by patient, status, date or bill/UHID number',
      schema: {
        query: pageQuery.extend({
          patientId: objectId.optional(),
          status: z.enum(['DRAFT', 'FINAL', 'PARTLY_PAID', 'PAID', 'CANCELLED']).optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          q: z.string().trim().max(30).optional(),
        }),
      },
      handler: (req) => bills.listBills(req.valid.query),
    },
    {
      method: 'post',
      path: '/bills',
      permission: 'billing:bill:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Start a draft bill; every line is priced from the patient’s price list (rule R1)',
      schema: { body: billCreateInput },
      handler: (req) => bills.createBill(req.valid.body),
    },
    {
      method: 'get',
      path: '/bills/:id',
      permission: 'billing:bill:read',
      audit: null,
      summary: 'One bill with lines, totals, discount and status',
      schema: { params: id },
      handler: (req) => bills.getBill(req.valid.params.id),
    },
    {
      method: 'put',
      path: '/bills/:id/lines',
      permission: 'billing:bill:create',
      audit: 'UPDATE',
      summary: 'Replace the lines of a draft',
      schema: { params: id, body: billLinesUpdate },
      handler: (req) => bills.replaceLines(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/bills/:id/finalize',
      permission: 'billing:bill:finalize',
      audit: 'UPDATE',
      idempotent: 'optional',
      summary: 'Finalise a draft: takes the next bill number (needs an open shift)',
      schema: { params: id, body: finalizeInput },
      handler: (req) => bills.finalizeBill(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/bills/:id/discount',
      permission: 'billing:discount:request',
      audit: 'UPDATE',
      summary: 'Ask for a discount: Billing Manager, plus Super Admin above 10% or ₹10,000 (202)',
      schema: { params: id, body: discountRequestInput },
      handler: async (req, res) =>
        accepted(res, await bills.requestDiscount(req.valid.params.id, req.valid.body)),
    },
    {
      method: 'post',
      path: '/bills/:id/cancel',
      permission: 'billing:cancel:request',
      audit: 'UPDATE',
      summary:
        'Ask to cancel a final bill; after approval a credit note and refunds to the original modes (202)',
      schema: { params: id, body: cancelRequestInput },
      handler: async (req, res) =>
        accepted(res, await bills.requestCancellation(req.valid.params.id, req.valid.body)),
    },
    {
      method: 'get',
      path: '/bills/:id/pdf',
      permission: 'billing:bill:print',
      audit: 'PRINT',
      summary: 'A4 bill PDF; reprints need a reason and say DUPLICATE (rule R18)',
      schema: { params: id, query: reprint },
      handler: (req, res) =>
        sendPdf(res, Bill, req.valid.params.id, billPdf, 'Bill', req.valid.query.reason),
    },
  ],
});

export const paymentRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/billing',
  routes: [
    {
      method: 'post',
      path: '/payments',
      permission: 'billing:payment:create',
      audit: 'CREATE',
      status: 201,
      idempotent: 'required',
      summary:
        'Take a payment and allocate it to bills (cash limit, open shift, original-mode rules)',
      schema: { body: paymentInput },
      handler: (req) => payments.receivePayment(req.valid.body),
    },
    {
      method: 'get',
      path: '/payments',
      permission: 'billing:payment:read',
      audit: null,
      summary: 'Receipts in this branch',
      schema: {
        query: pageQuery.extend({
          patientId: objectId.optional(),
          status: z.enum(['CAPTURED', 'PENDING', 'FAILED', 'REVERSED']).optional(),
          shiftId: objectId.optional(),
        }),
      },
      handler: (req) => payments.listPayments(req.valid.query),
    },
    {
      method: 'post',
      path: '/payments/:id/settle',
      // Confirming money that has not been seen at the counter is a manager action.
      permission: 'billing:payment:settle',
      audit: 'UPDATE',
      summary: 'Confirm or fail a pending payment-link payment',
      schema: {
        params: id,
        body: z.object({
          outcome: z.enum(['CAPTURED', 'FAILED']),
          reference: z.string().trim().max(60).optional(),
          version: z.number().int().min(0),
        }),
      },
      handler: (req) => payments.settlePending(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/payments/:id/pdf',
      permission: 'billing:bill:print',
      audit: 'PRINT',
      summary: '80 mm receipt PDF; reprints need a reason and say DUPLICATE',
      schema: { params: id, query: reprint },
      handler: (req, res) =>
        sendPdf(res, Payment, req.valid.params.id, receiptPdf, 'Payment', req.valid.query.reason),
    },
    {
      method: 'post',
      path: '/deposits',
      permission: 'billing:deposit:create',
      audit: 'CREATE',
      status: 201,
      idempotent: 'required',
      summary: 'Take an advance deposit (used later with payment mode ADVANCE)',
      schema: { body: depositInput },
      handler: (req) => payments.takeDeposit(req.valid.body),
    },
    {
      method: 'get',
      path: '/deposits',
      permission: 'billing:deposit:read',
      audit: null,
      summary: 'Deposits with balance',
      schema: {
        query: pageQuery.extend({
          patientId: objectId.optional(),
          status: z.enum(['OPEN', 'CLOSED']).optional(),
        }),
      },
      handler: (req) => payments.listDeposits(req.valid.query),
    },
    {
      method: 'get',
      path: '/refunds',
      permission: 'billing:refund:read',
      audit: null,
      summary: 'Approved and paid refunds',
      schema: {
        query: pageQuery.extend({
          patientId: objectId.optional(),
          status: z.enum(['APPROVED', 'PAID']).optional(),
        }),
      },
      handler: (req) => payments.listRefunds(req.valid.query),
    },
    {
      method: 'post',
      path: '/refunds/:id/pay',
      permission: 'billing:refund:pay',
      audit: 'UPDATE',
      idempotent: 'required',
      summary: 'Pay out an approved refund through its original modes (needs an open shift)',
      schema: { params: id, body: refundPayInput },
      handler: (req) => payments.payRefund(req.valid.params.id, req.valid.body),
    },
  ],
});

export const shiftRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/billing/shifts',
  routes: [
    {
      method: 'get',
      path: '/current',
      permission: 'billing:shift:read',
      audit: null,
      summary: 'My open shift with the amounts expected so far',
      handler: async () => {
        const s = await shifts.myOpenShift();
        return s ? { ...shifts.shiftDto(s), expected: await shifts.expectedTotals(s) } : null;
      },
    },
    {
      method: 'get',
      path: '/',
      permission: 'billing:shift:read',
      audit: null,
      summary: 'Shifts in this branch (Billing Manager sees all, a cashier their own)',
      schema: {
        query: pageQuery.extend({ status: z.enum(['OPEN', 'COUNTED', 'VERIFIED']).optional() }),
      },
      handler: (req) => {
        const { status, ...page } = req.valid.query;
        return paginate(
          CashierShift,
          { ...scopeFilter({ own: 'userId', branch: 'branchId' }), ...(status ? { status } : {}) },
          { ...page, sort: page.sort ?? '-createdAt' },
          { map: shifts.shiftDto },
        );
      },
    },
    {
      method: 'post',
      path: '/',
      permission: 'billing:shift:open',
      audit: 'CREATE',
      status: 201,
      summary: 'Open my shift at a counter with the opening cash (one cashier per counter)',
      schema: { body: shiftOpenInput },
      handler: (req) => shifts.openShift(req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/close',
      permission: 'billing:shift:close',
      audit: 'UPDATE',
      summary:
        'Count cash note by note and match card/UPI totals; a variance above ₹100 needs a reason',
      schema: { params: id, body: shiftCloseInput },
      handler: (req) => shifts.closeShift(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/verify',
      permission: 'billing:shift:verify',
      audit: 'APPROVE',
      summary: 'Billing Manager verifies a shift with a variance (never their own)',
      schema: { params: id, body: shiftVerifyInput },
      handler: (req) => shifts.verifyShift(req.valid.params.id, req.valid.body),
    },
  ],
});
