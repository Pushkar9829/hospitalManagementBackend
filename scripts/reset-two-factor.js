/**
 * Support only: clears the two-factor device of a hospital's user when no other Super Admin can
 * (the hospital has one Super Admin and they lost their phone). Verify the person's identity
 * through the hospital's registered contact first. The reset is written to the audit log.
 *
 *   npm run support:reset-2fa -- <hospital subdomain> <username> "<reason and ticket number>"
 */
import { connectDb, disconnectDb } from '../src/core/db/connection.js';
import { closeRedis } from '../src/core/cache/redis.js';
import { recordAudit } from '../src/core/audit/audit.service.js';
import { User } from '../src/core/auth/models/user.model.js';
import { Session } from '../src/core/auth/models/session.model.js';
import { permissionCache } from '../src/core/rbac/permission.cache.js';
import { runAsSystem } from '../src/core/tenancy/context.js';
import { Tenant } from '../src/core/tenancy/tenant.model.js';

const [subdomain, username, reason] = process.argv.slice(2);
if (!subdomain || !username || !reason || reason.trim().length < 10) {
  console.error('Usage: npm run support:reset-2fa -- <subdomain> <username> "<reason, ticket>"');
  process.exit(2);
}

await connectDb();
const tenant = await Tenant.findOne({ subdomain }).lean();
if (!tenant) {
  console.error(`No hospital "${subdomain}".`);
  process.exitCode = 1;
} else {
  await runAsSystem(tenant._id, async () => {
    const user = await User.findOne({ username }).select('+twoFactor.secret');
    if (!user) {
      console.error(`No user "${username}" at ${subdomain}.`);
      process.exitCode = 1;
      return;
    }
    user.set('twoFactor', { enabled: false, secret: undefined, pendingSecret: undefined });
    await user.save();
    await Session.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'two-factor-reset-support' } },
    );
    await permissionCache.invalidate(String(tenant._id), String(user._id));
    await recordAudit({
      action: 'UPDATE',
      entity: 'User',
      entityId: user._id,
      summary: `Two-factor sign-in reset for ${username} by platform support: ${reason}`,
      userName: 'Platform support',
    });
    console.log(
      `Two-factor reset for ${username} at ${subdomain}; they set it up at next sign-in.`,
    );
  });
}
await disconnectDb();
await closeRedis();
