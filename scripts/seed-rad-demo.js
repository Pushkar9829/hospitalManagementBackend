/**
 * Radiology demo data (called by seed-dev.js; safe to run again): the CT service, a second
 * radiologist login (sign-off is maker-checker) and studies at each stage for the IPD demo
 * patients and a walk-in. Needs the OPD and IPD demos first.
 */
import { runAsSystem } from '../src/core/tenancy/context.js';
import { User } from '../src/core/auth/models/user.model.js';
import { Role } from '../src/core/auth/models/role.model.js';
import { hashPassword } from '../src/core/auth/password.js';
import { PriceList, Service, TaxCode } from '../src/modules/setup/index.js';
import { Patient } from '../src/modules/patients/index.js';
import { Admission } from '../src/modules/ipd/models/ipd.models.js';
import { RadStudy } from '../src/modules/radiology/models/rad.models.js';
import {
  arrive,
  createOrder,
  ensureDefs,
  perform,
  saveReport,
  schedule,
  slots,
} from '../src/modules/radiology/services/rad.service.js';

export async function seedRadDemo({ tenant, branch, password }) {
  return runAsSystem(
    tenant._id,
    async () => {
      if (await RadStudy.exists({})) return false;
      const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
      const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
      if (!(await Service.exists({ code: 'CTHC' })))
        await Service.create([
          {
            code: 'CTHC',
            name: 'CT head with contrast',
            category: 'RAD',
            taxCodeId: exempt._id,
            status: 'ACTIVE',
            isActive: true,
            rates: [{ priceListId: general._id, amount: 4000_00 }],
          },
        ]);
      await ensureDefs();

      const role = await Role.findOne({ code: 'radiology' }).lean();
      if (role && !(await User.exists({ username: 'radiologist2' })))
        await User.create({
          name: 'Dr. Sameer Khan (Radiologist)',
          username: 'radiologist2',
          mobile: '9876509902',
          passwordHash: await hashPassword(password),
          roles: [role._id],
          branchIds: [branch._id],
          defaultBranchId: branch._id,
        });

      const svc = async (code) => (await Service.findOne({ code }).select('_id').lean())?._id;
      const stays = await Admission.find({ status: { $ne: 'DISCHARGED' } }).lean();
      const stay = (name) => stays.find((a) => a.patient.name.startsWith(name));

      // ICU: STAT chest X-ray, done and reported, waiting for sign-off.
      const harish = stay('Harish');
      if (harish) {
        const [s] = (
          await createOrder({
            admissionId: harish._id,
            studies: [await svc('CXR')],
            priority: 'STAT',
          })
        ).items;
        await arrive(s.id);
        await perform(s.id, { techNotes: 'Portable AP, supine' });
        await saveReport(s.id, {
          findings: 'Mild cardiomegaly. Upper lobe venous diversion. No consolidation or effusion.',
          impression: 'Features of early pulmonary venous congestion.',
          critical: false,
        });
      }
      // Ward: knee MRI performed, waiting for the report.
      const neeta = stay('Neeta');
      if (neeta) {
        const [s] = (await createOrder({ admissionId: neeta._id, studies: [await svc('MRIK')] }))
          .items;
        await arrive(s.id);
        await perform(s.id, { techNotes: 'Standard knee protocol' });
      }
      // General ward: ultrasound abdomen booked for tomorrow.
      const suresh = stay('Suresh');
      if (suresh) {
        const [s] = (await createOrder({ admissionId: suresh._id, studies: [await svc('USGA')] }))
          .items;
        const tomorrow = new Date(Date.now() + 86_400_000 + 330 * 60_000)
          .toISOString()
          .slice(0, 10);
        const free = await slots({ modality: 'USG', date: tomorrow });
        const room = free.rooms[0];
        if (room?.free[2]) await schedule(s.id, { room: room.code, at: room.free[2] });
      }
      // A walk-in waiting to pay for an echo.
      const walkIn = await Patient.findOne({ _id: { $nin: stays.map((a) => a.patient.id) } })
        .sort({ createdAt: 1 })
        .lean();
      if (walkIn) await createOrder({ patientId: walkIn._id, studies: [await svc('ECHO')] });
      return true;
    },
    { userName: 'Demo Radiology Technician', branchId: String(branch._id) },
  );
}
