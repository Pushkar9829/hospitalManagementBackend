import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';

const ctx = useIntegration();
const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a2b30000000049454e44ae426082',
  'hex',
);

describe('file storage', () => {
  it('uploads with a short-lived URL, confirms, and downloads with an audited link', async () => {
    const t = await makeTenant();
    const admin = await signIn(ctx.app, t.host);
    const start = await admin
      .post('/files/upload-url')
      .send({ purpose: 'hospital-logo', name: 'logo.png', mime: 'image/png', size: png.length });
    expect(start.status).toBe(201);
    expect(start.body.upload.url).toMatch(/^\/api\/files\/local\//);
    expect((await admin.post(`/files/${start.body.fileId}/complete`)).status).toBe(409);

    const wrongType = await request(ctx.app)
      .put(start.body.upload.url)
      .set('Content-Type', 'image/jpeg')
      .send(png);
    expect(wrongType.status).toBe(400);
    const put = await request(ctx.app)
      .put(start.body.upload.url)
      .set('Content-Type', 'image/png')
      .send(png);
    expect(put.status).toBe(200);
    expect((await admin.post(`/files/${start.body.fileId}/complete`)).body.status).toBe('READY');

    const link = await admin.get(`/files/${start.body.fileId}/download-url`);
    const file = await request(ctx.app)
      .get(link.body.url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(file.body, png)).toBe(0);
    expect((await admin.get('/audit?action=EXPORT&entity=StoredFile')).body.total).toBe(1);
  });

  it('checks type, size, permission, tokens and tenant', async () => {
    const t = await makeTenant();
    const admin = await signIn(ctx.app, t.host);
    expect(
      (
        await admin.post('/files/upload-url').send({
          purpose: 'hospital-logo',
          name: 'x.exe',
          mime: 'application/x-msdownload',
          size: 10,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await admin.post('/files/upload-url').send({
          purpose: 'hospital-logo',
          name: 'big.png',
          mime: 'image/png',
          size: 50 * 1024 * 1024,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await admin
          .post('/files/upload-url')
          .send({ purpose: 'nonsense', name: 'a.png', mime: 'image/png', size: 10 })
      ).status,
    ).toBe(422);
    await makeUser(t, { username: 'nurse9', roles: ['nurse'] });
    const nurse = await signIn(ctx.app, t.host, 'nurse9');
    expect(
      (
        await nurse
          .post('/files/upload-url')
          .send({ purpose: 'hospital-logo', name: 'a.png', mime: 'image/png', size: 10 })
      ).status,
    ).toBe(403);

    const start = await admin
      .post('/files/upload-url')
      .send({ purpose: 'hospital-logo', name: 'a.png', mime: 'image/png', size: png.length });
    const forged = start.body.upload.url.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect(
      (await request(ctx.app).put(forged).set('Content-Type', 'image/png').send(png)).status,
    ).toBe(403);
    expect(
      (
        await request(ctx.app)
          .put(start.body.upload.url)
          .set('Content-Type', 'image/png')
          .send(Buffer.concat([png, png]))
      ).status,
    ).toBe(413);

    const other = await makeTenant();
    const otherAdmin = await signIn(ctx.app, other.host);
    expect((await otherAdmin.get(`/files/${start.body.fileId}/download-url`)).status).toBe(404);
  });
});
