import { registerPatientSummary } from '../patients/index.js';
import { Membership } from './models/crm.models.js';

/** The family card the patient is on: plan name and wallet credit. */
registerPatientSummary('CRM', async (patientId) => {
  const m = await Membership.findOne({ 'members.id': patientId, status: 'ACTIVE' })
    .select('planName cardNo wallet')
    .lean();
  return m ? { membership: m.planName ?? m.cardNo, wallet: m.wallet ?? 0 } : {};
});
