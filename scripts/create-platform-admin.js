/**
 * Creates (or resets) a platform console user with two-factor sign-in, and prints the TOTP
 * secret once so it can be added to an authenticator app.
 * Usage: node --env-file=.env scripts/create-platform-admin.js <email> "<name>" [ROLE,...]
 * The password is read from PLATFORM_ADMIN_PASSWORD so it never lands in shell history.
 */
import { authenticator } from 'otplib';
import { passwordPolicy } from '@hms/shared/schemas';
import { connectDb, disconnectDb } from '../src/core/db/connection.js';
import { hashPassword } from '../src/core/auth/password.js';
import { encrypt } from '../src/core/security/crypto.js';
import { PlatformUser } from '../src/platform/models/platform.models.js';

const [email, name, roles = 'PLATFORM_SUPER_ADMIN'] = process.argv.slice(2);
const password = process.env.PLATFORM_ADMIN_PASSWORD;
if (!email || !name || !password) {
  console.error(
    'Usage: PLATFORM_ADMIN_PASSWORD=... node scripts/create-platform-admin.js <email> "<name>" [ROLES]',
  );
  process.exit(1);
}
const policy = passwordPolicy.safeParse(password);
if (!policy.success) {
  console.error(policy.error.issues.map((i) => i.message).join('\n'));
  process.exit(1);
}

await connectDb();
const secret = authenticator.generateSecret();
await PlatformUser.findOneAndUpdate(
  { email: email.toLowerCase() },
  {
    $set: {
      name,
      roles: roles.split(','),
      passwordHash: await hashPassword(password),
      twoFactor: { enabled: true, secret: encrypt(secret) },
      status: 'ACTIVE',
      failedLogins: 0,
    },
    $unset: { lockedUntil: 1 },
  },
  { upsert: true, runValidators: true },
);
console.log(`Platform user ${email} ready (${roles}).`);
console.log(`Authenticator secret: ${secret}`);
console.log(authenticator.keyuri(email, 'HMS Console', secret));
await disconnectDb();
