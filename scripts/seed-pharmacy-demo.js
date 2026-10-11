/**
 * Inventory and pharmacy demo (called by seed-dev.js; safe to run again): the OPD formulary as
 * items with GST and schedules, a main store, the pharmacy and a ward store, a vendor, stock
 * received into the main store and moved to the pharmacy, a PO waiting for approval, and
 * prescriptions in the pharmacy queue from OPD and the wards. Needs the OPD and IPD demos.
 */
import { current, runAsSystem, runInContext } from '../src/core/tenancy/context.js';
import { User } from '../src/core/auth/models/user.model.js';
import { DRUG_ROWS } from '../src/modules/opd/data/clinical.js';
import { Patient } from '../src/modules/patients/index.js';
import { Admission } from '../src/modules/ipd/models/ipd.models.js';
import { Doctor } from '../src/modules/setup/index.js';
import {
  Item,
  PurchaseOrder,
  Store,
  Vendor,
} from '../src/modules/inventory/models/inventory.models.js';
import {
  createGrn,
  createPo,
  directTransfer,
} from '../src/modules/inventory/services/inventory.service.js';
import { fromOpdVisit, fromWardOrder } from '../src/modules/pharmacy/services/pharmacy.service.js';
import { Prescription } from '../src/modules/pharmacy/models/pharmacy.models.js';

const STRENGTH = {
  ecosprin75: 75,
  clopilet75: 75,
  amlodipine10: 10,
  amlodipine5: 5,
  telma40: 40,
  atorva40: 40,
  rosuvas10: 10,
  sorbitrate5: 5,
  metoprolol25: 25,
  glycomet500: 500,
  dolo650: 650,
  crocin500: 500,
  etoshine90: 90,
  folvite5: 5,
  clarith500: 500,
};
const ym = (n) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

export async function seedPharmacyDemo({ tenant, branch }) {
  return runAsSystem(
    tenant._id,
    async () => {
      const fresh = !(await Store.exists({}));
      if (fresh) {
        const items = [];
        for (const [code, name, generic, form] of DRUG_ROWS)
          items.push({
            code,
            name,
            kind: 'DRUG',
            unit: form === 'Syrup' ? 'ml' : form === 'Tablet' ? 'tablet' : 'unit',
            packSize: form === 'Tablet' ? 10 : 1,
            hsn: '3004',
            gstRate: 5,
            reorderLevel: form === 'Tablet' ? 100 : 5,
            drug: {
              generic,
              form,
              strengthMg: code === 'calpol' ? 50 : STRENGTH[code],
              schedule: ['dolo650', 'crocin500', 'calpol'].includes(code) ? 'OTC' : 'H',
              maxMgPerKgDay: code === 'calpol' ? 60 : undefined,
            },
          });
        items.push(
          {
            code: 'tramadol50',
            name: 'Tramadol 50 mg cap',
            kind: 'DRUG',
            unit: 'capsule',
            packSize: 10,
            hsn: '3004',
            gstRate: 5,
            reorderLevel: 20,
            drug: { generic: 'Tramadol', form: 'Capsule', strengthMg: 50, schedule: 'H1' },
          },
          {
            code: 'ns500',
            name: 'Normal saline 500 ml',
            kind: 'CONSUMABLE',
            unit: 'bottle',
            hsn: '3004',
            gstRate: 5,
            reorderLevel: 50,
          },
          {
            code: 'syringe5',
            name: 'Syringe 5 ml',
            kind: 'CONSUMABLE',
            unit: 'piece',
            hsn: '9018',
            gstRate: 5,
            reorderLevel: 200,
          },
          {
            code: 'gloves',
            name: 'Examination gloves (pair)',
            kind: 'CONSUMABLE',
            unit: 'pair',
            hsn: '4015',
            gstRate: 5,
            reorderLevel: 200,
          },
        );
        const made = await Item.create(items, { ordered: true });
        const [main, ph] = await Store.create(
          [
            { code: 'MAIN', name: 'Main store', kind: 'MAIN' },
            { code: 'PH', name: 'Pharmacy', kind: 'PHARMACY' },
            { code: 'GW', name: 'General ward store', kind: 'WARD' },
          ],
          { ordered: true },
        );
        const [vendor] = await Vendor.create([
          {
            code: 'MEDI',
            name: 'Medi Distributors',
            gstin: '27AAACM1234F1Z5',
            phone: '9822000111',
            drugLicence: 'MH-20B-1234',
          },
        ]);
        // Stock received into the main store: two batches for the common ones (FEFO shows).
        const lines = [];
        made.forEach((it, i) => {
          const rate = it.kind === 'DRUG' ? 150 + i * 40 : 900;
          const mrp = Math.round(rate * 1.45);
          lines.push({
            itemId: String(it._id),
            batchNo: `B${i}A`,
            expiry: ym(3 + (i % 3)),
            qty: 200,
            freeQty: 0,
            rate,
            mrp,
          });
          if (i % 2 === 0)
            lines.push({
              itemId: String(it._id),
              batchNo: `B${i}B`,
              expiry: ym(18),
              qty: 300,
              freeQty: 0,
              rate,
              mrp: mrp + 10,
            });
        });
        await createGrn({
          vendorId: String(vendor._id),
          storeId: String(main._id),
          invoiceNo: 'MD/2610/118',
          invoiceDate: new Date().toISOString().slice(0, 10),
          lines,
        });
        await directTransfer({
          fromStoreId: String(main._id),
          toStoreId: String(ph._id),
          lines: made.map((it) => ({ itemId: String(it._id), qty: it.kind === 'DRUG' ? 150 : 50 })),
        });
      }

      // A purchase order waiting for the admin's approval, raised by the store keeper.
      const keeper = await User.findOne({ username: 'store' }).select('_id').lean();
      if (keeper && !(await PurchaseOrder.exists({})))
        await runInContext(
          { ...current(), userId: String(keeper._id), system: false },
          async () => {
            const main = await Store.findOne({ code: 'MAIN' }).lean();
            const vendor = await Vendor.findOne({ code: 'MEDI' }).lean();
            const first = await Item.find({ kind: 'DRUG' }).sort({ createdAt: 1 }).limit(4).lean();
            await createPo({
              vendorId: String(vendor._id),
              storeId: String(main._id),
              lines: first.map((it) => ({ itemId: String(it._id), qty: 500, rate: 160 })),
              notes: 'Monthly replenishment',
            });
          },
        );

      // The pharmacy queue: an OPD prescription and two ward orders.
      if (await Prescription.exists({})) return fresh;
      const doctor = await Doctor.findOne({ isActive: true }).lean();
      const stays = await Admission.find({ status: { $ne: 'DISCHARGED' } }).lean();
      const walkIn = await Patient.findOne({ _id: { $nin: stays.map((a) => a.patient.id) } })
        .sort({ createdAt: 1 })
        .lean();
      if (walkIn)
        await fromOpdVisit({
          visitId: '6a0000000000000000000a01',
          patientId: walkIn._id,
          doctorId: doctor?._id,
          rx: [
            {
              drugId: 'dolo650',
              brand: 'Dolo 650 mg tab',
              generic: 'Paracetamol',
              dose: '1 tab',
              frequency: 'TDS',
              days: 3,
            },
            {
              drugId: 'clarith500',
              brand: 'Claribid 500 mg tab',
              generic: 'Clarithromycin',
              dose: '1 tab',
              frequency: 'BD',
              days: 5,
            },
          ],
        });
      const harish = stays.find((a) => a.patient.name.startsWith('Harish'));
      if (harish) {
        await fromWardOrder({
          admissionId: harish._id,
          stat: true,
          line: {
            orderId: 'demo-stat-1',
            drugId: 'ecosprin75',
            brand: 'Ecosprin 75 mg tab',
            generic: 'Aspirin',
            dose: '4 tab',
            frequency: 'STAT',
            days: 1,
          },
        });
        await fromWardOrder({
          admissionId: harish._id,
          line: {
            orderId: 'demo-ward-1',
            drugId: 'atorva40',
            brand: 'Atorvastatin 40 mg tab',
            generic: 'Atorvastatin',
            dose: '1 tab',
            frequency: 'HS',
            days: 5,
          },
        });
      }
      return true;
    },
    { userName: 'Demo Store Keeper', branchId: String(branch._id) },
  );
}
