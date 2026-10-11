import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { registerFilePurpose } from '../../core/files/files.service.js';
import { sendSms } from '../../core/notify/notify.service.js';
import { current } from '../../core/tenancy/context.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { patientRoutes } from './patients.routes.js';
import { consentRoutes } from './consents.js';
import { abdmRoutes, patientSectionRoutes } from './sections.js';

/**
 * Patients (CORE): registration with a permanent UHID, duplicate warning, search, profile with
 * access log, merge through approval. Other modules extend the timeline and merges through the
 * registries exported below.
 */
registerFilePurpose('patient-photo', {
  mimes: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 2 * 1024 * 1024,
  write: 'patients:patient:update',
  read: 'patients:patient:read',
});
registerFilePurpose('patient-document', {
  mimes: ['image/jpeg', 'image/png', 'application/pdf'],
  maxBytes: 10 * 1024 * 1024,
  write: 'patients:patient:update',
  read: 'patients:patient:read',
});

/** Spec 5.4 step 6: welcome SMS with the UHID (runs in the worker). */
export async function sendWelcomeSms({ mobile, uhid, language }) {
  // Event handlers run in a system context without the request's tenant snapshot.
  const hospital =
    (await Tenant.findById(current().tenantId).select('name').lean())?.name ?? 'the hospital';
  await sendSms({
    to: mobile,
    template: 'PATIENT_WELCOME',
    vars: { hospital, uhid },
    lang: language,
  });
}

const router = Router();
// Section routes first: /patients/registered-today must not be read as /patients/:id.
router.use(patientSectionRoutes, abdmRoutes, patientRoutes, consentRoutes);

export const patientsModule = {
  name: 'patients',
  router,
  subscriptions: () => subscribe('patient.registered', 'patients.welcome-sms', sendWelcomeSms),
};
export {
  registerPatientMergeHandler,
  registerPatientTimelineSource,
  patientCard,
} from './services/patients.service.js';
export { Patient } from './models/patient.model.js';
export { registerPatientSection, registerPatientSummary } from './sections.js';
