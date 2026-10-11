import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as cash from './services/cashbook.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rupees = z
  .number()
  .min(0)
  .max(1_00_00_000)
  .transform((r) => Math.round(r * 100));
const READ = 'billing:shift:read';
const VERIFY = 'billing:shift:verify';

/** Card and UPI settlement, bank deposits and the day lock (board "Shift and day-end"). */
export const cashbookRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/billing',
  routes: [
    {
      method: 'get',
      path: '/settlements',
      permission: READ,
      audit: null,
      summary: "A day's card and UPI receipts by device, matched against the bank's settlement",
      schema: { query: z.object({ date: day }) },
      handler: (req) => cash.settlements(req.valid.query),
    },
    {
      method: 'post',
      path: '/settlements',
      permission: VERIFY,
      audit: 'UPDATE',
      summary: 'Record what the bank settled for a device and day, with the UTR or batch',
      schema: {
        body: z.object({
          date: day,
          mode: z.string().trim().min(1).max(20),
          counter: z.string().trim().min(1).max(30),
          settled: rupees,
          reference: z.string().trim().min(3).max(60),
          note: z.string().trim().max(200).optional(),
        }),
      },
      handler: (req) => cash.recordSettlement(req.valid.body),
    },
    {
      method: 'get',
      path: '/bank-deposits',
      permission: READ,
      audit: null,
      summary: 'Bank deposit slips, newest first',
      handler: () => cash.listDeposits(),
    },
    {
      method: 'post',
      path: '/bank-deposits',
      permission: VERIFY,
      audit: 'CREATE',
      status: 201,
      summary: 'A deposit slip for cash and cheques taken to the bank',
      schema: {
        body: z.object({
          date: day,
          bank: z.string().trim().min(2).max(60),
          cash: rupees.optional(),
          cheques: z
            .array(
              z.object({
                number: z.string().trim().min(3).max(20),
                bank: z.string().trim().min(2).max(60),
                amount: rupees.refine((v) => v > 0, 'Enter the amount'),
              }),
            )
            .max(30)
            .default([]),
          reference: z.string().trim().max(60).optional(),
        }),
      },
      handler: (req) => cash.createDeposit(req.valid.body),
    },
    {
      method: 'post',
      path: '/bank-deposits/:id/status',
      permission: VERIFY,
      audit: 'UPDATE',
      summary: 'The bank credited the slip, or returned a cheque',
      schema: {
        params: z.object({ id: objectId }),
        body: z.object({
          version: z.number().int().min(0),
          status: z.enum(['CREDITED', 'CHEQUE_RETURNED']),
          reference: z.string().trim().max(60).optional(),
          note: z.string().trim().max(200).optional(),
        }),
      },
      handler: (req) => cash.updateDeposit(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/days/:date',
      permission: READ,
      audit: null,
      summary: 'Day-end state: shifts open, to verify, verified; locked or not',
      schema: { params: z.object({ date: day }) },
      handler: (req) => cash.dayState(req.valid.params.date),
    },
    {
      method: 'post',
      path: '/days/:date/lock',
      permission: VERIFY,
      audit: 'UPDATE',
      summary: 'Lock the day once every shift is verified',
      schema: { params: z.object({ date: day }) },
      handler: (req) => cash.lockDay(req.valid.params.date),
    },
  ],
});
