/**
 * Development data: a demo hospital at http://demo.localhost:5173 with one user per role panel.
 * Usage: pnpm --filter @hms/api seed:dev   (needs MongoDB and Redis from infra/docker)
 * Every user's password is printed once; nothing here is used outside development.
 */
import { env } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/core/db/connection.js';
import '../src/modules/index.js'; // registers module seeders
import { closeRedis } from '../src/core/cache/redis.js';
import { runAsSystem } from '../src/core/tenancy/context.js';
import { Tenant } from '../src/core/tenancy/tenant.model.js';
import { tenantRegistry } from '../src/core/tenancy/tenant.registry.js';
import { User } from '../src/core/auth/models/user.model.js';
import { hashPassword } from '../src/core/auth/password.js';
import { provisionTenant } from '../src/core/tenancy/provision.js';
import { Branch } from '../src/core/tenancy/branch.model.js';
import { seedOpdDemo } from './seed-opd-demo.js';
import { seedIpdDemo } from './seed-ipd-demo.js';
import { seedLabDemo, seedMicroDemo } from './seed-lab-demo.js';
import { seedRadDemo } from './seed-rad-demo.js';
import { seedPharmacyDemo } from './seed-pharmacy-demo.js';
import { seedPeopleDemo } from './seed-people-demo.js';
import { seedSupportDemo } from './seed-support-demo.js';

if (env.isProd) throw new Error('seed-dev must never run in production');
const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo@12345';

await connectDb();
const existing = await Tenant.findOne({ subdomain: 'demo' });
// Demo only: room for one login per panel plus the users that smoke runs create.
const DEMO_LIMITS = { users: 500, branches: 10, beds: 500 };
if (existing) {
  await Tenant.updateOne({ _id: existing._id }, { $set: { limits: DEMO_LIMITS } });
  console.log('Demo hospital already exists: http://demo.localhost:5173');
} else {
  const { tenant, branch, roles } = await provisionTenant({
    name: 'Demo Hospital',
    subdomain: 'demo',
    modules: [
      'OPD',
      'IPD',
      'NUR',
      'LAB',
      'RAD',
      'PHR',
      'INV',
      'HRM',
      'PAY',
      'FIN',
      'MRD',
      'DIET',
      'FAC',
      'QLT',
      'CRM',
    ],
    // Demo only: production tenants require two-factor sign-in for privileged roles.
    settings: { twoFactorRoles: [] },
    admin: {
      name: 'Dr. Arjun Rao',
      username: 'superadmin',
      mobile: '9876500001',
      password: PASSWORD,
    },
  });
  await Tenant.updateOne({ _id: tenant._id }, { $set: { limits: DEMO_LIMITS } });
  await runAsSystem(tenant._id, async () => {
    const hash = await hashPassword(PASSWORD);
    let i = 2;
    for (const role of roles.filter((r) => r.code !== 'superadmin')) {
      await User.create({
        name: `Demo ${role.name}`,
        username: role.code,
        mobile: `98765${String(i++).padStart(5, '0')}`,
        passwordHash: hash,
        roles: [role._id],
        branchIds: [branch._id],
        defaultBranchId: branch._id,
      });
    }
  });
  await tenantRegistry.invalidate(tenant);
  console.log(`Demo hospital created: http://demo.localhost:5173
Sign in as "superadmin" or any role panel key (doctor, nurse, cashier, ...) with password ${PASSWORD}`);
}
// OPD demo data (doctors, schedules, fees, tests, today's bookings); skipped once present.
const demo = await Tenant.findOne({ subdomain: 'demo' }).lean();
// Await inside: a query left un-run would execute outside the system context.
const demoBranch = await runAsSystem(demo._id, async () =>
  Branch.findOne().sort({ createdAt: 1 }).lean().exec(),
);
if (await seedOpdDemo({ tenant: demo, branch: demoBranch }))
  console.log('OPD demo data added: 6 doctors, schedules, fees, tests and today’s bookings.');
if (await seedIpdDemo({ tenant: demo, branch: demoBranch }))
  console.log('IPD demo data added: wards, beds, payers, three admitted patients and a request.');
if (await seedLabDemo({ tenant: demo, branch: demoBranch, password: PASSWORD }))
  console.log('Lab demo data added: tests, QC runs, a pathologist login and orders at each stage.');
if (await seedMicroDemo({ tenant: demo, branch: demoBranch }))
  console.log('Microbiology and histopathology demo added: a urine culture and a biopsy.');
if (await seedRadDemo({ tenant: demo, branch: demoBranch, password: PASSWORD }))
  console.log('Radiology demo added: studies at each stage and a second radiologist login.');
if (await seedPharmacyDemo({ tenant: demo, branch: demoBranch }))
  console.log(
    'Inventory and pharmacy demo added: items, stores, stock, a PO and the pharmacy queue.',
  );
if (await seedPeopleDemo({ tenant: demo, branch: demoBranch }))
  console.log(
    'HR, payroll and finance demo added: staff, rosters, attendance, two payroll runs and the books.',
  );
const support = await seedSupportDemo({ tenant: demo, branch: demoBranch });
if (support.length) console.log(`Support modules demo added: ${support.join(', ')}.`);
await disconnectDb();
await closeRedis();
