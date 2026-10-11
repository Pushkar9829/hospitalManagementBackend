import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as fin from './services/finance.service.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const READ = ['finance:report:read', 'finance:voucher:read'];

/** Finance (board Finance): chart, vouchers, statements, GST, period close. */
export const financeRoutes = defineRoutes({
  module: 'FIN',
  basePath: '/finance',
  routes: [
    {
      method: 'get',
      path: '/accounts',
      permission: READ,
      audit: null,
      summary: 'Chart of accounts',
      handler: () => fin.listAccounts(),
    },
    {
      method: 'post',
      path: '/accounts',
      permission: 'finance:account:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Add a ledger',
      schema: { body: fin.accountInput },
      handler: (req) => fin.createAccount(req.valid.body),
    },
    {
      method: 'get',
      path: '/vouchers',
      permission: READ,
      audit: null,
      summary: 'Day book: journals by date, type or account',
      schema: {
        query: z.object({
          from: ymd.optional(),
          to: ymd.optional(),
          type: z
            .enum([
              'SALES',
              'RECEIPT',
              'PAYMENT',
              'JOURNAL',
              'CONTRA',
              'PURCHASE',
              'PAYROLL',
              'REVERSAL',
            ])
            .optional(),
          accountId: objectId.optional(),
          limit: z.coerce.number().int().min(1).max(1000).default(200),
        }),
      },
      handler: (req) => fin.listJournals(req.valid.query),
    },
    {
      method: 'post',
      path: '/vouchers',
      permission: 'finance:voucher:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Payment, receipt or contra voucher; a manual journal goes for approval',
      schema: { body: fin.voucherInput },
      handler: (req, res) => fin.createVoucher(req.valid.body, res),
    },
    {
      method: 'get',
      path: '/trial-balance',
      permission: READ,
      audit: null,
      summary: 'Trial balance as of a date',
      schema: { query: z.object({ asOf: ymd.optional() }) },
      handler: (req) => fin.trialBalance(req.valid.query),
    },
    {
      method: 'get',
      path: '/profit-loss',
      permission: READ,
      audit: null,
      summary: 'Profit and loss for a period',
      schema: { query: z.object({ from: ymd.optional(), to: ymd.optional() }) },
      handler: (req) => fin.profitLoss(req.valid.query),
    },
    {
      method: 'get',
      path: '/balance-sheet',
      permission: READ,
      audit: null,
      summary: 'Balance sheet as of a date',
      schema: { query: z.object({ asOf: ymd.optional() }) },
      handler: (req) => fin.balanceSheet(req.valid.query),
    },
    {
      method: 'get',
      path: '/ledger/:id',
      permission: READ,
      audit: null,
      summary: 'An account’s ledger with opening and running balance',
      schema: {
        params: z.object({ id: objectId }),
        query: z.object({ from: ymd.optional(), to: ymd.optional() }),
      },
      handler: (req) => fin.ledger({ accountId: req.valid.params.id, ...req.valid.query }),
    },
    {
      method: 'get',
      path: '/gst',
      permission: READ,
      audit: null,
      summary: 'GST for a month: output by rate, input, payable',
      schema: { query: z.object({ month }) },
      handler: (req) => fin.gstSummary(req.valid.query),
    },
    {
      method: 'get',
      path: '/period',
      permission: READ,
      audit: null,
      summary: 'Locked-through month and the lock history',
      handler: () => fin.getPeriod(),
    },
    {
      method: 'post',
      path: '/period/lock',
      permission: 'finance:period:lock',
      audit: 'APPROVE',
      summary: 'Close a month: no vouchers in or before it',
      schema: { body: z.object({ month }) },
      handler: (req) => fin.lockPeriod(req.valid.body),
    },
    {
      method: 'post',
      path: '/period/reopen',
      permission: 'settings:accounts:reopen',
      audit: 'UPDATE',
      summary: 'Reopen a closed month (Super Admin)',
      schema: { body: z.object({ month, reason: z.string().trim().min(5).max(200) }) },
      handler: (req) => fin.reopenPeriod(req.valid.body),
    },
  ],
});
