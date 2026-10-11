import { errors } from '../../../core/errors/index.js';
import { HealthCheckup, OpdResource, TreatmentPlan } from '../models/opd.models.js';
import { loadPatient, patientOut, patientSnap, ymdIST } from './common.js';

/** Health check-ups, treatment plans and bookable resources (the other appointment tabs). */

const checkupOut = (c) => ({
  id: String(c._id),
  patient: patientOut(c.patient),
  package: c.package,
  company: c.company ?? null,
  stationsDone: c.stationsDone,
  stations: c.stations,
  nextStation: c.nextStation ?? null,
  report: c.report,
});

const paged = async (Model, map, { page = 1, limit = 25 } = {}, filter = {}) => {
  const [items, total] = await Promise.all([
    Model.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Model.countDocuments(filter),
  ]);
  return { items: items.map(map), total, page, limit };
};

export const listCheckups = (q) =>
  paged(HealthCheckup, checkupOut, q, { date: q.date ?? ymdIST() });

export async function bookCheckup({ patientId, package: pkg, company, stations = 8 }) {
  const p = await loadPatient(patientId);
  const [c] = await HealthCheckup.create([
    {
      date: ymdIST(),
      patient: patientSnap(p),
      package: pkg,
      company,
      stations,
      nextStation: 'Registration',
    },
  ]);
  return checkupOut(c);
}

/** Corporate check-up import: CSV with a header row and UHID,package per line. */
export async function importCheckups({ company, csv }) {
  const rows = String(csv ?? '')
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(1);
  const errorsOut = [];
  let booked = 0;
  const { Patient } = await import('../../patients/index.js');
  for (const [i, row] of rows.entries()) {
    const [uhid, pkg] = row.split(',').map((x) => x?.trim());
    const p = uhid && (await Patient.findOne({ uhid }).lean());
    if (!p) {
      errorsOut.push({ row: i + 2, message: `No patient with UHID ${uhid ?? '(blank)'}` });
      continue;
    }
    await HealthCheckup.create([
      {
        date: ymdIST(),
        patient: patientSnap(p),
        package: pkg || 'Corporate check-up',
        company,
        nextStation: 'Registration',
      },
    ]);
    booked++;
  }
  return { received: rows.length, booked, errors: errorsOut };
}

const planOut = (p) => ({
  id: String(p._id),
  patient: patientOut(p.patient),
  plan: p.plan,
  sessions: p.sessions,
  done: p.done,
  nextSession: p.nextSession ?? null,
  billing: p.billing,
  amount: p.amount ?? null,
});

export const listPlans = (q) => paged(TreatmentPlan, planOut, q);

export async function addPlan({ patientId, plan, sessions, firstSession, billing, amount }) {
  const p = await loadPatient(patientId);
  if (!(sessions > 0))
    throw errors.validation([{ path: 'sessions', message: 'Give the number of sessions' }]);
  const [t] = await TreatmentPlan.create([
    {
      patient: patientSnap(p),
      plan,
      sessions,
      nextSession: firstSession ? new Date(`${firstSession}:00+05:30`) : undefined,
      billing,
      amount: amount ?? undefined,
    },
  ]);
  return planOut(t);
}

const resourceOut = (r) => ({
  id: String(r._id),
  name: r.name,
  type: r.type,
  bookableFor: r.bookableFor,
  booked: r.booked,
  slots: r.slots,
});

export const listResources = (q) => paged(OpdResource, resourceOut, q);

export async function addResource(input) {
  const [r] = await OpdResource.create([input]);
  return resourceOut(r);
}
