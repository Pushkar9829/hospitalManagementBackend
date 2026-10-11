import { z } from 'zod';
import { AppError, errors } from '../../../core/errors/index.js';
import { randomToken, sha256 } from '../../../core/security/crypto.js';
import { current } from '../../../core/tenancy/context.js';
import { Branch } from '../../../core/tenancy/branch.model.js';
import { DisplayKey } from '../models/opd.models.js';
import { display } from './visit.service.js';

const out = (k) => ({
  id: String(k._id),
  name: k.name,
  branchId: String(k.branchId),
  last4: k.last4,
  createdByName: k.createdByName ?? null,
  createdAt: k.createdAt,
  lastSeenAt: k.lastSeenAt ?? null,
});

/** Queue TVs of the current branch (revoked keys are not listed). */
export async function listKeys() {
  const branchId = current().branchId;
  const rows = await DisplayKey.find({ branchId, revokedAt: null }).sort({ createdAt: -1 }).lean();
  return { items: rows.map(out) };
}

export const keyInput = z.object({ name: z.string().trim().min(2).max(60) });

/** Registers a TV for the current branch. The key is shown once; only its hash is kept. */
export async function createKey({ name }) {
  const c = current();
  if (!c.branchId) throw errors.validation([{ path: 'branch', message: 'Pick a branch first' }]);
  const active = await DisplayKey.countDocuments({ branchId: c.branchId, revokedAt: null });
  if (active >= 20)
    throw new AppError(409, 'TOO_MANY_DISPLAYS', 'A branch can have at most 20 Queue TVs.');
  const key = `tv_${randomToken(24)}`;
  const [k] = await DisplayKey.create([
    {
      name,
      branchId: c.branchId,
      hash: sha256(key),
      last4: key.slice(-4),
      createdByName: c.userName,
    },
  ]);
  return { ...out(k.toObject()), key };
}

export async function revokeKey(id) {
  const k = await DisplayKey.findOne({ _id: id, branchId: current().branchId, revokedAt: null });
  if (!k) throw errors.notFound('Queue TV');
  k.revokedAt = new Date();
  await k.save();
  return { ok: true };
}

/**
 * The queue for a TV holding a display key: the key picks the branch. Wrong or revoked keys get
 * the same 401, so a key cannot be guessed by its answers.
 */
export async function displayForKey(rawKey) {
  const key = String(rawKey ?? '');
  const k = key.startsWith('tv_') ? await DisplayKey.findOne({ hash: sha256(key) }) : null;
  if (!k || k.revokedAt)
    throw new AppError(
      401,
      'DISPLAY_KEY_INVALID',
      'This screen is not registered. Ask the OPD desk.',
    );
  current().branchId = String(k.branchId);
  // Last seen, at most once a minute (the TV polls every 10 seconds).
  if (!k.lastSeenAt || Date.now() - k.lastSeenAt.getTime() > 60_000) {
    await DisplayKey.updateOne({ _id: k._id }, { $set: { lastSeenAt: new Date() } });
  }
  const branch = await Branch.findById(k.branchId).select('name').lean();
  return { ...(await display()), branch: branch?.name ?? null };
}
