/**
 * IPD demo data for the development hospital (called by seed-dev.js; safe to run again): wards
 * with bed-day tariffs, beds, payers, three admitted patients and one waiting request. Needs
 * the OPD demo (doctors and patients) first.
 */
import { runAsSystem } from '../src/core/tenancy/context.js';
import {
  Bed,
  Doctor,
  Payer,
  PriceList,
  Service,
  TaxCode,
  Ward,
} from '../src/modules/setup/index.js';
import { Patient } from '../src/modules/patients/index.js';
import { admit, createRequest } from '../src/modules/ipd/services/admission.service.js';
import { Admission } from '../src/modules/ipd/models/ipd.models.js';

/** [code, name, category, gender, floor, bed-day rupees, beds] */
const WARDS = [
  ['GW', 'General Ward', 'GENERAL', 'ANY', '1', 1200, 10],
  ['W2', 'Ward 2 · Semi-private', 'SEMI_PRIVATE', 'ANY', '2', 2800, 8],
  ['PVT', 'Private', 'PRIVATE', 'ANY', '4', 4500, 4],
  ['ICU', 'ICU', 'ICU', 'ANY', '3', 12000, 6],
  ['ISO', 'Isolation', 'ISOLATION', 'ANY', '1', 3000, 2],
  ['MW', 'Male Ward', 'GENERAL', 'MALE', '1', 1200, 6],
];
const PAYERS = [
  ['STAR', 'Star Health', 'INSURER'],
  ['MEDI', 'Medi Assist TPA', 'TPA'],
  ['TATA', 'Tata Motors', 'CORPORATE'],
  ['PMJAY', 'PM-JAY', 'GOVT_SCHEME'],
];

export async function seedIpdDemo({ tenant, branch }) {
  return runAsSystem(
    tenant._id,
    async () => {
      if (await Ward.exists({ code: 'GW' })) return false;
      const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
      const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
      for (const [code, name, category, gender, floor, rupees, n] of WARDS) {
        const svc =
          (await Service.findOne({ code: `BED${code}` }).lean()) ??
          (
            await Service.create([
              {
                code: `BED${code}`,
                name: `${name} bed day`,
                category: 'BED',
                taxCodeId: exempt._id,
                status: 'ACTIVE',
                isActive: true,
                rates: [{ priceListId: general._id, amount: rupees * 100 }],
              },
            ])
          )[0];
        const [w] = await Ward.create([
          { code, name, branchId: branch._id, category, gender, floor, bedServiceId: svc._id },
        ]);
        await Bed.create(
          Array.from({ length: n }, (_, i) => {
            const c = `${code}-${String(i + 1).padStart(2, '0')}`;
            return {
              code: c,
              name: c,
              wardId: w._id,
              branchId: branch._id,
              room: `${floor}${String(i + 1).padStart(2, '0')}`,
            };
          }),
        );
      }
      for (const [code, name, kind] of PAYERS)
        if (!(await Payer.exists({ code }))) await Payer.create([{ code, name, kind }]);

      const doctors = Object.fromEntries((await Doctor.find({}).lean()).map((d) => [d.code, d]));
      const patient = async (first) => Patient.findOne({ 'name.first': first }).lean();
      const bed = async (code) => Bed.findOne({ code }).lean();
      const stays = [
        ['Harish', 'DMI', 'ICU-02', 'Acute coronary syndrome, NSTEMI', true],
        ['Suresh', 'DRM', 'GW-03', 'Community-acquired pneumonia', true],
        ['Neeta', 'DPJ', 'W2-04', 'Total knee replacement, right', false],
      ];
      for (const [first, doc, bedCode, reason, emergency] of stays) {
        const p = await patient(first);
        const b = await bed(bedCode);
        if (
          !p ||
          !b ||
          !doctors[doc] ||
          (await Admission.exists({ 'patient.id': p._id, status: { $ne: 'DISCHARGED' } }))
        )
          continue;
        await admit({
          patientId: String(p._id),
          doctorId: String(doctors[doc]._id),
          reason,
          bedId: String(b._id),
          emergency,
          expectedDays: 4,
          payer: emergency
            ? { kind: 'CASH' }
            : {
                kind: 'CORPORATE',
                payerId: String((await Payer.findOne({ code: 'TATA' }).lean())._id),
              },
        });
      }
      const sunil = await patient('Sunil');
      if (sunil && doctors.DRM)
        await createRequest({
          patientId: String(sunil._id),
          doctorId: String(doctors.DRM._id),
          reason: 'Dengue with low platelets',
          wardCategory: 'GENERAL',
          urgency: 'TODAY',
          expectedDays: 3,
        });
      return true;
    },
    { branchId: String(branch._id) },
  );
}
