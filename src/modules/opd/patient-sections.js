import { registerPatientSection, registerPatientSummary } from '../patients/index.js';
import { OpdVisit } from './models/opd.models.js';

/** The patient record's OPD sections: visits, current medicines, conditions (patients/sections.js). */
const DAY = 86_400_000;
const ymdIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const visitsOf = (patientId) =>
  OpdVisit.find({ 'patient.id': patientId, status: { $ne: 'CANCELLED' } })
    .sort({ date: -1, createdAt: -1 })
    .limit(200)
    .lean();

const diagnosis = (v) => {
  const d = v.consultation?.diagnoses?.[0];
  return d ? [d.code, d.name].filter(Boolean).join(' ') : null;
};

/** Medicines from signed prescriptions still within their course (30 days when no length given). */
function currentMedicines(visits) {
  const today = ymdIST();
  const seen = new Set();
  const out = [];
  for (const v of visits) {
    if (v.consultation?.status !== 'SIGNED') continue;
    for (const [i, r] of (v.consultation.rx ?? []).entries()) {
      const name = r.brand || r.generic;
      if (!name || seen.has(name.toLowerCase())) continue;
      const ends = new Date(new Date(`${v.date}T00:00:00Z`).getTime() + (r.days ?? 30) * DAY)
        .toISOString()
        .slice(0, 10);
      if (ends < today) continue;
      seen.add(name.toLowerCase());
      out.push({
        id: `${v._id}-${i}`,
        medicine: name,
        dose: [r.dose, r.frequency, r.days ? `${r.days} days` : null].filter(Boolean).join(' · '),
        since: v.date,
        until: ends,
        by: v.doctor?.name ?? null,
      });
    }
  }
  return out;
}

registerPatientSection('visits', 'OPD', async (patientId) =>
  (await visitsOf(patientId)).map((v) => ({
    id: String(v._id),
    visitNo: v.visitNo,
    date: v.checkedInAt ?? `${v.date}T00:00:00+05:30`,
    doctor: v.doctor?.name ?? null,
    department: v.doctor?.department ?? null,
    type: v.visitType ?? null,
    diagnosis: diagnosis(v),
    status: v.status,
  })),
);

registerPatientSection('prescriptions', 'OPD', async (patientId) =>
  currentMedicines(await visitsOf(patientId)),
);

registerPatientSummary('OPD', async (patientId) => {
  const visits = await visitsOf(patientId);
  const conditions = [];
  for (const v of visits)
    for (const d of v.consultation?.status === 'SIGNED' ? (v.consultation.diagnoses ?? []) : [])
      if (!d.provisional && d.name && !conditions.includes(d.name) && conditions.length < 5)
        conditions.push(d.name);
  return {
    opdVisits: visits.length,
    conditions,
    activeMedicines: currentMedicines(visits).length,
  };
});
