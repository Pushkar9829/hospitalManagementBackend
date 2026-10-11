/**
 * Support modules demo (called by seed-dev.js; each part skips once its data exists).
 * MRD: three discharged stays (one complete, one with deficiencies, one closed with codes), the
 * copy-fee service, a birth due for the CRS report and a medico-legal case.
 */
import { current, runAsSystem, runInContext } from '../src/core/tenancy/context.js';
import { Patient } from '../src/modules/patients/index.js';
import {
  Doctor,
  PriceList,
  ReferralSource,
  Service,
  TaxCode,
  numbering,
} from '../src/modules/setup/index.js';
import { Admission, IpdNote } from '../src/modules/ipd/index.js';
import { BirthRecord, MrdRecord } from '../src/modules/mrd/index.js';
import { MlcCase } from '../src/modules/mrd/models/mrd.models.js';
import { openRecord } from '../src/modules/mrd/services/mrd.service.js';
import { documentNumber } from '../src/core/sequences/sequence.service.js';
import { DietOrder } from '../src/modules/diet/index.js';
import { Asset } from '../src/modules/facility/index.js';
import * as fac from '../src/modules/facility/services/facility.service.js';
import { Incident } from '../src/modules/quality/index.js';
import { Feedback } from '../src/modules/quality/models/quality.models.js';
import * as qlt from '../src/modules/quality/services/quality.service.js';
import { Lead } from '../src/modules/crm/index.js';
import * as crm from '../src/modules/crm/services/crm.service.js';
import { onAdmitted, setNbm, setOrder } from '../src/modules/diet/services/diet.service.js';

const DAY = 86_400_000;
const fullName = (n) => [n.first, n.last].filter(Boolean).join(' ');

async function seedMrd({ branch }) {
  if (await MrdRecord.exists({})) return false;
  const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
  const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
  if (!(await Service.exists({ code: 'MRD-COPY' })))
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
  const doctor = await Doctor.findOne({ userId: { $ne: null } }).lean();
  const patients = await Patient.find({ status: 'ACTIVE' }).sort({ createdAt: 1 }).limit(6).lean();
  if (patients.length < 4 || !doctor) return false;
  const stays = [
    { days: 5, ago: 2, complete: true, dx: ['I20.9', 'Angina pectoris, unspecified'] },
    { days: 3, ago: 1, complete: false, dx: ['J18.9', 'Pneumonia, unspecified organism'] },
    {
      days: 6,
      ago: 9,
      complete: true,
      dx: ['E11.9', 'Type 2 diabetes mellitus without complications'],
      close: true,
    },
  ];
  for (const [i, s] of stays.entries()) {
    const p = patients[i + 3] ?? patients[i];
    const left = new Date(Date.now() - s.ago * DAY);
    const [a] = await Admission.create([
      {
        ipNo: await numbering.next('IP'),
        branchId: branch._id,
        patient: {
          id: p._id,
          uhid: p.uhid,
          name: fullName(p.name),
          gender: p.gender,
          mobile: p.mobile,
        },
        consultant: { id: doctor._id, name: doctor.name },
        reason: s.dx[1],
        bed: { code: `GW-1${i}`, ward: 'General Ward' },
        status: 'DISCHARGED',
        outcome: 'NORMAL',
        admittedAt: new Date(left.getTime() - s.days * DAY),
        leftAt: left,
        summary: {
          status: s.complete ? 'SIGNED' : 'DRAFT',
          diagnoses: [{ code: s.dx[0], name: s.dx[1] }],
          signedBy: s.complete ? doctor.name : undefined,
        },
      },
    ]);
    const kinds = s.complete
      ? ['NURSING_ADMISSION', 'DOCTOR_INITIAL', 'PROGRESS']
      : ['NURSING_ADMISSION', 'PROGRESS'];
    await IpdNote.create(
      kinds.map((kind) => ({ admissionId: a._id, kind, text: 'Recorded', at: a.admittedAt })),
    );
    const r = await openRecord({ admissionId: String(a._id) });
    if (s.close) {
      r.diagnoses = [{ code: s.dx[0], name: s.dx[1], primary: true }];
      r.status = 'CLOSED';
      r.codedBy = 'Demo MRD officer';
      r.codedAt = new Date();
      r.file = { fileNo: 'F-0001', rack: 'R1', status: 'IN', history: [] };
      await r.save();
    }
  }
  const mother = patients.find((p) => p.gender === 'F') ?? patients[0];
  const born = new Date(Date.now() - 4 * DAY);
  await BirthRecord.create([
    {
      regNo: await documentNumber('BR'),
      mother: { id: mother._id, uhid: mother.uhid, name: fullName(mother.name), gender: 'F' },
      fatherName: 'Prakash Shinde',
      bornAt: born,
      sex: 'M',
      weightGrams: 3150,
      deliveryType: 'NORMAL',
      place: 'Labour room',
      crsDueBy: new Date(born.getTime() + 21 * DAY),
      recordedBy: 'Demo seed',
    },
  ]);
  const injured = patients[1];
  await MlcCase.create([
    {
      mlcNo: await documentNumber('MLC'),
      patient: { id: injured._id, uhid: injured.uhid, name: fullName(injured.name) },
      at: new Date(Date.now() - 3 * DAY),
      nature: 'ROAD_ACCIDENT',
      broughtBy: '108 ambulance',
      policeStation: 'Shivajinagar',
      intimatedAt: new Date(Date.now() - 3 * DAY),
      officer: { name: 'PSI S. Jadhav' },
      injuries: 'Abrasions over left forearm; no head injury',
      recordedBy: 'Demo seed',
    },
  ]);
  return true;
}

/** Diet: meal services, a default diet for every in-patient, one diabetic and one NBM. */
async function seedDiet() {
  if (await DietOrder.exists({})) return false;
  const general = await PriceList.findOne({ code: 'GENERAL' }).lean();
  const exempt = await TaxCode.findOne({ code: 'EXEMPT' }).lean();
  for (const [code, name, amount] of [
    ['DIET-MEAL', 'Patient meal (private room)', 15000],
    ['DIET-ATTENDANT', 'Attendant meal', 10000],
  ])
    if (!(await Service.exists({ code })))
      await Service.create([
        {
          code,
          name,
          category: 'OTHER',
          taxCodeId: exempt._id,
          status: 'ACTIVE',
          isActive: true,
          rates: [{ priceListId: general._id, amount }],
        },
      ]);
  const stays = await Admission.find({ status: { $ne: 'DISCHARGED' } })
    .sort({ admittedAt: 1 })
    .lean();
  for (const a of stays) await onAdmitted({ admissionId: String(a._id) });
  if (stays[0])
    await setOrder(String(stays[0]._id), {
      diet: 'DIABETIC',
      special: 'No sugar in tea',
      attendantMeals: true,
      source: 'DIETITIAN',
    });
  if (stays[1]) {
    const tomorrow = new Date(Date.now() + 330 * 60_000 + DAY).toISOString().slice(0, 10);
    await setNbm(String(stays[1]._id), {
      from: `${tomorrow}T00:00:00+05:30`,
      to: `${tomorrow}T13:00:00+05:30`,
      reason: 'Ultrasound abdomen',
    });
  }
  return stays.length > 0;
}

const ymdIn = (days) => new Date(Date.now() + 330 * 60_000 + days * DAY).toISOString().slice(0, 10);

/** Facility: cleaning schedules, linen par and stock, equipment (one under repair), waste. */
async function seedFacility() {
  if (await Asset.exists({})) return false;
  await fac.createSchedule({
    area: 'General Ward',
    kind: 'WARD',
    times: ['07:00', '15:00', '23:00'],
    checklist: ['Floor mopped', 'Bed rails wiped', 'Bins emptied', 'Sharps box checked'],
    assignee: 'Housekeeping team A',
  });
  await fac.createSchedule({
    area: 'ICU',
    kind: 'ICU',
    times: ['06:00', '14:00', '22:00'],
    checklist: ['High-touch surfaces disinfected', 'Floor mopped', 'Bins emptied'],
  });
  await fac.saveSettings({
    par: [
      { ward: 'General Ward', code: 'BEDSHEET', qty: 60 },
      { ward: 'General Ward', code: 'PILLOW', qty: 40 },
      { ward: 'ICU', code: 'BEDSHEET', qty: 30 },
    ],
    wasteFacility: 'Pune Common BMW Treatment Facility',
  });
  await fac.issueLinen({
    ward: 'General Ward',
    lines: [
      { code: 'BEDSHEET', qty: 60 },
      { code: 'PILLOW', qty: 40 },
    ],
  });
  await fac.issueLinen({ ward: 'ICU', lines: [{ code: 'BEDSHEET', qty: 30 }] });
  await fac.sendLaundry({
    ward: 'General Ward',
    lines: [
      { code: 'BEDSHEET', qty: 18 },
      { code: 'PILLOW', qty: 9 },
    ],
  });
  const vent = await fac.createAsset({
    code: 'VENT-01',
    name: 'Ventilator',
    category: 'BIOMEDICAL',
    make: 'Hamilton',
    model: 'C1',
    serialNo: 'HAM-77812',
    location: 'ICU bed 4',
    riskClass: 'A',
    pmEveryDays: 90,
    calibrationEveryDays: 180,
    amc: { vendor: 'Hamilton Services', kind: 'CMC', from: ymdIn(-320), until: ymdIn(45) },
  });
  await fac.createAsset({
    code: 'MON-03',
    name: 'Multipara monitor',
    category: 'BIOMEDICAL',
    serialNo: 'PHL-30091',
    location: 'General Ward GW-03',
    riskClass: 'B',
    pmEveryDays: 180,
  });
  await Asset.updateOne(
    { code: 'MON-03' },
    { $set: { nextPmDue: new Date(Date.now() - 5 * DAY) } },
  );
  await fac.createAsset({
    code: 'AC-ICU-1',
    name: 'ICU air conditioner',
    category: 'HVAC',
    location: 'ICU',
    riskClass: 'C',
    pmEveryDays: 90,
  });
  await fac.raiseTicket({
    category: 'BIOMEDICAL',
    priority: 'NORMAL',
    location: 'ICU bed 4',
    description: 'High pressure alarm keeps sounding',
    assetId: vent.id,
    breakdown: true,
  });
  await fac.raiseTicket({
    category: 'PLUMBING',
    priority: 'NORMAL',
    location: 'General Ward toilet 2',
    description: 'Tap leaking',
  });
  await fac.recordWaste({ ward: 'General Ward', yellow: 3.4, red: 1.6, white: 0.4, blue: 0.5 });
  await fac.recordWaste({ ward: 'ICU', yellow: 5.2, red: 2.8, white: 0.7, blue: 0.2 });
  await fac.requestPorter({
    patient: { name: 'Neeta Shah' },
    from: 'General Ward GW-02',
    to: 'Radiology',
    mode: 'WHEELCHAIR',
  });
  return true;
}

/** Quality: incidents, complaints, answered feedback, an audit, documents, infection data. */
async function seedQuality() {
  if (await Incident.exists({})) return false;
  const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  const fall = await qlt.reportIncident({
    type: 'FALL',
    severity: 'MILD',
    occurredAt: iso(30),
    location: 'General Ward GW-03',
    description: 'Patient slipped on the way to the toilet at 02:00; bruise on the left elbow.',
    immediateAction: 'Seen by the duty doctor; X-ray normal.',
  });
  await qlt.investigate(fall.id, {
    investigator: 'Nursing superintendent',
    rootCause: 'Wet floor after mopping and no night light near the toilet.',
    actions: [
      {
        text: 'Fit night lights in all ward toilets',
        kind: 'CORRECTIVE',
        owner: 'Facility',
        dueOn: ymdIn(7),
      },
      {
        text: 'Falls risk score each shift for sedated patients',
        kind: 'PREVENTIVE',
        owner: 'Nursing',
        dueOn: ymdIn(14),
      },
    ],
  });
  await qlt.reportIncident(
    {
      type: 'MEDICATION_ERROR',
      severity: 'NO_HARM',
      occurredAt: iso(8),
      location: 'ICU',
      description: 'Insulin dose charted for 08:00 given at 10:00; picked up at the next check.',
    },
    { anonymous: true },
  );
  await qlt.reportIncident({
    type: 'NEEDLE_STICK',
    severity: 'MILD',
    occurredAt: iso(50),
    location: 'Sample collection',
    description: 'Phlebotomist pricked by a used needle while recapping.',
    immediateAction: 'Washed, reported to infection control; baseline tests sent.',
  });
  await qlt.createComplaint({
    source: 'FRONT_OFFICE',
    contactName: 'Sunita Patil',
    contactMobile: '9822001122',
    category: 'WAITING',
    priority: 'NORMAL',
    description: 'Waited 90 minutes after the appointment time to see the doctor.',
  });
  const answers = [
    ['Cardiology', 5, 10, 'Doctor explained everything clearly.'],
    ['Cardiology', 4, 9, null],
    ['General Medicine', 3, 7, 'Billing counter was slow.'],
    ['Orthopaedics', 5, 9, null],
    ['General Medicine', 2, 3, 'Toilet was not clean.'],
  ];
  for (const [i, [department, overall, nps, comment]] of answers.entries()) {
    const token = `${'d'.repeat(30)}${String(i).padStart(2, '0')}`;
    await Feedback.create([
      {
        token,
        source: 'OPD',
        refId: `demo-${i}`,
        department,
        sentAt: new Date(),
        patient: { name: 'Demo patient' },
      },
    ]);
    await qlt.submitFeedback(token, {
      overall,
      doctor: overall,
      nps,
      comment: comment ?? undefined,
    });
  }
  const tpl = (await qlt.listTemplates()).items.find((x) => x.code === 'HAND_HYGIENE');
  await qlt.recordAudit({
    templateCode: 'HAND_HYGIENE',
    area: 'ICU',
    answers: tpl.items.map((item, i) => ({ item, result: i === 2 ? 'NO' : 'YES' })),
    actions: [
      { text: 'Refresher on moment 3 for night staff', owner: 'ICU in-charge', dueOn: ymdIn(10) },
    ],
  });
  for (const [code, title, kind] of [
    ['SOP-NS-01', 'Falls prevention', 'SOP'],
    ['POL-IC-01', 'Hand hygiene policy', 'POLICY'],
  ]) {
    const d = await qlt.draftDocument({ code, title, kind, reviewOn: ymdIn(365) });
    await runInContext(
      { ...current(), userId: undefined, userName: 'Quality Manager (demo)' },
      () => qlt.approveDocument(d.id),
    );
  }
  await qlt.saveDeviceDays({
    month: ymdIn(0).slice(0, 7),
    ward: 'ICU',
    catheter: 180,
    centralLine: 60,
    ventilator: 45,
  });
  return true;
}

/** CRM: leads at each stage, a camp with registrations, a campaign draft, plans and a card. */
async function seedCrm() {
  if (await Lead.exists({})) return false;
  const patients = await Patient.find({ status: 'ACTIVE' }).sort({ createdAt: 1 }).limit(6).lean();
  const leads = [
    [
      'Ramesh Jadhav',
      '9822012345',
      'Knee replacement',
      'Orthopaedics',
      'CALL',
      'COUNSELLED',
      285_000_00,
    ],
    [
      'Sunanda Deshmukh',
      '9822054321',
      'Cataract surgery',
      'Ophthalmology',
      'WEBSITE',
      'CONTACTED',
      45_000_00,
    ],
    [
      'Prakash More',
      '9822098765',
      'Executive health check-up',
      'Preventive health',
      'CAMPAIGN',
      'NEW',
      6_500_00,
    ],
    [
      'Lata Kulkarni',
      '9822011122',
      'Hysterectomy',
      'Obstetrics and Gynaecology',
      'REFERRAL',
      'BOOKED',
      95_000_00,
    ],
  ];
  for (const [name, mobile, interest, department, source, stage, estimate] of leads) {
    const l = await crm.createLead({
      name,
      mobile,
      interest,
      department,
      source,
      estimate,
      nextFollowUp: ymdIn(0),
    });
    if (stage !== 'NEW') await crm.updateLead(l.id, { stage, note: 'Spoke to the patient' });
  }
  const camp = await crm.createCamp({
    name: 'Free diabetes and BP camp, Kothrud',
    date: ymdIn(-3),
    venue: 'Kothrud community hall',
    partner: 'Rotary Club',
    screenings: ['BP', 'RBS', 'BMI'],
    cost: 18_000_00,
  });
  for (const [name, mobile, age, results, followUp] of [
    ['Suresh Pawar', '9811122233', 58, { BP: '156/98', RBS: 232 }, true],
    ['Asha Kale', '9811122244', 46, { BP: '122/80', RBS: 104 }, false],
    ['Dinesh Gore', '9811122255', 63, { BP: '148/92', RBS: 188 }, true],
  ])
    await crm.registerAtCamp(camp.id, {
      name,
      mobile,
      age,
      results,
      followUp,
      interest: 'Diabetes consultation',
    });
  await crm.closeCamp(camp.id);
  await crm.createCampaign({
    name: 'HbA1c reminder for diabetics',
    text: 'Your HbA1c test is due. Visit the lab between 8 and 11 am, no appointment needed.',
    audience: { conditions: ['Diabetes'] },
  });
  await crm.createPlan({
    code: 'SILVER',
    name: 'Silver family card',
    price: 999_00,
    maxMembers: 2,
    discountPct: 5,
    freeVisits: 1,
    walletCredit: 0,
  });
  await crm.createPlan({
    code: 'GOLD',
    name: 'Gold family card',
    price: 2_499_00,
    maxMembers: 4,
    discountPct: 10,
    freeVisits: 4,
    walletCredit: 500_00,
  });
  if (patients[0])
    await crm.sell({
      planCode: 'GOLD',
      holderId: String(patients[0]._id),
      memberIds: patients[1] ? [String(patients[1]._id)] : [],
      paymentRef: 'OP/DEMO/000001',
    });
  const src = await ReferralSource.findOne({ isActive: { $ne: false } }).lean();
  if (src) await crm.saveAgreement({ referralSourceId: String(src._id), feePct: 10 });
  return true;
}

export async function seedSupportDemo({ tenant, branch }) {
  return runAsSystem(
    tenant._id,
    async () => {
      const parts = [];
      if (await seedMrd({ branch })) parts.push('MRD');
      if (await seedDiet()) parts.push('diet');
      if (await seedFacility()) parts.push('facility');
      if (await seedQuality()) parts.push('quality');
      if (await seedCrm()) parts.push('CRM');
      return parts;
    },
    { branchId: String(branch._id), userName: 'Demo seed' },
  );
}
