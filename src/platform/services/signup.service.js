import { randomInt } from 'node:crypto';
import { RESERVED_SUBDOMAINS } from '@hms/shared';
import { planOf, refreshBook } from './pricebook.service.js';
import { env } from '../../config/env.js';
import { AppError, errors } from '../../core/errors/index.js';
import { redis } from '../../core/cache/redis.js';
import { Tenant } from '../../core/tenancy/tenant.model.js';
import { provisionTenant } from '../../core/tenancy/provision.js';
import { sendSms } from '../../core/notify/notify.service.js';
import { randomToken, safeEqual, sha256 } from '../../core/security/crypto.js';
import { SignupRecord, Subscription } from '../models/platform.models.js';

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const OTP_TTL = 300;
const TOKEN_TTL = 1800;

export async function checkSubdomain(name) {
  const sub = String(name).toLowerCase();
  if (!SUBDOMAIN.test(sub))
    return { available: false, reason: 'Use 3 to 32 letters, digits or hyphens' };
  if (RESERVED_SUBDOMAINS.includes(sub))
    return { available: false, reason: 'This address is reserved' };
  if (await Tenant.exists({ subdomain: sub }))
    return { available: false, reason: 'This address is taken' };
  return { available: true };
}

/** Step 2 of signup (spec 3.3): verify the mobile with an SMS code. Same answer every time. */
export async function requestSignupOtp({ mobile }) {
  const sends = await redis().incr(`signup:sends:${mobile}`);
  if (sends === 1) await redis().expire(`signup:sends:${mobile}`, 600);
  if (sends <= 3) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await redis().set(
      `signup:otp:${mobile}`,
      JSON.stringify({ hash: sha256(`${mobile}:${code}`), attempts: 0 }),
      'EX',
      OTP_TTL,
    );
    await sendSms({ to: mobile, template: 'SIGNUP_OTP', vars: { code } });
  }
  return { expiresInSec: OTP_TTL };
}

export async function verifySignupOtp({ mobile, code }) {
  const key = `signup:otp:${mobile}`;
  const raw = await redis().get(key);
  const wrong = new AppError(401, 'INVALID_CREDENTIALS', 'The code is incorrect or has expired');
  if (!raw) throw wrong;
  const otp = JSON.parse(raw);
  if (!safeEqual(otp.hash, sha256(`${mobile}:${code}`))) {
    otp.attempts += 1;
    if (otp.attempts >= 5) await redis().del(key);
    else await redis().set(key, JSON.stringify(otp), 'KEEPTTL');
    throw wrong;
  }
  await redis().del(key);
  const otpToken = `otp_${randomToken(24)}`;
  await redis().set(`signup:token:${otpToken}`, mobile, 'EX', TOKEN_TTL);
  return { otpToken };
}

/**
 * Creates a trial of the trial plan set in the console (spec 3.3, 3.4) and answers with the one-time
 * link where the first Super Admin sets a password. One trial per mobile number.
 */
export async function signup({ contact, hospital, subdomain, acceptTermsVersion }, { ip }) {
  const mobile = await redis().get(`signup:token:${contact.otpToken}`);
  if (!mobile || mobile !== contact.mobile)
    throw new AppError(401, 'TOKEN_INVALID', 'Verify the mobile number again');
  if (await SignupRecord.exists({ mobile: contact.mobile, tenantId: { $exists: true } })) {
    throw new AppError(
      409,
      'TRIAL_EXISTS',
      'A trial was already started with this mobile number. Contact sales to extend it.',
    );
  }
  const check = await checkSubdomain(subdomain);
  if (!check.available) throw errors.validation([{ path: 'subdomain', message: check.reason }]);
  // The trial runs on the trial plan set in the console.
  const b = await refreshBook();
  const plan = planOf(b.trialPlan ?? 'HOSPITAL');
  const trialEndsAt = new Date(Date.now() + b.trialDays * 86_400_000);
  const out = await provisionTenant({
    name: hospital.name,
    subdomain,
    status: 'TRIAL',
    modules: plan.modules.filter((m) => m !== 'CORE'),
    settings: {},
    admin: {
      name: contact.name,
      username: 'superadmin',
      mobile: contact.mobile,
      email: contact.email,
    },
  });
  await Tenant.updateOne(
    { _id: out.tenant._id },
    {
      $set: {
        trialEndsAt,
        limits: {
          users: plan.limits.users,
          branches: plan.limits.branches,
          beds: plan.limits.beds,
        },
        billing: {
          contactName: contact.name,
          email: contact.email,
          mobile: contact.mobile,
          legalName: hospital.name,
          city: hospital.city,
          ...(hospital.state ? { state: hospital.state } : {}),
        },
        signup: {
          acceptedTermsVersion: acceptTermsVersion,
          ip,
          at: new Date(),
          beds: hospital.beds,
        },
      },
    },
  );
  await Subscription.create({
    tenantId: out.tenant._id,
    plan: plan.code,
    quantities: { branches: 1, beds: hospital.beds ?? 0, entities: 1, users: 10 },
  });
  await SignupRecord.create({
    mobile: contact.mobile,
    email: contact.email,
    subdomain,
    tenantId: out.tenant._id,
    ip,
  });
  await redis().del(`signup:token:${contact.otpToken}`);
  return {
    tenantId: String(out.tenant._id),
    status: 'TRIAL',
    loginUrl: `${env.WEB_URL_TEMPLATE.replace('{subdomain}', subdomain)}/welcome?token=${out.inviteToken}`,
    trialEndsAt,
  };
}
