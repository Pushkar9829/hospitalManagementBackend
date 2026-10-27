/**
 * PM-JAY demo for every hospital in the database (local demo only):
 *   - turns on the PMJ module (needs IPD) and refreshes the tenant cache,
 *   - creates the "Ayushman Bharat PM-JAY" scheme payer and the desk settings,
 *   - adds a few sample HBP packages.
 * The sample codes and rates are ILLUSTRATIVE: a real hospital imports its own State Health
 * Agency rate list (POST /pmjay/packages/import or the Packages tab). Run sync:roles afterwards.
 *   node --env-file=.env scripts/seed-pmjay-demo.js
 */
import { connectDb, disconnectDb } from '../src/core/db/connection.js';
import { closeRedis } from '../src/core/cache/redis.js';
import { runAsSystem } from '../src/core/tenancy/context.js';
import { Tenant } from '../src/core/tenancy/tenant.model.js';
import { tenantRegistry } from '../src/core/tenancy/tenant.registry.js';
import { importPackages, saveSettings, settingsDoc } from '../src/modules/pmjay/service.js';
import { Payer } from '../src/modules/setup/index.js';

const SAMPLE = [
  [
    'SG039A',
    'Laparoscopic cholecystectomy',
    'General Surgery',
    22_800_00,
    3,
    true,
    ['USG abdomen report'],
    ['Histopathology report'],
  ],
  ['SG070A', 'Hernia repair (open, unilateral)', 'General Surgery', 15_000_00, 2, true, [], []],
  [
    'MG001A',
    'Acute febrile illness (per day, general ward)',
    'General Medicine',
    1_800_00,
    1,
    false,
    [],
    [],
  ],
  [
    'MG064A',
    'Pneumonia (per day, general ward)',
    'General Medicine',
    1_800_00,
    1,
    false,
    ['Chest X-ray report'],
    [],
  ],
  [
    'OR025A',
    'Hemiarthroplasty, hip',
    'Orthopaedics',
    45_000_00,
    5,
    true,
    ['X-ray hip report'],
    ['Implant sticker / invoice'],
  ],
  [
    'OG005A',
    'Caesarean delivery',
    'Obstetrics & Gynaecology',
    12_000_00,
    3,
    true,
    ['USG obstetric report'],
    ['Birth certificate copy'],
  ],
  ['OG001A', 'Normal delivery', 'Obstetrics & Gynaecology', 9_000_00, 2, false, [], []],
  [
    'MC011A',
    'PTCA with one stent',
    'Cardiology',
    1_00_000_00,
    3,
    true,
    ['ECG', 'Echo report', 'CAG CD / report'],
    ['Stent sticker / invoice'],
  ],
  [
    'SE007A',
    'Cataract surgery with IOL (SICS)',
    'Ophthalmology',
    8_000_00,
    0,
    true,
    ['Biometry report'],
    ['IOL sticker'],
  ],
  [
    'MN001A',
    'Haemodialysis (per session)',
    'Nephrology',
    2_000_00,
    0,
    false,
    ['Renal function test'],
    [],
  ],
];

await connectDb();
const tenants = await Tenant.find({ status: { $ne: 'CLOSED' } });
for (const t of tenants) {
  const codes = new Set(t.modules.map((m) => m.code));
  if (!codes.has('IPD')) continue;
  if (!codes.has('PMJ')) {
    t.modules.push({ code: 'PMJ' });
    await t.save();
    await tenantRegistry.invalidate?.(t);
  }
  await runAsSystem(
    t._id,
    async () => {
      let payer = await Payer.findOne({ code: 'PMJAY' }).lean();
      if (!payer)
        [payer] = await Payer.create([
          { code: 'PMJAY', name: 'Ayushman Bharat PM-JAY', kind: 'GOVT_SCHEME' },
        ]);
      const s = await settingsDoc();
      if (!s.stateCode)
        await saveSettings({
          payerId: String(payer._id),
          hospitalType: 'PRIVATE',
          stateCode: 'MH',
          hospitalCode: 'DEMO-HOSP-0001',
          channel: 'TMS',
          nhcx: { mode: 'MOCK', participantCode: 'demo-hospital@hcx', payerCode: 'pmjay-sha@hcx' },
        });
      const { added } = await importPackages({
        rows: SAMPLE.map(
          ([code, name, specialty, rate, stayDays, preauthRequired, pre, claim]) => ({
            code,
            name,
            specialty,
            rate,
            stayDays,
            preauthRequired,
            documents: { preauth: pre, claim },
          }),
        ),
      });
      console.log(`${t.name}: PMJ on, ${added} sample packages added`);
    },
    { userName: 'seed: pmjay' },
  );
}
await disconnectDb();
await closeRedis();
