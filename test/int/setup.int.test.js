import { describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Tenant } from '../../src/core/tenancy/tenant.model.js';
import { tenantRegistry } from '../../src/core/tenancy/tenant.registry.js';
import { numbering } from '../../src/modules/setup/index.js';

const ctx = useIntegration();

/** Hospital with an admin (maker) and the Super Admin (checker). */
async function hospital(opts) {
  const t = await makeTenant(opts);
  await makeUser(t, { username: 'hadmin', roles: ['admin'] });
  return { t, admin: await signIn(ctx.app, t.host, 'hadmin'), sa: await signIn(ctx.app, t.host) };
}

const dept = (t, extra = {}) => ({
  code: 'CARD',
  name: 'Cardiology',
  type: 'CLINICAL',
  location: { branchId: String(t.branch._id), floor: '2' },
  services: { opd: true, ipd: true, procedures: true, diagnostics: false },
  opdTimings: [{ day: 1, from: '09:00', to: '13:00' }],
  ...extra,
});

async function approve(sa, approvalId) {
  const a = await sa.get(`/approvals/${approvalId}`);
  return sa
    .post(`/approvals/${approvalId}/decision`)
    .send({ decision: 'APPROVE', version: a.body.version });
}

async function upload(c, name, mime, buffer) {
  const start = await c
    .post('/files/upload-url')
    .send({ purpose: 'master-import', name, mime, size: buffer.length });
  expect(start.status).toBe(201);
  await request(ctx.app).put(start.body.upload.url).set('Content-Type', mime).send(buffer);
  await c.post(`/files/${start.body.fileId}/complete`);
  return start.body.fileId;
}

describe('hospital setup', () => {
  it('seeds default masters and settings for a new hospital', async () => {
    const { admin } = await hospital();
    const modes = await admin.get('/masters/payment-modes');
    expect(modes.body.items.map((m) => m.code)).toEqual(
      expect.arrayContaining(['CASH', 'UPI', 'CARD']),
    );
    const lists = (await admin.get('/masters/price-lists')).body.items;
    expect(lists.filter((l) => l.isDefault).map((l) => l.code)).toEqual(['GENERAL']);
    const s = await admin.get('/settings/hospital');
    expect(s.body).toMatchObject({
      financialYearStartMonth: 4,
      timezone: 'Asia/Kolkata',
      idleTimeoutMin: 15,
    });
  });

  it('saves settings and applies the idle timeout to the hospital', async () => {
    const { t, sa } = await hospital();
    const s = (await sa.get('/settings/hospital')).body;
    const res = await sa
      .put('/settings/hospital')
      .send({ ...s, idleTimeoutMin: 30, displayName: 'City Care Hospital' });
    expect(res.status).toBe(200);
    expect((await tenantRegistry.byHost(t.host)).settings.idleTimeoutMin).toBe(30);
    expect((await sa.get('/auth/me')).body.idleTimeoutMin).toBe(30);
  });
});

describe('departments', () => {
  it('goes through Super Admin approval to become active, and back to draft when rejected', async () => {
    const { t, admin, sa } = await hospital();
    const created = await admin.post('/departments').send(dept(t));
    expect(created.status).toBe(202);
    expect(created.body.department.status).toBe('PENDING_APPROVAL');
    expect((await admin.post('/departments').send(dept(t))).status).toBe(422);
    expect((await approve(sa, created.body.approvalId)).body.status).toBe('APPLIED');
    expect((await admin.get(`/departments/${created.body.department.id}`)).body.status).toBe(
      'ACTIVE',
    );

    const second = await admin
      .post('/departments')
      .send(dept(t, { code: 'NEURO', name: 'Neurology' }));
    const a = await sa.get(`/approvals/${second.body.approvalId}`);
    await sa
      .post(`/approvals/${second.body.approvalId}/decision`)
      .send({ decision: 'REJECT', comment: 'Not yet', version: a.body.version });
    const draft = await admin.get(`/departments/${second.body.department.id}`);
    expect(draft.body.status).toBe('DRAFT');
    const again = await admin
      .post(`/departments/${draft.body.id}/submit`)
      .send({ version: draft.body.version });
    expect(again.status).toBe(202);
  });

  it('lists what still uses a department before it can close', async () => {
    const { t, admin, sa } = await hospital();
    const created = await admin.post('/departments').send(dept(t));
    await approve(sa, created.body.approvalId);
    const doc = (await admin.get(`/departments/${created.body.department.id}`)).body;
    const user = await makeUser(t, { username: 'cardio1', roles: ['doctor'] });
    await runAsSystem(t.tenant._id, () =>
      user.constructor.updateOne({ _id: user._id }, { $set: { departmentIds: [doc.id] } }).exec(),
    );
    const blocked = await admin
      .post(`/departments/${doc.id}/close`)
      .send({ version: doc.version, reason: 'Merging' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details[0].message).toMatch(/1 active staff/);
    await runAsSystem(t.tenant._id, () =>
      user.constructor.updateOne({ _id: user._id }, { $set: { departmentIds: [] } }).exec(),
    );
    const closing = await admin
      .post(`/departments/${doc.id}/close`)
      .send({ version: doc.version, reason: 'Merging' });
    expect(closing.body.department.status).toBe('CLOSING');
    await approve(sa, closing.body.approvalId);
    expect((await admin.get(`/departments/${doc.id}`)).body.status).toBe('INACTIVE');
  });

  it('checks references and the code', async () => {
    const { t, admin } = await hospital();
    const bad = await admin
      .post('/departments')
      .send(dept(t, { code: 'bad code!', location: { branchId: '6650aa000000000000000001' } }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.map((d) => d.path)).toContain('code');
    const nurse = await makeUser(t, { username: 'nurse5', roles: ['nurse'] });
    expect(nurse).toBeTruthy();
    expect(
      (await (await signIn(ctx.app, t.host, 'nurse5')).post('/departments').send(dept(t))).status,
    ).toBe(403);
  });
});

describe('branches', () => {
  it('respects the plan limit and needs approval to open', async () => {
    const { t, admin, sa } = await hospital();
    const input = { name: 'Wakad Branch', code: 'WKD', address: { city: 'Pune', pin: '411057' } };
    const over = await admin.post('/branches').send(input);
    expect(over.status).toBe(402);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
    await Tenant.updateOne({ _id: t.tenant._id }, { $set: { 'limits.branches': 3 } });
    const created = await admin.post('/branches').send(input);
    expect(created.status).toBe(202);
    await approve(sa, created.body.approvalId);
    const list = (await admin.get('/branches')).body;
    expect(list.find((b) => b.code === 'WKD').status).toBe('ACTIVE');
  });

  it('refuses to close the only branch', async () => {
    const { t, admin } = await hospital();
    const main = (await admin.get('/branches')).body[0];
    const res = await admin
      .post(`/branches/${main.id}/close`)
      .send({ version: main.version, reason: 'Moving' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.map((d) => d.message).join(' ')).toMatch(/only active branch/);
    expect(t).toBeTruthy();
  });
});

describe('masters and tariffs', () => {
  it('validates GST rates and keeps one default price list', async () => {
    const { admin } = await hospital();
    expect(
      (
        await admin
          .post('/masters/tax-codes')
          .send({ code: 'GST12', name: 'GST 12%', kind: 'GST', rate: 12 })
      ).status,
    ).toBe(422);
    const corp = await admin
      .post('/masters/price-lists')
      .send({ code: 'CORP', name: 'Corporate', kind: 'CORPORATE', isDefault: true });
    expect(corp.status).toBe(201);
    const lists = (await admin.get('/masters/price-lists')).body.items;
    expect(lists.filter((l) => l.isDefault).map((l) => l.code)).toEqual(['CORP']);
  });

  it('holds new services and rate changes until the Super Admin approves', async () => {
    const { admin, sa } = await hospital();
    const created = await admin.post('/masters/services').send({
      code: 'CONS-GEN',
      name: 'General consultation',
      category: 'CONSULTATION',
      taxCode: 'EXEMPT',
      rates: { GENERAL: 500, SENIOR: 400 },
    });
    expect(created.status).toBe(202);
    expect(created.body.item.status).toBe('PENDING_APPROVAL');
    const a = (await sa.get(`/approvals/${created.body.approvalId}`)).body;
    expect(a.after['CONS-GEN']).toEqual({ GENERAL: '₹500.00', SENIOR: '₹400.00' });
    await approve(sa, created.body.approvalId);
    let svc = (await admin.get('/masters/services?q=CONS')).body.items[0];
    expect(svc).toMatchObject({ status: 'ACTIVE', isActive: true });

    const change = await admin.put(`/masters/services/${svc.id}`).send({
      version: svc.version,
      code: 'CONS-GEN',
      name: 'General consultation',
      category: 'CONSULTATION',
      taxCode: 'EXEMPT',
      rates: { GENERAL: 600, SENIOR: 400 },
    });
    expect(change.status).toBe(202);
    svc = (await admin.get('/masters/services?q=CONS')).body.items[0];
    expect(svc.rates.find((r) => r.amount === 50000)).toBeTruthy();
    expect(svc.pendingRates.find((r) => r.amount === 60000)).toBeTruthy();
    await approve(sa, change.body.approvalId);
    svc = (await admin.get('/masters/services?q=CONS')).body.items[0];
    expect(svc.rates.find((r) => r.amount === 60000)).toBeTruthy();
    expect(svc.pendingRates).toBeUndefined();
  });

  it('describes wards and beds, payers and doctors', async () => {
    const { t, admin, sa } = await hospital();
    const d = await admin.post('/departments').send(dept(t));
    await approve(sa, d.body.approvalId);
    const bedDay = await admin.post('/masters/services').send({
      code: 'BED-GEN',
      name: 'Bed charge, general ward',
      category: 'BED',
      taxCode: 'EXEMPT',
      rates: { GENERAL: 1500 },
    });
    expect(
      (
        await admin.post('/masters/wards').send({
          code: 'GW1',
          name: 'General ward 1',
          branchCode: 'MAIN',
          category: 'GENERAL',
          bedServiceCode: 'BED-GEN',
        })
      ).body.error.details[0].path,
    ).toBe('bedServiceCode'); // the bed tariff is not approved yet
    await approve(sa, bedDay.body.approvalId);
    const ward = await admin.post('/masters/wards').send({
      code: 'GW1',
      name: 'General ward 1',
      branchCode: 'MAIN',
      floor: '1',
      category: 'GENERAL',
      gender: 'FEMALE',
      bedServiceCode: 'BED-GEN',
      departmentCode: 'CARD',
    });
    expect(ward.status).toBe(201);
    expect(ward.body.item).toMatchObject({ branchId: String(t.branch._id), gender: 'FEMALE' });
    for (const n of [1, 2])
      expect(
        (
          await admin
            .post('/masters/beds')
            .send({ code: `GW1-0${n}`, name: `Bed ${n}`, wardCode: 'GW1', room: '101' })
        ).status,
      ).toBe(201);
    const beds = (await admin.get(`/masters/beds?wardId=${ward.body.item.id}`)).body;
    expect(beds.total).toBe(2);
    expect(beds.items[0]).toMatchObject({
      wardId: ward.body.item.id,
      branchId: String(t.branch._id),
    });

    const payer = await admin.post('/masters/payers').send({
      code: 'TATA',
      name: 'Tata Motors Ltd',
      kind: 'CORPORATE',
      priceListCode: 'GENERAL',
      creditLimit: 500000,
      creditDays: 45,
      email: 'hr@tata.example',
    });
    expect(payer.status).toBe(201);
    expect(payer.body.item).toMatchObject({ creditLimit: 50000000, creditDays: 45 });
    expect((await admin.get('/masters/payers?kind=CORPORATE')).body.total).toBe(1);
    expect((await admin.get('/masters/payers?kind=INSURER')).body.total).toBe(0);

    await makeUser(t, { username: 'drmeera', roles: ['doctor'] });
    const doc = await admin.post('/masters/doctors').send({
      code: 'DR-MI',
      name: 'Dr. Meera Iyer',
      kind: 'FULL_TIME',
      departmentCode: 'CARD',
      registrationNo: 'MMC-2011-04567',
      username: 'drmeera',
    });
    expect(doc.status).toBe(201);
    expect(doc.body.item.userId).toBeTruthy();
    const unknown = await admin.post('/masters/doctors').send({
      code: 'DR-X',
      name: 'Dr. Unknown',
      kind: 'VISITING',
      departmentCode: 'CARD',
      registrationNo: 'KMC-1',
      username: 'nobody',
    });
    expect(unknown.body.error.details[0].path).toBe('username');
  });

  it('imports a CSV with a preview, refuses rows with errors and saves all valid rows at once', async () => {
    const { admin } = await hospital();
    const bad =
      'Code,Name,Kind,Phone\nDRSHAH,Dr. Shah Clinic,DOCTOR,9800000000\nBAD!,X,NOPE,\nDRSHAH,Duplicate,DOCTOR,\n';
    const badId = await upload(admin, 'refs.csv', 'text/csv', Buffer.from(bad));
    const preview = await admin.post('/masters/referral-sources/import').send({ fileId: badId });
    expect(preview.status).toBe(200);
    expect(preview.body.summary).toEqual({ rows: 3, new: 1, update: 0, error: 2 });
    const refused = await admin
      .post('/masters/referral-sources/import')
      .send({ fileId: badId, commit: true });
    expect(refused.body.error.code).toBe('IMPORT_HAS_ERRORS');
    expect((await admin.get('/masters/referral-sources?q=DRSHAH')).body.total).toBe(0);

    const good = `${String.fromCharCode(0xfeff)}Code,Name,Kind,Phone\nDRSHAH,"Dr. Shah, Clinic",DOCTOR,9800000000\nWALKIN,Walk in (updated),WALK_IN,\n`;
    const goodId = await upload(admin, 'refs.csv', 'text/csv', Buffer.from(good));
    const saved = await admin
      .post('/masters/referral-sources/import')
      .send({ fileId: goodId, commit: true });
    expect(saved.body.summary).toMatchObject({ new: 1, update: 1, error: 0 });
    expect((await admin.get('/masters/referral-sources?q=DRSHAH')).body.items[0].name).toBe(
      'Dr. Shah, Clinic',
    );
  });

  it('imports services from Excel as one tariff approval', async () => {
    const { admin, sa } = await hospital();
    const tpl = await admin
      .get('/masters/services/template')
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    const ws = wb.worksheets[0];
    const headers = ws.getRow(1).values.slice(1);
    expect(headers).toEqual(expect.arrayContaining(['Code', 'Name', 'Rate GENERAL', 'Rate STAFF']));
    const rowOf = (vals) => headers.map((h) => vals[h] ?? null);
    ws.addRow(
      rowOf({
        Code: 'ECG',
        Name: 'ECG',
        Category: 'PROCEDURE',
        'Tax code': 'EXEMPT',
        'Rate GENERAL': 300,
      }),
    );
    ws.addRow(
      rowOf({
        Code: 'XRAY-CH',
        Name: 'X-ray chest',
        Category: 'RAD',
        'Tax code': 'EXEMPT',
        'Rate GENERAL': 450,
        'Rate STAFF': 225,
      }),
    );
    const fileId = await upload(
      admin,
      'services.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Buffer.from(await wb.xlsx.writeBuffer()),
    );
    const saved = await admin
      .post('/masters/services/import')
      .send({ fileId, commit: true, reason: 'Go-live tariff' });
    expect(saved.status).toBe(202);
    expect((await admin.get('/masters/services?active=true')).body.total).toBe(0);
    await approve(sa, saved.body.approvalId);
    const active = (await admin.get('/masters/services?active=true')).body.items
      .map((s) => s.code)
      .sort();
    expect(active).toEqual(['ECG', 'XRAY-CH']);
  });
});

describe('numbering', () => {
  it('formats configured series and keeps UHIDs permanent', async () => {
    const { t, sa } = await hospital();
    await runAsSystem(t.tenant._id, async () => {
      expect(await numbering.next('OP_BILL', { date: new Date('2026-10-09') })).toBe(
        'OP/26-27/000001',
      );
      expect(await numbering.next('UHID')).toBe('CC0000001');
    });
    expect(
      (
        await sa
          .put('/settings/number-series/OP_BILL')
          .send({ prefix: 'OPB', reset: 'MONTHLY', width: 5 })
      ).status,
    ).toBe(200);
    expect(
      (
        await sa
          .put('/settings/number-series/UHID')
          .send({ prefix: 'CC', reset: 'YEARLY', width: 7 })
      ).status,
    ).toBe(422);
    await runAsSystem(t.tenant._id, async () => {
      expect(await numbering.next('OP_BILL', { date: new Date('2026-10-09') })).toBe(
        'OPB/2610/00001',
      );
    });
  });
});
