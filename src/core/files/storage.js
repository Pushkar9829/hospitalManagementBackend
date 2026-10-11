import { createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { safeEqual } from '../security/crypto.js';

export const URL_TTL_SEC = 300; // spec: presigned URLs live 5 minutes

/**
 * Production: private S3 bucket, presigned PUT/GET URLs (spec "Storage isolation").
 * Development and tests: files on local disk behind HMAC-signed URLs with the same contract.
 */
function s3Driver() {
  const s3 = new S3Client({ region: env.AWS_REGION });
  const Bucket = env.S3_DOCS_BUCKET;
  return {
    name: 's3',
    uploadUrl: (key, { mime, size }) =>
      getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: mime,
          ContentLength: size,
          ServerSideEncryption: 'aws:kms',
        }),
        {
          expiresIn: URL_TTL_SEC,
        },
      ),
    downloadUrl: (key, { name, mime }) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentType: mime,
          ResponseContentDisposition: `inline; filename="${encodeURIComponent(name)}"`,
        }),
        { expiresIn: URL_TTL_SEC },
      ),
    /** Server-side write (generated files such as report exports). */
    async write(key, body, mime) {
      await s3.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: mime,
          ServerSideEncryption: 'aws:kms',
        }),
      );
    },
    async read(key) {
      const obj = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await obj.Body.transformToByteArray());
    },
    async head(key) {
      try {
        const h = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: h.ContentLength, mime: h.ContentType };
      } catch (err) {
        if (err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
  };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.storage');

const sign = (payload) =>
  createHmac('sha256', Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64'))
    .update(payload)
    .digest('base64url');

/** Token for one operation on one key until `exp`. */
export function localToken(op, key, extra = {}) {
  const payload = Buffer.from(
    JSON.stringify({ op, key, exp: Date.now() + URL_TTL_SEC * 1000, ...extra }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyLocalToken(token, op) {
  const [payload, mac] = String(token).split('.');
  if (!payload || !mac || !safeEqual(mac, sign(payload))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return data.op === op && data.exp > Date.now() ? data : null;
}

export function localPath(key) {
  const p = resolve(root, key);
  if (!p.startsWith(root + sep)) throw new Error('Invalid storage key');
  return p;
}

function localDriver() {
  return {
    name: 'local',
    uploadUrl: async (key, { mime, size }) =>
      `/api/files/local/${localToken('put', key, { mime, size })}`,
    downloadUrl: async (key, { name, mime }) =>
      `/api/files/local/${localToken('get', key, { name, mime })}`,
    read: (key) => readFile(localPath(key)),
    async write(key, body) {
      const p = localPath(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async head(key) {
      try {
        return { size: (await stat(localPath(key))).size };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Hosts without S3 (Render, a single VM): files in MongoDB GridFS, behind the same HMAC-signed
 * URLs as the local driver. Fine for documents and reports; use S3 for large image volumes.
 */
const gridfs = () =>
  new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'storedFiles' });

async function gridFind(key) {
  return (await gridfs().find({ filename: key }).sort({ uploadDate: -1 }).limit(1).toArray())[0];
}

async function gridRemove(key) {
  const b = gridfs();
  for (const f of await b.find({ filename: key }).toArray()) await b.delete(f._id);
}

function mongoDriver() {
  return {
    name: 'mongo',
    uploadUrl: async (key, { mime, size }) =>
      `/api/files/local/${localToken('put', key, { mime, size })}`,
    downloadUrl: async (key, { name, mime }) =>
      `/api/files/local/${localToken('get', key, { name, mime })}`,
    async read(key) {
      const f = await gridFind(key);
      if (!f) throw new Error('File not found');
      const chunks = [];
      for await (const c of gridfs().openDownloadStream(f._id)) chunks.push(c);
      return Buffer.concat(chunks);
    },
    async write(key, body, mime) {
      await gridRemove(key);
      await new Promise((ok, fail) => {
        const up = gridfs().openUploadStream(key, { metadata: { mime } });
        up.on('finish', ok).on('error', fail);
        up.end(body);
      });
    },
    async head(key) {
      const f = await gridFind(key);
      return f ? { size: f.length, mime: f.metadata?.mime } : null;
    },
  };
}

let driver;
export function storage() {
  driver ??=
    env.STORAGE_DRIVER === 's3' || (env.S3_DOCS_BUCKET && env.STORAGE_DRIVER !== 'mongo')
      ? s3Driver()
      : env.STORAGE_DRIVER === 'mongo'
        ? mongoDriver()
        : localDriver();
  return driver;
}

/** True when uploads and downloads go through the API's signed URLs (not S3). */
export const servesFiles = () => storage().name !== 's3';

/** Express handlers for the local and mongo drivers (signed URLs served by the API). */
export const localFileHandlers = {
  async put(req, res) {
    const t = verifyLocalToken(req.params.token, 'put');
    if (!t) return res.status(403).end();
    if (req.headers['content-type'] !== t.mime)
      return res
        .status(400)
        .json({ error: { code: 'BAD_REQUEST', message: 'Content-Type does not match' } });
    // Like a presigned S3 PUT, the declared length is part of the signature.
    const length = Number(req.headers['content-length']);
    if (length !== t.size) {
      return res.status(length > t.size ? 413 : 400).json({
        error: { code: 'BAD_REQUEST', message: 'Size does not match the upload request' },
      });
    }
    if (storage().name === 'mongo') {
      const chunks = [];
      try {
        for await (const c of req) chunks.push(c);
      } catch {
        return res.status(400).end();
      }
      await storage().write(t.key, Buffer.concat(chunks), t.mime);
      return res.status(200).end();
    }
    const path = localPath(t.key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.part`;
    try {
      await pipeline(req, createWriteStream(tmp));
    } catch {
      await unlink(tmp).catch(() => {});
      return res.status(400).end();
    }
    await rename(tmp, path);
    res.status(200).end();
  },
  async get(req, res) {
    const t = verifyLocalToken(req.params.token, 'get');
    if (!t) return res.status(403).end();
    const headers = () => {
      res.setHeader('Content-Type', t.mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(t.name)}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    };
    if (storage().name === 'mongo') {
      const f = await gridFind(t.key);
      if (!f) return res.status(404).end();
      headers();
      return pipeline(gridfs().openDownloadStream(f._id), res);
    }
    const path = localPath(t.key);
    try {
      await stat(path);
    } catch {
      return res.status(404).end();
    }
    headers();
    await pipeline(createReadStream(path), res);
  },
};
