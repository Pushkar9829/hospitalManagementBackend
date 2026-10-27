import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { AppError } from '../../core/errors/index.js';
import { current, runAsSystem } from '../../core/tenancy/context.js';
import * as svc from './service.js';
import { decrypt } from './nhcx/jwe.js';

const id = z.object({ id: objectId });
const text = (max = 300) => z.string().trim().max(max);
const paise = z.number().int().min(0).max(10_00_00_000_00);
const READ = 'pmjay:case:read';
const WRITE = 'pmjay:case:update';

const pkgBody = z.object({
  code: text(20).min(2),
  name: text(200).min(2),
  specialty: text(80).min(2),
  rate: paise,
  stayDays: z.number().int().min(0).max(365).default(0),
  preauthRequired: z.boolean().default(true),
  reservedForPublic: z.boolean().default(false),
  documents: z
    .object({
      preauth: z.array(text(120)).max(20).default([]),
      claim: z.array(text(120)).max(20).default([]),
    })
    .default({ preauth: [], claim: [] }),
  isActive: z.boolean().default(true),
});
const decision = z.object({
  outcome: z.enum(['APPROVED', 'QUERY', 'REJECTED']),
  amount: paise.optional(),
  text: text(1000).optional(),
});

/**
 * Ayushman Bharat PM-JAY cashless desk: HBP packages, beneficiary cases, pre-authorisation and
 * claims on the scheme's clocks, through TMS (numbers typed in) or NHCX (FHIR over the exchange).
 */
export const pmjayRoutes = defineRoutes({
  module: 'PMJ',
  basePath: '/pmjay',
  routes: [
    {
      method: 'get',
      path: '/settings',
      permission: READ,
      audit: null,
      summary: 'PM-JAY registration, claim channel and the standard document list',
      handler: () => svc.getSettings(),
    },
    {
      method: 'put',
      path: '/settings',
      permission: 'pmjay:settings:update',
      audit: 'UPDATE',
      summary: 'Save the hospital type, state, PM-JAY hospital ID, HFR ID and channel',
      schema: {
        body: z.object({
          hospitalType: z.enum(['PRIVATE', 'PUBLIC']).optional(),
          stateCode: text(4).optional(),
          hospitalCode: text(40).optional(),
          hfrId: text(40).optional(),
          payerId: objectId.optional(),
          channel: z.enum(['TMS', 'NHCX']).optional(),
          nhcx: z
            .object({
              mode: z.enum(['MOCK', 'SANDBOX', 'LIVE']).optional(),
              participantCode: text(80).optional(),
              payerCode: text(80).optional(),
            })
            .optional(),
        }),
      },
      handler: (req) => svc.saveSettings(req.valid.body),
    },
    {
      method: 'get',
      path: '/packages',
      permission: READ,
      audit: null,
      summary: 'HBP packages the hospital is empanelled for, at the state rate',
      schema: {
        query: z.object({
          q: text(60).optional(),
          specialty: text(80).optional(),
          active: z.coerce.boolean().default(true),
        }),
      },
      handler: (req) => svc.listPackages(req.valid.query),
    },
    {
      method: 'post',
      path: '/packages',
      permission: 'pmjay:package:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Add an HBP package',
      schema: { body: pkgBody },
      handler: (req) => svc.savePackage(req.valid.body),
    },
    {
      method: 'patch',
      path: '/packages/:id',
      permission: 'pmjay:package:update',
      audit: 'UPDATE',
      summary: 'Change an HBP package (rate revision, documents, active)',
      schema: { params: id, body: pkgBody.partial() },
      handler: (req) => svc.savePackage(req.valid.body, req.valid.params.id),
    },
    {
      method: 'post',
      path: '/packages/import',
      permission: 'pmjay:package:create',
      audit: 'CREATE',
      summary: 'Import the State Health Agency rate list (adds new codes, updates the rest)',
      schema: { body: z.object({ rows: z.array(pkgBody).min(1).max(5000) }) },
      handler: (req) => svc.importPackages(req.valid.body),
    },
    {
      method: 'get',
      path: '/summary',
      permission: READ,
      audit: null,
      summary: 'Desk dashboard: cases by status, clocks overdue, claimed / approved / paid',
      handler: () => svc.summary(),
    },
    {
      method: 'get',
      path: '/cases',
      permission: READ,
      audit: null,
      summary: 'Worklist: cases at risk of auto-rejection first, then overdue',
      schema: {
        query: z.object({
          open: z.coerce.boolean().default(true),
          status: text(200).optional(),
          overdue: z.coerce.boolean().optional(),
          q: text(60).optional(),
        }),
      },
      handler: (req) => svc.listCases(req.valid.query),
    },
    {
      method: 'post',
      path: '/cases',
      permission: 'pmjay:case:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Register a verified beneficiary on a stay (moves the stay to PM-JAY, cashless)',
      schema: {
        body: z.object({
          admissionId: objectId,
          channel: z.enum(['TMS', 'NHCX']).optional(),
          beneficiary: z.object({
            pmjayId: text(40).min(4),
            name: text(120).optional(),
            familyId: text(40).optional(),
            abha: text(40).optional(),
            verification: z.object({
              method: z.enum(['AADHAAR_OTP', 'AADHAAR_BIOMETRIC', 'FALLBACK']),
              ref: text(80).optional(),
            }),
          }),
        }),
      },
      handler: (req) => svc.registerCase(req.valid.body),
    },
    {
      method: 'get',
      path: '/stays',
      permission: READ,
      audit: null,
      summary: 'In-patients not yet on PM-JAY (to register a beneficiary)',
      schema: { query: z.object({ q: text(60).optional() }) },
      handler: (req) => svc.eligibleStays(req.valid.query),
    },
    {
      method: 'get',
      path: '/admissions/:id/case',
      permission: [READ, 'ipd:admission:read'],
      audit: null,
      summary: 'The PM-JAY case of a stay, if any',
      schema: { params: id },
      handler: async (req) => (await svc.caseForAdmission(req.valid.params.id)) ?? { case: null },
    },
    {
      method: 'get',
      path: '/cases/:id',
      permission: READ,
      audit: 'VIEW',
      summary: 'One case with its clock, documents still missing and history',
      schema: { params: id },
      handler: (req) => svc.getCase(req.valid.params.id),
    },
    {
      method: 'put',
      path: '/cases/:id/packages',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Choose the HBP package(s); the IP bill becomes the package rate',
      schema: {
        params: id,
        body: z.object({
          packageIds: z.array(objectId).min(1).max(5),
          diagnosis: text(300).optional(),
          plannedTreatment: text(500).optional(),
        }),
      },
      handler: (req) => svc.setPackages(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/cases/:id/documents',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Attach an uploaded file to the case checklist',
      schema: {
        params: id,
        body: z.object({
          stage: z.enum(['PREAUTH', 'DISCHARGE', 'CLAIM']),
          name: text(120).min(2),
          fileId: text(80).min(1),
        }),
      },
      handler: (req) => svc.addDocument(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/cases/:id/preauth',
      permission: WRITE,
      audit: 'CREATE',
      summary: 'Send the pre-authorisation (TMS number, or over NHCX); 6-hour decision clock',
      schema: {
        params: id,
        body: z.object({
          tmsRegistrationId: text(60).optional(),
          tmsPreauthNo: text(60).optional(),
        }),
      },
      handler: (req) => svc.submitPreauth(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/cases/:id/preauth/decision',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Record the pre-auth decision seen in TMS: approved, query or rejected',
      schema: { params: id, body: decision.extend({ preauthNo: text(60).optional() }) },
      handler: (req) => svc.preauthDecision(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/cases/:id/preauth/answer-query',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Answer a pre-auth query (decision clock restarts)',
      schema: { params: id, body: z.object({ text: text(1000).min(3) }) },
      handler: (req) => svc.answerPreauthQuery(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/cases/:id/claim',
      permission: WRITE,
      audit: 'CREATE',
      summary: 'Submit the claim after discharge (final bill and discharge documents needed)',
      schema: { params: id, body: z.object({ tmsClaimNo: text(60).optional() }) },
      handler: (req) => svc.submitClaim(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/cases/:id/claim/decision',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Record the claim decision: approved (with deductions), query or rejected',
      schema: {
        params: id,
        body: decision.extend({
          deductions: z
            .array(z.object({ reason: text(200).min(2), amount: paise }))
            .max(20)
            .default([]),
        }),
      },
      handler: (req) => svc.claimDecision(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/cases/:id/claim/answer-query',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Answer a claim query',
      schema: { params: id, body: z.object({ text: text(1000).min(3) }) },
      handler: (req) => svc.answerClaimQuery(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/cases/:id/payment',
      permission: WRITE,
      audit: 'UPDATE',
      idempotent: 'optional',
      summary: 'Record the State Health Agency payment (UTR); settles the IP bill',
      schema: { params: id, body: z.object({ amount: paise, utr: text(40).min(4) }) },
      handler: (req) => svc.recordPayment(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/cases/:id/cancel',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'Cancel a case registered by mistake (before pre-auth); the stay goes back to cash',
      schema: { params: id, body: z.object({ reason: text(300).min(3) }) },
      handler: (req) => svc.cancelCase(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/cases/:id/fhir',
      permission: READ,
      audit: null,
      summary: 'The NHCX FHIR bundle this case sends (pre-auth or claim), for checking',
      schema: {
        params: id,
        query: z.object({ use: z.enum(['preauthorization', 'claim']).default('preauthorization') }),
      },
      handler: (req) => svc.fhirPreview(req.valid.params.id, req.valid.query),
    },
    {
      method: 'post',
      path: '/cases/:id/nhcx/mock-response',
      permission: WRITE,
      audit: 'UPDATE',
      summary: 'NHCX mock mode only: play the payer’s answer through the callback path',
      schema: {
        params: id,
        body: decision.extend({ use: z.enum(['preauthorization', 'claim']) }),
      },
      handler: (req) => svc.mockResponse(req.valid.params.id, req.valid.body),
    },
  ],
});

/**
 * NHCX `on_submit` callbacks (no sign-in: the exchange calls us). The body is a JWE encrypted
 * with our public key; only NHCX_PRIVATE_KEY opens it, which is the authentication.
 */
export const pmjayPublicRoutes = defineRoutes({
  module: 'PMJ',
  basePath: '/pmjay/nhcx',
  routes: [
    {
      method: 'post',
      path: '/:action/on_submit',
      permission: 'public',
      audit: null,
      summary: 'NHCX callback with the payer’s ClaimResponse (JWE)',
      schema: {
        params: z.object({ action: z.enum(['preauth', 'claim']) }),
        body: z.object({ payload: z.string().min(20).max(5_000_000) }),
      },
      handler: async (req, res) => {
        const key = process.env.NHCX_PRIVATE_KEY;
        if (!key) throw new AppError(503, 'NHCX_NOT_CONFIGURED', 'NHCX is not set up here');
        let msg;
        try {
          msg = decrypt(req.valid.body.payload, key.replace(/\\n/g, '\n'));
        } catch {
          throw new AppError(401, 'BAD_PAYLOAD', 'The payload could not be opened');
        }
        const correlationId = msg.header['x-hcx-correlation_id'];
        await runAsSystem(
          current().tenantId,
          () => svc.applyCallback({ correlationId, bundle: msg.payload }),
          {
            userName: 'NHCX',
          },
        );
        res.locals.status = 202;
        return { timestamp: Date.now(), correlation_id: correlationId };
      },
    },
  ],
});
