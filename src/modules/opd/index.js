import { Router } from 'express';
import { registerPatientMergeHandler, registerPatientTimelineSource } from '../patients/index.js';
import { subscribe } from '../../core/events/events.js';
import { sendSms } from '../../core/notify/notify.service.js';
import { current } from '../../core/tenancy/context.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { opdPublicRoutes, opdReportRoutes, opdRoutes } from './opd.routes.js';
import { Appointment } from './models/opd.models.js';
import { settingsDoc } from './services/settings.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages
import './patient-sections.js'; // this module's sections of the patient record

/**
 * OPD and appointments (docs/modules/OPD.md): doctor schedules and slots, booking, check-in with
 * tokens, triage, the doctor's queue, consultation with e-prescription and orders, the clinic
 * desk close-out (billing), Queue TV and OPD analytics. Orders and admission requests leave as
 * events for the lab, radiology, pharmacy and IPD modules.
 */

async function messageOn(code) {
  const s = await settingsDoc();
  return s.messages.find((m) => m.code === code)?.on !== false;
}

const hospitalName = async () =>
  (await Tenant.findById(current().tenantId).select('name').lean())?.name ?? 'the hospital';

/** Booking confirmation SMS (message BOOKING_CONFIRMED in OPD settings). */
export async function sendBookingSms({ appointmentId, mobile, date, time, doctor }) {
  if (!mobile || !(await messageOn('BOOKING_CONFIRMED'))) return;
  const a = await Appointment.findById(appointmentId).select('apptNo channel').lean();
  if (!a || a.channel === 'WALK_IN') return;
  await sendSms({
    to: mobile,
    template: 'OPD_BOOKED',
    vars: { hospital: await hospitalName(), doctor, date, time, apptNo: a.apptNo },
  });
}

/** "Please go to room" SMS when the doctor calls the token (message TOKEN_NEAR in settings). */
export async function sendCalledSms({ visitId, token, room }) {
  if (!(await messageOn('TOKEN_NEAR'))) return;
  const { OpdVisit } = await import('./models/opd.models.js');
  const v = await OpdVisit.findById(visitId).select('patient.mobile').lean();
  if (!v?.patient?.mobile) return;
  await sendSms({
    to: v.patient.mobile,
    template: 'OPD_TOKEN_CALLED',
    vars: { hospital: await hospitalName(), token, room: room ?? '-' },
  });
}

registerPatientTimelineSource(async (patientId) => {
  const { OpdVisit } = await import('./models/opd.models.js');
  const visits = await OpdVisit.find({ 'patient.id': patientId })
    .select('visitNo doctor checkedInAt status')
    .lean();
  return visits.map((v) => ({
    at: v.checkedInAt,
    type: 'OPD_VISIT',
    title: `OPD ${v.visitNo} · ${v.doctor?.name ?? ''} · ${v.status}`,
    ref: String(v._id),
  }));
});
registerPatientMergeHandler(async (fromId, toId) => {
  const { OpdVisit, HealthCheckup, TreatmentPlan } = await import('./models/opd.models.js');
  for (const Model of [Appointment, OpdVisit, HealthCheckup, TreatmentPlan])
    await Model.updateMany({ 'patient.id': fromId }, { $set: { 'patient.id': toId } });
});

const router = Router();
router.use(opdRoutes);
router.use(opdReportRoutes);

// Queue TVs with a display key (no signed-in user).
const publicRouter = Router();
publicRouter.use(opdPublicRoutes);

export const opdModule = {
  name: 'opd',
  router,
  publicRouter,
  subscriptions: () => {
    subscribe('opd.appointment.booked', 'opd.booking-sms', sendBookingSms);
    subscribe('opd.queue.called', 'opd.called-sms', sendCalledSms);
  },
};

export { Appointment, OpdVisit } from './models/opd.models.js';
export { ICD10 } from './data/clinical.js';
export { book, cancel } from './services/appointment.service.js';
export { listDepartments, newVisitFee, slots } from './services/schedule.service.js';
