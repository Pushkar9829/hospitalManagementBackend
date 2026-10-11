import { Branch } from '../../../core/tenancy/branch.model.js';
import { HospitalSettings } from '../models/settings.model.js';
import { PaymentMode, PriceList, ReferralSource, TaxCode, Unit } from '../models/masters.models.js';

/** Default masters every new hospital starts with (spec 3.4 step 4). Idempotent. */
const DEFAULTS = [
  [
    PriceList,
    [
      { code: 'GENERAL', name: 'General', kind: 'GENERAL', isDefault: true },
      { code: 'STAFF', name: 'Staff', kind: 'STAFF' },
      { code: 'SENIOR', name: 'Senior citizen', kind: 'SENIOR' },
    ],
  ],
  [
    TaxCode,
    [
      // Healthcare services by a clinical establishment are exempt (SAC 9993).
      {
        code: 'EXEMPT',
        name: 'Healthcare services (exempt)',
        kind: 'EXEMPT',
        rate: 0,
        hsnSac: '9993',
      },
      { code: 'GST5', name: 'GST 5%', kind: 'GST', rate: 5 },
      { code: 'GST18', name: 'GST 18%', kind: 'GST', rate: 18 },
    ],
  ],
  [
    PaymentMode,
    [
      { code: 'CASH', name: 'Cash', kind: 'CASH' },
      { code: 'CARD', name: 'Card', kind: 'CARD', requiresReference: true },
      { code: 'UPI', name: 'UPI', kind: 'UPI', requiresReference: true },
      { code: 'CHEQUE', name: 'Cheque', kind: 'CHEQUE', requiresReference: true },
      { code: 'BANK', name: 'Bank transfer', kind: 'BANK_TRANSFER', requiresReference: true },
      { code: 'PAYLINK', name: 'Payment link', kind: 'PAYMENT_LINK', requiresReference: true },
      { code: 'ADVANCE', name: 'Advance adjustment', kind: 'ADVANCE' },
    ],
  ],
  [
    Unit,
    [
      { code: 'NOS', name: 'Numbers' },
      { code: 'TAB', name: 'Tablet' },
      { code: 'CAP', name: 'Capsule' },
      { code: 'STRIP', name: 'Strip of 10', baseUnit: 'TAB', factor: 10 },
      { code: 'ML', name: 'Millilitre' },
      { code: 'BOTTLE', name: 'Bottle' },
    ],
  ],
  [
    ReferralSource,
    [
      { code: 'WALKIN', name: 'Walk-in', kind: 'WALK_IN' },
      { code: 'WEBSITE', name: 'Website', kind: 'WEBSITE' },
    ],
  ],
];

export async function seedSetup({ tenant }) {
  for (const [Model, rows] of DEFAULTS) {
    for (const row of rows)
      if (!(await Model.exists({ code: row.code }))) await Model.create([row]);
  }
  if (!(await HospitalSettings.exists({ key: 'hospital' })))
    await HospitalSettings.create([{ key: 'hospital', displayName: tenant.name }]);
  // Hospitals created before branches had a status.
  await Branch.updateMany({ status: { $exists: false } }, { $set: { status: 'ACTIVE' } });
}
