import { registerPatientSection } from '../patients/index.js';
import { LabItem } from './models/lab.models.js';

/**
 * Lab tests on the patient record's Reports section. Results show only once released (rule R9);
 * a sensitive test (HIV, for example) shows its name and status, never the result line.
 */
const FLAG = { N: 'NORMAL', L: 'LOW', H: 'HIGH', LL: 'CRITICAL', HH: 'CRITICAL', A: 'ABNORMAL' };
const RANK = { NORMAL: 0, LOW: 1, HIGH: 1, ABNORMAL: 1, CRITICAL: 2 };

function worst(results = []) {
  let pick = null;
  for (const r of results) {
    const f = FLAG[r.flag];
    if (f && (!pick || RANK[f] > RANK[pick.flag])) pick = { flag: f, r };
  }
  return pick;
}

registerPatientSection('reports', 'LAB', async (patientId) =>
  (
    await LabItem.find({ 'patient.id': patientId, status: { $ne: 'CANCELLED' } })
      .sort({ orderedAt: -1 })
      .limit(200)
      .lean()
  ).map((i) => {
    const released = i.status === 'RELEASED';
    const w = released && !i.sensitive ? worst(i.results) : null;
    return {
      id: String(i._id),
      date: i.releasedAt ?? i.orderedAt,
      name: i.name,
      kind: 'LAB',
      orderNo: i.orderNo,
      status: i.status,
      flag: w?.flag ?? null,
      flagText:
        w && w.flag !== 'NORMAL' ? [w.r.name, w.r.value, w.r.unit].filter(Boolean).join(' ') : null,
    };
  }),
);
