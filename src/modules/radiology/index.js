import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { sendSms } from '../../core/notify/notify.service.js';
import { current } from '../../core/tenancy/context.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { registerPatientMergeHandler, registerPatientTimelineSource } from '../patients/index.js';
import { radRoutes } from './rad.routes.js';
import { RadStudy } from './models/rad.models.js';
import { fromOpdVisit, opdVisitClosed } from './services/rad.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages
import './patient-sections.js'; // this module's sections of the patient record

/**
 * Radiology (RIS, spec section "Radiology workflows"): orders from consultations, rounds and the
 * desk, slot booking per room with the preparation SMS, contrast consent and creatinine, PCPNDT
 * Form F for obstetric ultrasound, template reports with radiologist sign-off (maker-checker),
 * addenda and the PACS viewer link.
 */

const hospitalName = async () =>
  (await Tenant.findById(current().tenantId).select('name').lean())?.name ?? 'the hospital';
const fmt = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export async function sendScheduledSms({ mobile, study, at, prep, room }) {
  if (!mobile) return;
  await sendSms({
    to: mobile,
    template: 'RAD_SCHEDULED',
    vars: {
      hospital: await hospitalName(),
      study,
      time: fmt(at),
      room,
      prep: prep ?? 'No preparation needed.',
    },
  });
}

export async function sendRadReportSms({ mobile, study, accessionNo }) {
  if (!mobile) return;
  await sendSms({
    to: mobile,
    template: 'RAD_REPORT_READY',
    vars: { hospital: await hospitalName(), study, accessionNo },
  });
}

registerPatientTimelineSource(async (patientId) => {
  const rows = await RadStudy.find({ 'patient.id': patientId, status: 'SIGNED' })
    .select('accessionNo name signedAt')
    .lean();
  return rows.map((r) => ({
    at: r.signedAt,
    type: 'IMAGING',
    title: `Imaging ${r.name} · ${r.accessionNo}`,
    ref: String(r._id),
  }));
});
registerPatientMergeHandler(async (fromId, toId) => {
  await RadStudy.updateMany({ 'patient.id': fromId }, { $set: { 'patient.id': toId } });
});

const router = Router();
router.use(radRoutes);

export const radiologyModule = {
  name: 'radiology',
  router,
  subscriptions: () => {
    subscribe('opd.visit.completed', 'rad.orders-from-opd', fromOpdVisit);
    subscribe('opd.visit.closed', 'rad.opd-bill-paid', opdVisitClosed);
    subscribe('rad.study.scheduled', 'rad.prep-sms', sendScheduledSms);
    subscribe('rad.report.signed', 'rad.report-sms', sendRadReportSms);
  },
};
export { RadStudy } from './models/rad.models.js';
