import { z } from 'zod';
import { objectId, pageQuery } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import * as corp from './services/corporate.service.js';

const id = z.object({ id: objectId });
const rupees = z
  .number()
  .positive()
  .max(10_00_00_000)
  .transform((r) => Math.round(r * 100));
const READ = 'billing:corporate:read';
const WRITE = 'billing:corporate:update';

/** Corporate and credit desk (board "Corporate and credit"). Amounts in bodies are rupees. */
export const corporateRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/billing',
  routes: [
    {
      method: 'get',
      path: '/corporates',
      permission: READ,
      audit: null,
      summary: 'Corporates and government payers on credit: limit, used, overdue, next invoice',
      handler: () => corp.listCorporates(),
    },
    {
      method: 'get',
      path: '/credit-payers',
      permission: 'billing:bill:create',
      audit: null,
      summary: 'Corporates and schemes a bill can go to on credit now',
      handler: () => corp.creditPayers(),
    },
    {
      method: 'get',
      path: '/corporates/ageing',
      permission: READ,
      audit: null,
      summary: 'Corporate receivables by invoice age',
      handler: () => corp.ageing(),
    },
    {
      method: 'get',
      path: '/corporates/:id',
      permission: READ,
      audit: null,
      summary: 'One corporate: credit, bills for the next invoice, invoices',
      schema: { params: id },
      handler: (req) => corp.getCorporate(req.valid.params.id),
    },
    {
      method: 'get',
      path: '/corporates/:id/statement',
      permission: READ,
      audit: null,
      summary: 'Statement of account with the running balance',
      schema: { params: id },
      handler: (req) => corp.statement(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/corporates/:id/hold',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Put a corporate on credit hold, or release it',
      schema: {
        params: id,
        body: z
          .object({ on: z.boolean(), reason: z.string().trim().max(200).optional() })
          .refine((b) => !b.on || (b.reason?.length ?? 0) >= 5, {
            path: ['reason'],
            message: 'Say why (at least 5 characters)',
          }),
      },
      handler: (req) => corp.setHold(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/corporate-invoices',
      permission: READ,
      audit: null,
      summary: 'Corporate invoices, by payer or status (OVERDUE for past due)',
      schema: {
        query: pageQuery.extend({
          payerId: objectId.optional(),
          status: z.enum(['ISSUED', 'PARTLY_PAID', 'PAID', 'CANCELLED', 'OVERDUE']).optional(),
        }),
      },
      handler: (req) => corp.listInvoices(req.valid.query),
    },
    {
      method: 'post',
      path: '/corporate-invoices',
      permission: WRITE,
      audit: 'CREATE',
      status: 201,
      summary: "Issue a corporate's invoice for its credit bills up to the month's end",
      schema: {
        body: z.object({
          payerId: objectId,
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
        }),
      },
      handler: (req) => corp.issueInvoice(req.valid.body),
    },
    {
      method: 'post',
      path: '/corporate-invoices/:id/payments',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Record a payment from the company; settles the bills oldest first',
      schema: {
        params: id,
        body: z.object({
          version: z.number().int().min(0),
          amount: rupees,
          mode: z.enum(['BANK_TRANSFER', 'CHEQUE']),
          reference: z.string().trim().min(4, 'Enter the UTR or cheque number').max(60),
        }),
      },
      handler: (req) => corp.receivePayment(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/letters-of-credit',
      permission: READ,
      audit: null,
      summary: 'Letters of credit with their validity',
      schema: { query: z.object({ payerId: objectId.optional() }) },
      handler: (req) => corp.listLetters(req.valid.query),
    },
    {
      method: 'post',
      path: '/letters-of-credit',
      permission: WRITE,
      audit: 'CREATE',
      status: 201,
      summary: "Record a company's letter of credit for a patient",
      schema: {
        body: z.object({
          payerId: objectId,
          patientId: objectId,
          letterNo: z.string().trim().min(2).max(40),
          validTill: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
          covers: z.string().trim().max(200).optional(),
          limit: rupees.optional(),
        }),
      },
      handler: (req) => corp.addLetter(req.valid.body),
    },
    {
      method: 'post',
      path: '/letters-of-credit/:id/cancel',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Cancel a letter of credit',
      schema: { params: id, body: z.object({ version: z.number().int().min(0) }) },
      handler: (req) => corp.cancelLetter(req.valid.params.id, req.valid.body),
    },
  ],
});
