import mongoose from 'mongoose';
import { registerPatientSummary } from '../patients/index.js';
import { Bill } from './models/billing.models.js';

/** Amount the patient still owes on final bills (credit bills owed by a payer are not theirs). */
registerPatientSummary('CORE', async (patientId) => {
  const [r] = await Bill.aggregate([
    {
      $match: {
        'patient.id': new mongoose.Types.ObjectId(String(patientId)),
        status: { $in: ['FINAL', 'PARTLY_PAID'] },
        'payer.payerId': { $exists: false },
      },
    },
    { $group: { _id: null, due: { $sum: '$totals.balance' } } },
  ]);
  return { outstanding: r?.due ?? 0 };
});
