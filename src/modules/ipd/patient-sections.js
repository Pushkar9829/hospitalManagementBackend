import { registerPatientSection, registerPatientSummary } from '../patients/index.js';
import { Admission } from './models/ipd.models.js';

/** The patient record's IPD section and the current stay on the summary card. */
const IN_HOUSE = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];

registerPatientSection('admissions', 'IPD', async (patientId) =>
  (
    await Admission.find({ 'patient.id': patientId }).sort({ admittedAt: -1 }).limit(100).lean()
  ).map((a) => ({
    id: String(a._id),
    ipNo: a.ipNo,
    date: a.admittedAt,
    admittedAt: a.admittedAt,
    dischargedAt: a.leftAt ?? null,
    bed: a.bed?.code ?? null,
    ward: a.bed?.ward ?? null,
    consultant: a.consultant?.name ?? null,
    status: a.status,
    outcome: a.outcome ?? null,
  })),
);

registerPatientSummary('IPD', async (patientId) => {
  const [stays, now] = await Promise.all([
    Admission.countDocuments({ 'patient.id': patientId }),
    Admission.findOne({ 'patient.id': patientId, status: { $in: IN_HOUSE } })
      .select('ipNo bed')
      .lean(),
  ]);
  return {
    ipdStays: stays,
    admission: now ? { id: String(now._id), ipNo: now.ipNo, bed: now.bed?.code ?? null } : null,
  };
});
