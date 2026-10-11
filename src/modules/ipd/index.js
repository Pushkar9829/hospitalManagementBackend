import { Router } from 'express';
import { subscribe } from '../../core/events/events.js';
import { registerPatientMergeHandler, registerPatientTimelineSource } from '../patients/index.js';
import { registerLocator, revokeForPatient } from '../frontoffice/index.js';
import { ipdRoutes } from './ipd.routes.js';
import { nursingRoutes, roundsRoutes } from './clinical.routes.js';
import { insuranceRoutes, ipdReportRoutes } from './insurance.routes.js';
import { Admission, AdmissionRequest } from './models/ipd.models.js';
import { requestFromOpd } from './services/admission.service.js';
import { settingsDoc } from './services/common.js';

/**
 * IPD (docs/modules/IPD.md): admission requests (from OPD or direct), estimates, bed board and
 * reservations, admission with the deposit and room-rent rules, transfers, the midnight census
 * that posts room days to the running IP bill, deposit alerts, discharge summary, final bill and
 * discharge outcomes (normal, LAMA, death, absconded, referred), bed cleaning.
 */
registerPatientTimelineSource(async (patientId) => {
  const stays = await Admission.find({ 'patient.id': patientId })
    .select('ipNo admittedAt leftAt bed outcome status')
    .lean();
  return stays.map((a) => ({
    at: a.admittedAt,
    type: 'ADMISSION',
    title: `Admission ${a.ipNo} · ${a.bed?.ward ?? ''} ${a.bed?.code ?? ''} · ${a.status}${a.outcome ? ` (${a.outcome})` : ''}`,
    ref: String(a._id),
  }));
});
registerPatientMergeHandler(async (fromId, toId) => {
  for (const Model of [Admission, AdmissionRequest])
    await Model.updateMany({ 'patient.id': fromId }, { $set: { 'patient.id': toId } });
});

/** The front-office locator shows admitted patients' ward and bed (no clinical details). */
registerLocator(async (patientIds) => {
  const s = await settingsDoc();
  const stays = await Admission.find({
    'patient.id': { $in: patientIds },
    status: { $in: ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'] },
  })
    .select('patient bed')
    .lean();
  return stays.map((a) => [
    a.patient.id,
    { area: 'IPD', place: a.bed.ward, bed: a.bed.code, visiting: s.visitingHours },
  ]);
});

const router = Router();
router.use(ipdRoutes, roundsRoutes, nursingRoutes, insuranceRoutes, ipdReportRoutes);

export const ipdModule = {
  name: 'ipd',
  router,
  subscriptions: () => {
    subscribe('opd.admission.requested', 'ipd.request-from-opd', requestFromOpd);
    subscribe('ipd.discharged', 'ipd.revoke-passes', ({ patientId }) =>
      revokeForPatient(patientId),
    );
  },
};
export { Admission, CleaningTask } from './models/ipd.models.js';
export { IpdNote, MarDose, MedOrder } from './models/clinical.models.js';
export { registerFinalBillCheck } from './services/admission.service.js';
export {
  addCharge,
  midnightCensus,
  registerBillLineSource,
  syncStayBill,
} from './services/charges.service.js';
import './reports.js'; // registers this module's reports in the reports centre
import './home.js'; // registers this module's widgets on the role home pages
export { overdueReplies, sweepOverdueReplies } from './services/insurance.service.js';
export { expireReservations, sweepReservations } from './services/beds.service.js';
