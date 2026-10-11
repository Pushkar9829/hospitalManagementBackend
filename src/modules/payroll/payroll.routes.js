import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { myEmployee } from '../hr/index.js';
import * as pay from './services/payroll.service.js';
import * as decl from './services/declaration.service.js';

const id = z.object({ id: objectId });

/** Payroll (board Payroll) and payslips in self-service (board MySpace). */
export const payrollRoutes = defineRoutes({
  module: 'PAY',
  basePath: '/payroll',
  routes: [
    {
      method: 'get',
      path: '/employees/:id/structures',
      permission: ['payroll:structure:read', 'hr:employee:read'],
      audit: 'VIEW',
      summary: 'An employee’s salary structures (active, pending, history)',
      schema: { params: id },
      handler: (req) => pay.structures(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/employees/:id/structures',
      permission: ['payroll:structure:create', 'hr:employee:update'],
      audit: 'CREATE',
      status: 201,
      summary: 'Propose a salary structure or revision (goes for approval)',
      schema: { params: id, body: pay.structureInput },
      handler: (req, res) => pay.proposeStructure(req.valid.params.id, req.valid.body, res),
    },
    {
      method: 'get',
      path: '/employees/:id/loans',
      permission: ['payroll:loan:read', 'payroll:run:read'],
      audit: null,
      summary: 'Loans and advances',
      schema: { params: id },
      handler: (req) => pay.loans(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/employees/:id/loans',
      permission: 'payroll:loan:create',
      audit: 'CREATE',
      status: 201,
      summary: 'A loan or salary advance with its monthly instalment',
      schema: { params: id, body: pay.loanInput },
      handler: (req) => pay.createLoan(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/runs',
      permission: 'payroll:run:read',
      audit: null,
      summary: 'Payroll runs by month',
      handler: () => pay.listRuns(),
    },
    {
      method: 'post',
      path: '/runs',
      permission: 'payroll:run:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Start a month’s run (attendance must be locked)',
      schema: { body: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }) },
      handler: (req) => pay.createRun(req.valid.body),
    },
    {
      method: 'get',
      path: '/runs/:id',
      permission: 'payroll:run:read',
      audit: 'VIEW',
      summary: 'A run with totals',
      schema: { params: id },
      handler: (req) => pay.getRun(req.valid.params.id),
    },
    {
      method: 'put',
      path: '/runs/:id/inputs',
      permission: 'payroll:run:create',
      audit: 'UPDATE',
      summary: 'Variable inputs: overtime hours, incentive, arrears, other deductions',
      schema: { params: id, body: pay.inputsInput },
      handler: (req) => pay.setInputs(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/runs/:id/calculate',
      permission: 'payroll:run:create',
      audit: 'UPDATE',
      summary: 'Calculate every payslip (gross, PF, ESI, PT, TDS, loans, net)',
      schema: { params: id },
      noBody: true,
      handler: (req) => pay.calculate(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/runs/:id/submit',
      permission: 'payroll:run:create',
      audit: 'UPDATE',
      summary: 'Submit for release (HR Manager, then Finance Controller)',
      schema: { params: id },
      noBody: true,
      handler: (req, res) => pay.submit(req.valid.params.id, res),
    },
    {
      method: 'get',
      path: '/runs/:id/payslips',
      permission: 'payroll:run:read',
      audit: 'VIEW',
      summary: 'The run’s payslips with variance against last month',
      schema: { params: id },
      handler: (req) => pay.payslips(req.valid.params.id),
    },
    {
      method: 'get',
      path: '/runs/:id/bank-file',
      permission: 'payroll:run:read',
      audit: 'EXPORT',
      summary: 'Bank transfer file (locked runs)',
      schema: { params: id },
      handler: (req) => pay.bankFile(req.valid.params.id),
    },
    {
      method: 'get',
      path: '/runs/:id/pf-ecr',
      permission: 'payroll:run:read',
      audit: 'EXPORT',
      summary: 'PF ECR rows',
      schema: { params: id },
      handler: (req) => pay.pfEcr(req.valid.params.id),
    },
    {
      method: 'get',
      path: '/settings',
      permission: ['payroll:run:read', 'payroll:settings:read'],
      audit: null,
      summary: 'Statutory rates and allowances',
      handler: () => pay.statutory(),
    },
    {
      method: 'put',
      path: '/settings',
      permission: 'payroll:settings:update',
      audit: 'UPDATE',
      summary: 'Save statutory rates and allowances',
      schema: { body: pay.settingsInput },
      handler: (req) => pay.saveSettings(req.valid.body),
    },
    {
      method: 'get',
      path: '/payslips/me',
      permission: 'myspace:payslip:read',
      audit: 'VIEW',
      summary: 'My payslips (locked months)',
      handler: async () => pay.myPayslips((await myEmployee())._id),
    },
  ],
});

/** Income-tax declarations: the employee's own (My Space) and payroll's review. */
export const declarationRoutes = defineRoutes({
  module: 'PAY',
  basePath: '',
  routes: [
    {
      method: 'get',
      path: '/me/tax-declaration',
      permission: 'myspace:payslip:read',
      audit: null,
      summary: 'My income-tax declaration for this financial year',
      handler: () => decl.myDeclaration(),
    },
    {
      method: 'put',
      path: '/me/tax-declaration',
      permission: 'myspace:tax:update',
      audit: 'UPDATE',
      summary: 'Save my declaration: regime, rent, 80C and 80D (rupees)',
      schema: { body: decl.declarationInput },
      handler: (req) => decl.saveMyDeclaration(req.valid.body),
    },
    {
      method: 'get',
      path: '/payroll/tax-declarations',
      permission: 'payroll:run:read',
      audit: null,
      summary: 'Declarations for a financial year, newest first',
      schema: {
        query: z.object({
          fy: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .optional(),
          status: z.enum(['SUBMITTED', 'VERIFIED', 'REJECTED']).optional(),
        }),
      },
      handler: (req) => decl.listDeclarations(req.valid.query),
    },
    {
      method: 'post',
      path: '/payroll/tax-declarations/:id/review',
      permission: 'payroll:run:create',
      audit: 'UPDATE',
      summary: 'Verify a declaration, or reject it (TDS then uses the salary structure)',
      schema: {
        params: z.object({ id: objectId }),
        body: z.object({
          version: z.number().int().min(0),
          outcome: z.enum(['VERIFIED', 'REJECTED']),
          note: z.string().trim().max(200).optional(),
        }),
      },
      handler: (req) => decl.reviewDeclaration(req.valid.params.id, req.valid.body),
    },
  ],
});
