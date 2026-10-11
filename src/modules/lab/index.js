import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { sendSms } from '../../core/notify/notify.service.js';
import { current } from '../../core/tenancy/context.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { registerPatientMergeHandler, registerPatientTimelineSource } from '../patients/index.js';
import { labReportRoutes, labRoutes } from './lab.routes.js';
import { microRoutes } from './micro.routes.js';
import { homeVisitRoutes } from './homevisit.routes.js';
import { labRegisterRoutes } from './registers.routes.js';
import { Culture, HistoCase } from './models/micro.models.js';
import { CriticalCall, LabItem, LabSample } from './models/lab.models.js';
import { fromOpdVisit, opdVisitClosed } from './services/order.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages
import './patient-sections.js'; // this module's sections of the patient record

/**
 * Laboratory (docs/modules/LAB.md): orders from consultations, rounds and the lab counter,
 * barcoded collection with the wristband check, receipt and rejection, result entry with range,
 * critical and delta checks, QC with Westgard rules, two-step release, critical-value calls with
 * read-back, amendments as new versions, and the NABL indicators.
 */

const hospitalName = async () =>
  (await Tenant.findById(current().tenantId).select('name').lean())?.name ?? 'the hospital';

/** Report-ready SMS. R13: never for sensitive tests (for example HIV); those go to the doctor. */
export async function sendReportSms({ mobile, sensitive, test, orderNo, version }) {
  if (!mobile || sensitive) return;
  await sendSms({
    to: mobile,
    template: 'LAB_REPORT_READY',
    vars: {
      hospital: await hospitalName(),
      test: version > 1 ? `${test} (amended)` : test,
      orderNo,
    },
  });
}

/** Rejected sample (R3): out-patients get an SMS; the ward sees it on its collection list. */
export async function sendRejectedSms({ mobile, source, tests = [], reason }) {
  if (!mobile || source === 'IPD') return;
  await sendSms({
    to: mobile,
    template: 'LAB_SAMPLE_REJECTED',
    vars: {
      hospital: await hospitalName(),
      tests: tests.join(', '),
      reason: String(reason).toLowerCase().replace(/_/g, ' '),
    },
  });
}

registerPatientTimelineSource(async (patientId) => {
  const items = await LabItem.find({ 'patient.id': patientId, status: 'RELEASED' })
    .select('orderNo name releasedAt reportVersion')
    .lean();
  return items.map((i) => ({
    at: i.releasedAt,
    type: 'LAB_REPORT',
    title: `Lab ${i.name} · ${i.orderNo}${i.reportVersion > 1 ? ` · v${i.reportVersion}` : ''}`,
    ref: i.orderNo,
  }));
});
registerPatientMergeHandler(async (fromId, toId) => {
  for (const Model of [LabItem, LabSample, CriticalCall, Culture, HistoCase])
    await Model.updateMany({ 'patient.id': fromId }, { $set: { 'patient.id': toId } });
});

const router = Router();
router.use(homeVisitRoutes, labRegisterRoutes, labRoutes, microRoutes, labReportRoutes);

export const labModule = {
  name: 'lab',
  router,
  subscriptions: () => {
    subscribe('opd.visit.completed', 'lab.orders-from-opd', fromOpdVisit);
    subscribe('opd.visit.closed', 'lab.opd-bill-paid', opdVisitClosed);
    subscribe('lab.report.released', 'lab.report-sms', sendReportSms);
    subscribe('lab.report.amended', 'lab.amended-sms', sendReportSms);
    subscribe('lab.sample.rejected', 'lab.rejected-sms', sendRejectedSms);
  },
};
export { CriticalCall, LabItem } from './models/lab.models.js';
export { sweepCriticalCalls, escalateCalls } from './services/result.service.js';
export { ensureTests } from './services/catalog.service.js';
