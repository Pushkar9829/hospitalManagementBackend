import { registerPatientSection } from '../patients/index.js';
import { RadStudy } from './models/rad.models.js';

/** Imaging studies on the patient record's Reports section (signed reports carry their date). */
registerPatientSection('reports', 'RAD', async (patientId) =>
  (
    await RadStudy.find({ 'patient.id': patientId, status: { $ne: 'CANCELLED' } })
      .sort({ orderedAt: -1 })
      .limit(200)
      .lean()
  ).map((s) => ({
    id: String(s._id),
    date: s.signedAt ?? s.scheduledAt ?? s.orderedAt,
    name: s.name,
    kind: 'RAD',
    modality: s.modality ?? null,
    status: s.status === 'SIGNED' ? 'RELEASED' : s.status,
    flag: s.status === 'SIGNED' ? (s.critical ? 'CRITICAL' : null) : null,
    flagText: s.status === 'SIGNED' ? (s.report?.impression ?? null) : null,
  })),
);
