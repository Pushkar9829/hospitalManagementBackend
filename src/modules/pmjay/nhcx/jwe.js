import {
  constants,
  createCipheriv,
  createDecipheriv,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';

/**
 * JWE compact serialisation, RSA-OAEP-256 + A256GCM, as the HCX protocol requires. The
 * protected header carries the x-hcx-* routing headers so the exchange can route without
 * reading the payload. Encrypted with the recipient's public key (from the NHCX registry).
 */
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function encrypt(payload, publicKeyPem, hcxHeaders) {
  const header = { alg: 'RSA-OAEP-256', enc: 'A256GCM', ...hcxHeaders };
  const protectedB64 = b64u(JSON.stringify(header));
  const cek = randomBytes(32);
  const iv = randomBytes(12);
  const encryptedKey = publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    cek,
  );
  const cipher = createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(Buffer.from(protectedB64, 'ascii'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    protectedB64,
    b64u(encryptedKey),
    b64u(iv),
    b64u(ciphertext),
    b64u(cipher.getAuthTag()),
  ].join('.');
}

/** Returns `{ header, payload }`; throws when the token was tampered with. */
export function decrypt(compact, privateKeyPem) {
  const [protectedB64, ek, iv, ct, tag] = String(compact).split('.');
  if (!tag) throw new Error('Not a JWE compact token');
  const header = JSON.parse(Buffer.from(protectedB64, 'base64url').toString('utf8'));
  const cek = privateDecrypt(
    { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(ek, 'base64url'),
  );
  const decipher = createDecipheriv('aes-256-gcm', cek, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(protectedB64, 'ascii'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const text = Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
  return { header, payload: JSON.parse(text.toString('utf8')) };
}
