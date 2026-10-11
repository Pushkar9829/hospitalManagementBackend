import { randomUUID } from 'node:crypto';
import { hasPermission } from '@hms/shared';
import { AppError, errors } from '../errors/index.js';
import { current } from '../tenancy/context.js';
import { recordAudit } from '../audit/audit.service.js';
import { StoredFile } from './file.model.js';
import { URL_TTL_SEC, storage } from './storage.js';

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const MB = 1024 * 1024;

/**
 * What may be uploaded, how big, and who may read or write it. Modules register their own
 * purposes (patients: photo and ID documents) when they load.
 */
const purposes = new Map([
  [
    'hospital-logo',
    { mimes: IMAGES, maxBytes: 2 * MB, write: 'settings:hospital:update', read: 'authenticated' },
  ],
  [
    'letterhead',
    {
      mimes: [...IMAGES, 'application/pdf'],
      maxBytes: 5 * MB,
      write: 'settings:hospital:update',
      read: 'authenticated',
    },
  ],
  [
    'signature',
    { mimes: IMAGES, maxBytes: 1 * MB, write: 'settings:user:update', read: 'authenticated' },
  ],
]);

export function registerFilePurpose(name, config) {
  purposes.set(name, config);
}

function allowed(key) {
  return key === 'authenticated' || hasPermission(current().permissions, key);
}

/** Step 1: check the file, record it as PENDING and hand out a 5-minute upload URL. */
export async function createUpload({ purpose, name, mime, size, ownerEntity, ownerId }) {
  const cfg = purposes.get(purpose);
  if (!cfg) throw errors.validation([{ path: 'purpose', message: 'Unknown file purpose' }]);
  if (!allowed(cfg.write)) throw errors.forbidden(`You need the permission ${cfg.write}`);
  if (!cfg.mimes.includes(mime))
    throw errors.validation([{ path: 'mime', message: `Allowed types: ${cfg.mimes.join(', ')}` }]);
  if (size > cfg.maxBytes)
    throw errors.validation([
      { path: 'size', message: `Maximum size is ${Math.round(cfg.maxBytes / MB)} MB` },
    ]);
  const { tenantId } = current();
  const ext =
    { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[
      mime
    ] ?? 'bin';
  const key = `tenants/${tenantId}/${purpose}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  const [file] = await StoredFile.create([
    { purpose, key, name, mime, size, ownerEntity, ownerId },
  ]);
  return {
    fileId: String(file._id),
    upload: {
      method: 'PUT',
      url: await storage().uploadUrl(key, { mime, size }),
      headers: { 'Content-Type': mime },
    },
    expiresInSec: URL_TTL_SEC,
  };
}

/** Step 2: confirm the bytes arrived with the declared size. */
export async function completeUpload(id) {
  const file = await StoredFile.findById(id);
  if (!file) throw errors.notFound('File');
  if (file.status === 'READY') return dto(file);
  if (!allowed(purposes.get(file.purpose)?.write ?? '*')) throw errors.forbidden();
  const head = await storage().head(file.key);
  if (!head || head.size !== file.size)
    throw new AppError(409, 'UPLOAD_INCOMPLETE', 'The file has not finished uploading');
  file.status = 'READY';
  await file.save();
  return dto(file);
}

/** Stores a file the server generated (e.g. a report export) and records it READY. */
export async function storeGenerated({ purpose, name, mime, ext, body, ownerEntity, ownerId }) {
  if (!purposes.get(purpose)) throw new Error(`Unknown file purpose ${purpose}`);
  const { tenantId } = current();
  const key = `tenants/${tenantId}/${purpose}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  await storage().write(key, body, mime);
  const [file] = await StoredFile.create([
    { purpose, key, name, mime, size: body.length, ownerEntity, ownerId, status: 'READY' },
  ]);
  return file;
}

/** A 5-minute download link; every download is audited (patient documents are sensitive). */
export async function downloadUrl(id) {
  const file = await StoredFile.findOne({ _id: id, status: 'READY' });
  if (!file) throw errors.notFound('File');
  const cfg = purposes.get(file.purpose);
  if (!cfg || !allowed(cfg.read)) throw errors.notFound('File');
  await recordAudit({
    action: 'EXPORT',
    entity: 'StoredFile',
    entityId: file._id,
    summary: `Opened ${file.purpose} ${file.name}`,
    after: { ownerEntity: file.ownerEntity, ownerId: file.ownerId },
  });
  return {
    url: await storage().downloadUrl(file.key, { name: file.name, mime: file.mime }),
    expiresInSec: URL_TTL_SEC,
  };
}

export const dto = (f) => ({
  id: String(f._id),
  purpose: f.purpose,
  name: f.name,
  mime: f.mime,
  size: f.size,
  status: f.status,
  ownerEntity: f.ownerEntity,
  ownerId: f.ownerId,
});

/** Reads a READY file the current user may write for its purpose (imports read their own upload). */
export async function readFileContent(id, { purpose } = {}) {
  const file = await StoredFile.findOne({
    _id: id,
    status: 'READY',
    ...(purpose ? { purpose } : {}),
  });
  if (!file) throw errors.notFound('File');
  return { file: dto(file), buffer: await storage().read(file.key) };
}
