/**
 * Lab demo data for the development hospital (called by seed-dev.js; safe to run again): test
 * definitions for the lab services, QC controls with two weeks of runs, a pathologist login and
 * lab orders at each stage for the IPD demo patients. Needs the OPD and IPD demos first.
 */
import { runAsSystem } from '../src/core/tenancy/context.js';
import { User } from '../src/core/auth/models/user.model.js';
import { Role } from '../src/core/auth/models/role.model.js';
import { hashPassword } from '../src/core/auth/password.js';
import { Service } from '../src/modules/setup/index.js';
import { Patient } from '../src/modules/patients/index.js';
import { Admission } from '../src/modules/ipd/models/ipd.models.js';
import { DEFAULT_CONTROLS } from '../src/modules/lab/data/tests.js';
import { LabItem, QcControl, QcRun } from '../src/modules/lab/models/lab.models.js';
import { ensureTests } from '../src/modules/lab/services/catalog.service.js';
import { collect, createOrder, receive } from '../src/modules/lab/services/order.service.js';
import { enterResults, verify } from '../src/modules/lab/services/result.service.js';
import { recordRun } from '../src/modules/lab/services/qc.service.js';

// Small, repeatable QC scatter inside ±1.5 SD.
const SCATTER = [0.3, -0.6, 1.1, -0.2, 0.8, -1.2, 0.1, 0.5, -0.9, 1.4, -0.4, 0.2, -0.7, 0.6];

export async function seedLabDemo({ tenant, branch, password }) {
  return runAsSystem(
    tenant._id,
    async () => {
      if (await QcControl.exists({})) return false;
      await ensureTests();

      // QC: two weeks of runs, the last one today, so the analysers are in control (R4).
      for (const [analyser, analyte, name, level, mean, sd, unit] of DEFAULT_CONTROLS) {
        const [c] = await QcControl.create([
          { analyser, analyte, name, level, lot: `LOT-${level}-2610`, mean, sd, unit },
        ]);
        await QcRun.insertMany(
          SCATTER.slice(0, 13).map((z, k) => ({
            tenantId: tenant._id,
            controlId: c._id,
            analyser,
            analyte,
            level,
            value: Math.round((mean + z * sd) * 100) / 100,
            z,
            rules: [],
            status: 'IN_CONTROL',
            at: new Date(Date.now() - (14 - k) * 86_400_000),
            by: 'Demo Lab Technician',
          })),
        );
        await recordRun({ controlId: c._id, value: mean + SCATTER[13] * sd });
      }

      // A second lab login: the pathologist validates what the technician entered (R9).
      const lab = await Role.findOne({ code: 'lab' }).lean();
      if (lab && !(await User.exists({ username: 'pathologist' })))
        await User.create({
          name: 'Dr. Kavita Rao (Pathologist)',
          username: 'pathologist',
          mobile: '9876509901',
          passwordHash: await hashPassword(password),
          roles: [lab._id],
          branchIds: [branch._id],
          defaultBranchId: branch._id,
        });

      const svc = async (code) => (await Service.findOne({ code }).select('_id').lean())?._id;
      const stays = await Admission.find({ status: { $ne: 'DISCHARGED' } }).lean();
      const stay = (name) => stays.find((a) => a.patient.name.startsWith(name));

      // ICU: STAT troponin and KFT, collected, received and resulted (a critical value to call).
      const harish = stay('Harish');
      if (harish) {
        const o = await createOrder({
          admissionId: harish._id,
          tests: [await svc('TROP'), await svc('KFT')],
          priority: 'STAT',
          clinicalNotes: 'Chest pain, ECG ST depression',
        });
        const { labels } = await collect({ itemIds: o.items.map((i) => i.id), scan: harish.ipNo });
        for (const l of labels) await receive(l.sampleNo);
        const items = await LabItem.find({ orderNo: o.orderNo }).lean();
        for (const i of items) {
          if (i.code === 'TROP')
            await enterResults(i._id, { results: [{ code: 'TNI', value: '0.92' }] });
          if (i.code === 'KFT') {
            await enterResults(i._id, {
              results: [
                { code: 'UREA', value: '38' },
                { code: 'CREAT', value: '1.1' },
                { code: 'NA', value: '138' },
                { code: 'K', value: '4.2' },
                { code: 'CL', value: '101' },
              ],
            });
            await verify(i._id);
          }
        }
      }
      // General ward: CBC collected on the round, waiting at reception.
      const suresh = stay('Suresh');
      if (suresh) {
        const o = await createOrder({ admissionId: suresh._id, tests: [await svc('CBC')] });
        await collect({ itemIds: o.items.map((i) => i.id), scan: suresh.ipNo });
      }
      // Semi-private: pre-operative tests to collect.
      const neeta = stay('Neeta');
      if (neeta)
        await createOrder({
          admissionId: neeta._id,
          tests: [await svc('CBC'), await svc('BGRP'), await svc('LFT')],
          clinicalNotes: 'Pre-operative, knee replacement',
        });
      // A walk-in waiting to pay at the counter.
      const walkIn = await Patient.findOne({ _id: { $nin: stays.map((a) => a.patient.id) } })
        .sort({ createdAt: 1 })
        .lean();
      if (walkIn)
        await createOrder({
          patientId: walkIn._id,
          tests: [await svc('LIPID'), await svc('HBA1C')],
        });
      return true;
    },
    { userName: 'Demo Lab Technician', branchId: String(branch._id) },
  );
}

/** Microbiology and histopathology demo (separate so it can be added to an existing demo). */
export async function seedMicroDemo({ tenant, branch }) {
  const { Culture } = await import('../src/modules/lab/models/micro.models.js');
  const { PriceList, TaxCode } = await import('../src/modules/setup/index.js');
  return runAsSystem(
    tenant._id,
    async () => {
      if (await Culture.exists({})) return false;
      const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
      const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
      for (const [code, name, rupees] of [
        ['UCS', 'Urine culture and sensitivity', 800],
        ['BCS', 'Blood culture and sensitivity', 1200],
        ['HPE', 'Histopathology, small biopsy', 1500],
      ])
        if (!(await Service.exists({ code })))
          await Service.create([
            {
              code,
              name,
              category: 'LAB',
              taxCodeId: exempt._id,
              status: 'ACTIVE',
              isActive: true,
              rates: [{ priceListId: general._id, amount: rupees * 100 }],
            },
          ]);
      await ensureTests();
      const svc = async (code) => (await Service.findOne({ code }).select('_id').lean())?._id;
      const stays = await Admission.find({ status: { $ne: 'DISCHARGED' } }).lean();
      const run = async (stay, code, notes) => {
        const o = await createOrder({
          admissionId: stay._id,
          tests: [await svc(code)],
          clinicalNotes: notes,
        });
        const { labels } = await collect({ itemIds: o.items.map((i) => i.id), scan: stay.ipNo });
        for (const l of labels) await receive(l.sampleNo);
      };
      const suresh = stays.find((a) => a.patient.name.startsWith('Suresh'));
      const neeta = stays.find((a) => a.patient.name.startsWith('Neeta'));
      if (suresh) await run(suresh, 'UCS', 'Fever with dysuria, on catheter');
      if (neeta) await run(neeta, 'HPE', 'Synovial tissue, right knee');
      return true;
    },
    { userName: 'Demo Lab Technician', branchId: String(branch._id) },
  );
}
