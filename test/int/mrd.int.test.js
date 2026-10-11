import { describe, expect, it } from 'vitest';
import { makeTenant, makeUser, signIn, useIntegration } from '../helpers/int.js';
import { runAsSystem } from '../../src/core/tenancy/context.js';
import { Department, Doctor, PriceList, Service, TaxCode } from '../../src/modules/setup/index.js';
import { Admission, IpdNote } from '../../src/modules/ipd/index.js';
import { openRecord } from '../../src/modules/mrd/services/mrd.service.js';

const ctx = useIntegration();
const DAY = 86_400_000;

async function approve(c, approvalId) {
  const a = (await c.get(`/approvals/${approvalId}`)).body;
  const res = await c
    .post(`/approvals/${approvalId}/decision`)
    .send({ decision: 'APPROVE', version: a.version });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** A hospital with a consultant, MRD staff, the Medical Superintendent and a copy-fee service. */
async function hospital() {
  const t = await makeTenant({ modules: ['OPD', 'IPD', 'MRD'] });
  const docUser = await makeUser(t, { username: 'doc', roles: ['doctor'] });
  await makeUser(t, { username: 'doc2', roles: ['doctor'] });
  for (const [u, r] of [
    ['mrd', 'mrd'],
    ['ms', 'medsupt'],
    ['fo', 'frontoffice'],
  ])
    await makeUser(t, { username: u, roles: [r] });
  const doctorId = await runAsSystem(t.tenant._id, async () => {
    const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
    const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
    await Service.create([
      {
        code: 'MRD-COPY',
        name: 'Medical record copy (per page)',
        category: 'OTHER',
        taxCodeId: exempt._id,
        status: 'ACTIVE',
        isActive: true,
        rates: [{ priceListId: general._id, amount: 1000 }],
      },
    ]);
    const [dept] = await Department.create([
      {
        code: 'MED',
        name: 'Medicine',
        type: 'CLINICAL',
        status: 'ACTIVE',
        location: { branchId: t.branch._id },
      },
    ]);
    const [d] = await Doctor.create([
      {
        code: 'DRK',
        name: 'Dr. K. Iyer',
        kind: 'CONSULTANT',
        departmentId: dept._id,
        registrationNo: 'MMC-1',
        userId: docUser._id,
      },
    ]);
    return d._id;
  });
  const c = {};
  for (const u of ['mrd', 'ms', 'fo', 'doc', 'doc2']) c[u] = await signIn(ctx.app, t.host, u);
  const patient = async (first, gender = 'M') =>
    (
      await c.fo.post('/patients').send({
        registrationType: 'QUICK',
        name: { first, last: 'Patil' },
        gender,
        mobile: '9876543210',
        birth: { age: { years: 52 } },
        category: 'GENERAL',
        confirmNotDuplicate: true,
      })
    ).body;
  /** A discharged stay written straight into IPD (the IPD flow has its own tests). */
  const stay = (p, { outcome = 'NORMAL', signed = true, days = 4, mccd } = {}) =>
    runAsSystem(t.tenant._id, async () => {
      const left = new Date(Date.now() - DAY);
      const [a] = await Admission.create([
        {
          ipNo: `IP${Math.random().toString().slice(2, 8)}`,
          patient: { id: p.id, uhid: p.uhid, name: p.name.full, gender: p.gender, age: '52 y' },
          consultant: { id: doctorId, name: 'Dr. K. Iyer' },
          reason: 'Chest pain',
          bed: { code: 'GW-01', ward: 'General Ward' },
          status: 'DISCHARGED',
          outcome,
          admittedAt: new Date(left.getTime() - days * DAY),
          leftAt: left,
          summary: {
            status: signed ? 'SIGNED' : 'DRAFT',
            diagnoses: [{ code: 'I20.9', name: 'Angina pectoris, unspecified' }],
            ...(mccd ? { death: { at: left, cause: 'Cardiac arrest', mccdNo: mccd } } : {}),
          },
        },
      ]);
      await IpdNote.create(
        (signed
          ? ['NURSING_ADMISSION', 'DOCTOR_INITIAL', 'PROGRESS']
          : ['NURSING_ADMISSION', 'PROGRESS']
        ).map((kind) => ({
          admissionId: a._id,
          kind,
          text: 'Noted',
          at: a.admittedAt,
        })),
      );
      return openRecord({ admissionId: String(a._id) });
    });
  return { t, c, patient, stay };
}

describe('MRD (Phase 6)', () => {
  it('completes, codes and closes a record; doctors see only their deficiencies', async () => {
    const { t, c, patient, stay } = await hospital();
    const p = await patient('Mohan');
    const rec = await stay(p, { signed: false });
    expect(await stay(p, { signed: false }).then(() => 'second stay')).toBe('second stay');
    // opening twice for the same stay is a no-op
    expect(
      await runAsSystem(t.tenant._id, () => openRecord({ admissionId: String(rec.admissionId) })),
    ).toBeNull();

    const r = (await c.mrd.get(`/mrd/records/${rec._id}`)).body;
    expect(r.status).toBe('DEFICIENT');
    expect(r.checklist.filter((x) => !x.ok).map((x) => x.code)).toEqual([
      'SUMMARY',
      'DOCTOR_INITIAL',
    ]);

    // The consultant sees their deficiencies; another doctor sees none
    const mine = (await c.doc.get('/mrd/deficiencies')).body.items;
    expect(mine[0]).toMatchObject({ doctor: 'Dr. K. Iyer', records: 2, items: 4 });
    expect((await c.doc2.get('/mrd/deficiencies')).body.items).toEqual([]);
    expect((await c.doc2.get('/mrd/records')).body.total).toBe(0);

    // Coding is refused while deficiencies are open
    const early = await c.mrd.post(`/mrd/records/${r.id}/coding`).send({
      diagnoses: [{ code: 'I20.9', name: 'Angina pectoris, unspecified', primary: true }],
    });
    expect(early.body.error.code).toBe('RECORD_INCOMPLETE');

    // The doctor signs the summary and writes the initial note; a recheck clears both
    await runAsSystem(t.tenant._id, async () => {
      await Admission.updateOne({ _id: r.admissionId }, { $set: { 'summary.status': 'SIGNED' } });
      await IpdNote.create([
        { admissionId: r.admissionId, kind: 'DOCTOR_INITIAL', text: 'Seen', at: new Date() },
      ]);
    });
    const re = (await c.doc.post(`/mrd/records/${r.id}/recheck`)).body;
    expect(re.status).toBe('CODING');
    expect(re.checklist.find((x) => x.code === 'SUMMARY').resolvedBy).toBe('User doc');

    const bad = await c.mrd.post(`/mrd/records/${r.id}/coding`).send({
      diagnoses: [{ code: 'I20.9', name: 'Angina', primary: false }],
    });
    expect(bad.status).toBe(422);
    expect((await c.mrd.get('/mrd/icd10?q=angina')).body.items[0].code).toBe('I20.9');
    const closed = await c.mrd.post(`/mrd/records/${r.id}/coding`).send({
      diagnoses: [
        { code: 'I20.9', name: 'Angina pectoris, unspecified', primary: true },
        { code: 'I10', name: 'Essential (primary) hypertension' },
      ],
      procedures: [{ code: 'CAG', name: 'Coronary angiography' }],
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', codedBy: 'User mrd' });

    // Paper file: register, issue, refuse a second issue, return
    await c.mrd
      .post(`/mrd/records/${r.id}/file`)
      .send({ action: 'REGISTER', fileNo: 'F-101', rack: 'R2' });
    const out = (
      await c.mrd.post(`/mrd/records/${r.id}/file`).send({ action: 'ISSUE', to: 'Dr. K. Iyer' })
    ).body;
    expect(out.file).toMatchObject({ status: 'OUT', issuedTo: 'Dr. K. Iyer', overdue: false });
    expect(
      (await c.mrd.post(`/mrd/records/${r.id}/file`).send({ action: 'ISSUE', to: 'Audit' })).body
        .error.code,
    ).toBe('FILE_OUT');
    const back = (await c.mrd.post(`/mrd/records/${r.id}/file`).send({ action: 'RETURN' })).body;
    expect(back.file.status).toBe('IN');
    expect(back.file.history.map((h) => h.action)).toEqual(['REGISTER', 'ISSUE', 'RETURN']);
  });

  it('releases a copy only after the Medical Superintendent approves, and bills the fee', async () => {
    const { t, c, patient, stay } = await hospital();
    const p = await patient('Ramesh');
    const rec = await stay(p);
    expect(rec.status).toBe('CODING');

    const noAuth = await c.mrd.post('/mrd/releases').send({
      recordId: String(rec._id),
      requester: { kind: 'INSURER', name: 'Star Health', idProof: 'Letter 7781' },
      purpose: 'Claim processing',
      pages: 12,
    });
    expect(noAuth.status).toBe(422);
    const req = await c.mrd.post('/mrd/releases').send({
      recordId: String(rec._id),
      requester: {
        kind: 'INSURER',
        name: 'Star Health',
        idProof: 'Letter 7781',
        authorisation: 'Patient consent dated today',
      },
      purpose: 'Claim processing',
      pages: 12,
    });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    expect(req.body).toMatchObject({ status: 'PENDING_APPROVAL', fee: 12000 });
    expect((await c.mrd.post(`/mrd/releases/${req.body.id}/release`)).body.error.code).toBe(
      'INVALID_STATE',
    );
    await approve(c.ms, req.body.approvalId);
    const done = await c.mrd.post(`/mrd/releases/${req.body.id}/release`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({
      status: 'RELEASED',
      copyNo: expect.stringMatching(/^CERTIFIED COPY ROI\//),
    });
    const bill = (await (await signIn(ctx.app, t.host)).get(`/billing/bills/${done.body.billId}`))
      .body;
    expect(bill).toMatchObject({ status: 'DRAFT' });
    expect(bill.lines[0]).toMatchObject({ qty: 12 });
  });

  it('keeps the birth, death and MLC registers with CRS due dates and computes statistics', async () => {
    const { c, patient, stay } = await hospital();
    const mother = await patient('Sunita', 'F');
    const b = await c.mrd.post('/mrd/births').send({
      motherId: mother.id,
      fatherName: 'Rajesh Patil',
      bornAt: new Date(Date.now() - 25 * DAY).toISOString(),
      sex: 'F',
      weightGrams: 2900,
      deliveryType: 'NORMAL',
      place: 'Labour room',
    });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body).toMatchObject({ regNo: expect.stringMatching(/^BR\//), overdue: true });
    const rep = await c.mrd
      .post(`/mrd/births/${b.body.id}/reported`)
      .send({ crsRefNo: 'CRS-2026-5521' });
    expect(rep.body).toMatchObject({ overdue: false, crsRefNo: 'CRS-2026-5521' });

    const dead = await patient('Gopal');
    const rec = await stay(dead, { outcome: 'DEATH', mccd: 'MCCD-77' });
    expect(rec.checklist.find((x) => x.code === 'MCCD').ok).toBe(true);
    const mlc = await c.mrd.post('/mrd/mlc').send({
      patientId: dead.id,
      admissionId: String(rec.admissionId),
      nature: 'ROAD_ACCIDENT',
      policeStation: 'Shivajinagar',
      intimatedAt: new Date().toISOString(),
      officer: { name: 'PSI Jadhav' },
    });
    expect(mlc.body.mlcNo).toMatch(/^MLC\//);
    const d = await c.mrd.post('/mrd/deaths').send({
      patientId: dead.id,
      admissionId: String(rec.admissionId),
      diedAt: new Date(Date.now() - DAY).toISOString(),
      cause: { immediate: 'Cardiac arrest', underlying: 'Head injury', icd: 'S06.9' },
      mccdNo: 'MCCD-77',
      certifiedBy: 'Dr. K. Iyer',
      mortuarySlot: 'M-2',
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body.mlc).toBe(true); // the stay became medico-legal
    expect(
      (await c.mrd.post('/mrd/deaths').send({ ...d.body, patientId: dead.id })).status,
    ).not.toBe(201);
    const toFamily = await c.mrd
      .post(`/mrd/deaths/${d.body.id}/handover`)
      .send({ handedTo: 'Ravi Patil', relation: 'Son', idProof: 'Aadhaar 4421' });
    expect(toFamily.body.error.code).toBe('MLC_POLICE_ONLY');
    const toPolice = await c.mrd.post(`/mrd/deaths/${d.body.id}/handover`).send({
      handedTo: 'PSI Jadhav',
      idProof: 'Badge 5512',
      toPolice: true,
    });
    expect(toPolice.body.mortuary).toMatchObject({ handedTo: 'PSI Jadhav', slot: 'M-2' });

    await stay(await patient('Asha', 'F'), { days: 2 });
    const month = new Date(Date.now() + 330 * 60_000 - DAY).toISOString().slice(0, 7);
    const st = (await c.mrd.get(`/mrd/statistics?month=${month}`)).body;
    expect(st.discharges).toBeGreaterThanOrEqual(2);
    expect(st.outcomes.DEATH).toBeGreaterThanOrEqual(1);
    expect(st.averageLos).toBeGreaterThan(0);
    expect(st.grossDeathRate).toBeGreaterThan(0);
  });
});
