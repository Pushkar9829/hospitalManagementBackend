import argon2 from 'argon2';

// OWASP 2024 guidance for Argon2id: 19 MiB memory, 2 iterations, 1 lane.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
let dummyHash;

export const hashPassword = (plain) => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash, plain) {
  if (!hash) {
    // Same cost when the user does not exist, so timing does not reveal valid usernames.
    dummyHash ??= await argon2.hash('not-a-real-password-0', OPTIONS);
    await argon2.verify(dummyHash, plain).catch(() => false);
    return false;
  }
  return argon2.verify(hash, plain).catch(() => false);
}
