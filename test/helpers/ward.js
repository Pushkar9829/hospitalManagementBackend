import { randomUUID } from 'node:crypto';
import { makeTenant, makeUser, signIn } from './int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import {
  Bed,
  Department,
  Doctor,
  PriceList,
  Service,
  TaxCode,
  Ward,
} from '../../src/modules/setup/index.js';

/**
 * A hospital with a general and a private ward (two beds each), a consultant, a front office
 * login and the given extra users; `admit(name)` admits an emergency patient through the API.
 * Used by the support-module tests (diet, facility, quality).
 */
export async function wardHospital(ctx, { modules = [], users = [], services = [] } = {}) {
  const t = await makeTenant({ modules: ['OPD', 'IPD', 'NUR', ...modules] });
  const docUser = await makeUser(t, { username: 'doc', roles: ['doctor'] });
  await makeUser(t, { username: 'fo', roles: ['frontoffice'] });
  for (const [u, r] of users) await makeUser(t, { username: u, roles: [r] });
  const ids = await runAsSystem(t.tenant._id, async () => {
    const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
    const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
    const svc = async (code, name, category, amount) =>
      (
        await Service.create([
          {
            code,
            name,
            category,
            taxCodeId: exempt._id,
            status: 'ACTIVE',
            isActive: true,
            rates: [{ priceListId: general._id, amount }],
          },
        ])
      )[0];
    const genDay = await svc('BEDGEN', 'General ward bed day', 'BED', 120000);
    const pvtDay = await svc('BEDPVT', 'Private room day', 'BED', 400000);
    for (const [code, name, category, amount] of services) await svc(code, name, category, amount);
    const [dept] = await Department.create([
      {
        code: 'MED',
        name: 'General Medicine',
        type: 'CLINICAL',
        status: 'ACTIVE',
        location: { branchId: t.branch._id },
      },
    ]);
    const [doctor] = await Doctor.create([
      {
        code: 'DRM',
        name: 'Dr. R. Menon',
        kind: 'CONSULTANT',
        departmentId: dept._id,
        registrationNo: 'MMC-9',
        userId: docUser._id,
      },
    ]);
    const [gw, pw] = await Ward.create([
      {
        code: 'GW',
        name: 'General Ward',
        branchId: t.branch._id,
        category: 'GENERAL',
        gender: 'ANY',
        bedServiceId: genDay._id,
      },
      {
        code: 'PW',
        name: 'Private Wing',
        branchId: t.branch._id,
        category: 'PRIVATE',
        gender: 'ANY',
        bedServiceId: pvtDay._id,
      },
    ]);
    const bed = async (code, w) =>
      String(
        (await Bed.create([{ code, name: code, wardId: w._id, branchId: t.branch._id }]))[0]._id,
      );
    return {
      doctorId: String(doctor._id),
      beds: {
        'GW-01': await bed('GW-01', gw),
        'GW-02': await bed('GW-02', gw),
        'PW-01': await bed('PW-01', pw),
        'PW-02': await bed('PW-02', pw),
      },
    };
  });
  const fo = await signIn(ctx.app, t.host, 'fo');
  let n = 0;
  const patient = async (first, gender = 'M') =>
    (
      await fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first, last: 'Kumar' },
        gender,
        mobile: `98000${String(10000 + n++).slice(-5)}`,
        birth: { age: { years: 45 } },
        category: 'GENERAL',
        confirmNotDuplicate: true,
      })
    ).body;
  const admit = async (first, bedCode, gender = 'M', existing = null) => {
    const p = existing ?? (await patient(first, gender));
    const res = await fo.post('/ipd/admissions').set('Idempotency-Key', randomUUID()).send({
      patientId: p.id,
      doctorId: ids.doctorId,
      reason: 'Observation',
      bedId: ids.beds[bedCode],
      emergency: true,
    });
    if (res.status !== 201) throw new Error(`admit failed: ${JSON.stringify(res.body)}`);
    return { ...res.body, patient: p };
  };
  return { t, ids, fo, patient, admit };
}
