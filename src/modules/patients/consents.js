import { Schema } from 'mongoose';
import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineModel } from '../../core/db/model.js';
import { AppError, errors } from '../../core/errors/index.js';
import { publish } from '../../core/events/events.js';
import { defineRoutes } from '../../core/http/route.js';
import { current } from '../../core/tenancy/context.js';
import { Patient } from './models/patient.model.js';

/**
 * Patient consents (board Patient profile, "Consents"): what the patient agreed to, how
 * (tablet signature, paper, OTP, the registration form), for how long, and withdrawals. A
 * withdrawn messaging consent stops campaigns (CRM listens to patients.consent.changed).
 */
export const CONSENT_TYPES = [
  'TREATMENT',
  'ADMISSION',
  'PROCEDURE',
  'ANAESTHESIA',
  'BLOOD_TRANSFUSION',
  'HIV_TEST',
  'ABHA_LINKING',
  'DATA_SHARING',
  'RESEARCH',
  'SMS',
  'WHATSAPP',
  'MARKETING',
];
const CHANNELS = ['TABLET_SIGNATURE', 'PAPER', 'OTP', 'REGISTRATION_FORM', 'VERBAL_WITNESSED'];

const consentSchema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  type: { type: String, enum: CONSENT_TYPES, required: true },
  channel: { type: String, enum: CHANNELS, required: true },
  givenAt: { type: Date, default: () => new Date() },
  /** YYYY-MM-DD; empty = until withdrawn. */
  validUntil: String,
  scope: String, // "This admission IP/26-27/000871", "Knee arthroscopy"
  givenBy: String, // patient, or the relative's name and relation
  witness: String,
  fileId: { type: Schema.Types.ObjectId, ref: 'StoredFile' },
  recordedBy: String,
  status: { type: String, enum: ['ACTIVE', 'WITHDRAWN'], default: 'ACTIVE' },
  withdrawnAt: Date,
  withdrawnBy: String,
  withdrawReason: String,
});
consentSchema.index({ tenantId: 1, patientId: 1, givenAt: -1 });
export const Consent = defineModel('Consent', consentSchema);

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const out = (c, today = istToday()) => ({
  id: String(c._id),
  patientId: String(c.patientId),
  type: c.type,
  channel: c.channel,
  givenAt: c.givenAt,
  validUntil: c.validUntil ?? null,
  scope: c.scope,
  givenBy: c.givenBy,
  witness: c.witness,
  fileId: c.fileId ? String(c.fileId) : null,
  recordedBy: c.recordedBy,
  status:
    c.status === 'WITHDRAWN'
      ? 'WITHDRAWN'
      : c.validUntil && c.validUntil < today
        ? 'EXPIRED'
        : 'ACTIVE',
  withdrawnAt: c.withdrawnAt,
  withdrawnBy: c.withdrawnBy,
  withdrawReason: c.withdrawReason,
  version: c.version ?? 0,
});

async function listConsents(patientId) {
  const rows = await Consent.find({ patientId }).sort({ givenAt: -1 }).lean();
  return { items: rows.map((c) => out(c)) };
}

async function recordConsent(patientId, input) {
  const p = await Patient.findById(patientId).select('mobile').lean();
  if (!p) throw errors.notFound('Patient');
  const [c] = await Consent.create([{ ...input, patientId, recordedBy: current().userName }]);
  await publish('patients.consent.changed', {
    patientId: String(patientId),
    mobile: p.mobile,
    type: c.type,
    status: 'ACTIVE',
  });
  return out(c);
}

async function withdrawConsent(patientId, id, { version, reason }) {
  const c = await Consent.findOne({ _id: id, patientId });
  if (!c) throw errors.notFound('Consent');
  if (c.version !== version) throw errors.versionConflict();
  if (c.status === 'WITHDRAWN') throw new AppError(409, 'INVALID_STATE', 'Already withdrawn');
  c.set({
    status: 'WITHDRAWN',
    withdrawnAt: new Date(),
    withdrawnBy: current().userName,
    withdrawReason: reason,
  });
  await c.save();
  const p = await Patient.findById(patientId).select('mobile').lean();
  await publish('patients.consent.changed', {
    patientId: String(patientId),
    mobile: p?.mobile,
    type: c.type,
    status: 'WITHDRAWN',
  });
  return out(c);
}

const ids = z.object({ id: objectId });
export const consentRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/patients',
  routes: [
    {
      method: 'get',
      path: '/:id/consents',
      permission: 'patients:patient:read',
      audit: null,
      summary: "A patient's consents: given, how, valid until, withdrawn",
      schema: { params: ids },
      handler: (req) => listConsents(req.valid.params.id),
    },
    {
      method: 'post',
      path: '/:id/consents',
      permission: 'patients:patient:update',
      audit: 'CREATE',
      status: 201,
      summary: 'Record a consent (signed, on paper, by OTP or on the registration form)',
      schema: {
        params: ids,
        body: z.object({
          type: z.enum(CONSENT_TYPES),
          channel: z.enum(CHANNELS),
          validUntil: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
            .optional(),
          scope: z.string().trim().max(200).optional(),
          givenBy: z.string().trim().max(120).optional(),
          witness: z.string().trim().max(120).optional(),
          fileId: objectId.optional(),
        }),
      },
      handler: (req) => recordConsent(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/consents/:consentId/withdraw',
      permission: 'patients:patient:update',
      audit: 'UPDATE',
      summary: 'Withdraw a consent with the reason',
      schema: {
        params: z.object({ id: objectId, consentId: objectId }),
        body: z.object({
          version: z.number().int().min(0),
          reason: z.string().trim().min(3).max(300),
        }),
      },
      handler: (req) =>
        withdrawConsent(req.valid.params.id, req.valid.params.consentId, req.valid.body),
    },
  ],
});
