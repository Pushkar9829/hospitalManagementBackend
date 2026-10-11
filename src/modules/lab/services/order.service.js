import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber, nextNumber } from '../../../core/sequences/sequence.service.js';
import { current } from '../../../core/tenancy/context.js';
import { financialYear } from '@hms/shared';
import { Bill, createBill } from '../../billing/index.js';
import { Admission, addCharge } from '../../ipd/index.js';
import { Doctor, Service } from '../../setup/index.js';
import { LabItem, LabSample } from '../models/lab.models.js';
import { testForService } from './catalog.service.js';
import { escape, itemOut, me, patientSnap, settingsDoc } from './common.js';
import { openForItem } from './micro.service.js';

const ACTIVE_STAY = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];
const PRIORITY_RANK = { STAT: 0, URGENT: 1, ROUTINE: 2 };
// Billing rule R2 exemptions: credit, corporate, scheme and emergency patients pay later.
const PAY_LATER = ['CORPORATE', 'SCHEME', 'INSURANCE', 'CREDIT'];

/** Minutes allowed from the TAT start for this test and priority (R11). */
async function tatMinutes(item, test) {
  const s = await settingsDoc();
  if (item.priority === 'STAT' || item.priority === 'URGENT') return s.tatMin[item.priority];
  return test?.tatMin ?? s.tatMin.ROUTINE;
}
const addMin = (d, m) => new Date(d.getTime() + m * 60_000);

/** Compact barcode for a container: "S2627000123" (scanner friendly, no separators). */
async function sampleNumber() {
  const fy = financialYear(new Date());
  const n = await nextNumber('LS', { branchId: current().branchId ?? null, fy });
  return `S${fy.replace('-', '')}${String(n).padStart(6, '0')}`;
}

/** One LabItem per test; tests without a lab definition (not category LAB) are skipped. */
async function createItems(base, tests) {
  const orderNo = await documentNumber('LAB');
  const out = [];
  for (const t of tests) {
    const test = await testForService(t.serviceId);
    if (!test) continue;
    out.push({
      ...base,
      orderNo,
      orderedAt: new Date(),
      priority: t.priority ?? base.priority ?? 'ROUTINE',
      testId: test._id,
      serviceId: test.serviceId,
      code: test.code,
      name: test.name,
      department: test.department,
      analyser: test.analyser,
      sensitive: test.sensitive,
    });
  }
  if (!out.length) return { orderNo: null, items: [] };
  const items = await LabItem.create(out, { ordered: true });
  return { orderNo, items };
}

// ---------------------------------------------------------------- orders from OPD and IPD

/** Event opd.visit.completed: the lab tests ordered in the consultation join the worklist. */
export async function fromOpdVisit({ visitId, patientId, doctorId, orders = [] }) {
  if (!orders.length) return null;
  if (await LabItem.exists({ visitId })) return null; // event delivered twice
  const services = await Service.find({
    _id: { $in: orders.map((o) => o.serviceId).filter(Boolean) },
    category: 'LAB',
  })
    .select('_id')
    .lean();
  const lab = new Set(services.map((s) => String(s._id)));
  const tests = orders.filter((o) => o.serviceId && lab.has(String(o.serviceId)));
  if (!tests.length) return null;
  const doctor = doctorId ? await Doctor.findById(doctorId).select('name').lean() : null;
  const { orderNo } = await createItems(
    {
      source: 'OPD',
      visitId,
      location: 'OPD',
      patient: await patientSnap(patientId),
      doctor: doctor ? { id: doctor._id, name: doctor.name } : undefined,
      payerKind: 'CASH',
    },
    tests.map((o) => ({ serviceId: o.serviceId, priority: o.priority })),
  );
  if (orderNo) await publish('lab.order.created', { orderNo, source: 'OPD' });
  return orderNo;
}

/** Event opd.visit.closed: the clinic bill (with the tests) is paid, so collection may start. */
export async function opdVisitClosed({ visitId, billId }) {
  if (!billId) return 0;
  const r = await LabItem.updateMany({ visitId, billId: null }, { $set: { billId } });
  return r.modifiedCount;
}

/**
 * A lab order from the ward (charged to the running IP bill) or the lab counter (walk-in: an OP
 * bill is made now and paid at the billing counter before collection, rule R2).
 */
export async function createOrder(input) {
  const { admissionId, patientId, tests, priority = 'ROUTINE', clinicalNotes } = input;
  const services = await Service.find({ _id: { $in: tests }, category: 'LAB', status: 'ACTIVE' })
    .select('_id name')
    .lean();
  if (services.length !== new Set(tests.map(String)).size)
    throw errors.validation([{ path: 'tests', message: 'Pick lab tests that are approved' }]);

  let base;
  if (admissionId) {
    const a = await Admission.findById(admissionId).lean();
    if (!a) throw errors.notFound('Admission');
    if (!ACTIVE_STAY.includes(a.status))
      throw new AppError(409, 'INVALID_STATE', 'The stay is closed.');
    base = {
      source: 'IPD',
      admissionId: a._id,
      ipNo: a.ipNo,
      location: `${a.bed?.ward ?? ''} ${a.bed?.code ?? ''}`.trim(),
      patient: await patientSnap(a.patient.id),
      doctor: a.consultant?.id ? { id: a.consultant.id, name: a.consultant.name } : undefined,
      payerKind: a.payer?.kind ?? 'CASH',
    };
  } else {
    if (!patientId) throw errors.validation([{ path: 'patientId', message: 'Pick the patient' }]);
    base = { source: 'WALKIN', location: 'Lab counter', patient: await patientSnap(patientId) };
    if (input.doctorId) {
      const d = await Doctor.findById(input.doctorId).select('name').lean();
      if (d) base.doctor = { id: d._id, name: d.name };
    }
    base.payerKind = 'CASH';
  }

  // Edge case: the same test twice in a day needs a reason.
  const since = new Date(Date.now() - 24 * 3_600_000);
  const dupes = await LabItem.find({
    'patient.id': base.patient.id,
    serviceId: { $in: tests },
    orderedAt: { $gte: since },
    status: { $ne: 'CANCELLED' },
  })
    .select('name')
    .lean();
  if (dupes.length && !input.duplicateReason)
    throw new AppError(
      409,
      'DUPLICATE_ORDER',
      `Already ordered today: ${[...new Set(dupes.map((d) => d.name))].join(', ')}. Give a reason to order again.`,
      { tests: dupes.map((d) => d.name) },
    );

  const result = await withTransaction(async () => {
    let billId;
    if (base.source === 'WALKIN') {
      // A draft: the cashier finalises it and takes the payment at the counter (billing R10).
      const bill = await createBill({
        patientId: String(base.patient.id),
        type: 'OP',
        lines: tests.map((s) => ({ serviceId: String(s), qty: 1 })),
        notes: 'Lab tests, counter',
      });
      billId = bill.id;
    }
    const made = await createItems(
      {
        ...base,
        billId,
        priority,
        clinicalNotes: [clinicalNotes, input.duplicateReason && `Repeat: ${input.duplicateReason}`]
          .filter(Boolean)
          .join(' · '),
      },
      tests.map((s) => ({ serviceId: s, priority })),
    );
    return { ...made, billId };
  });
  // In-patient tests land on the running bill (outside the order transaction: it has its own).
  if (base.source === 'IPD') {
    const by = (await me()).name;
    for (const s of tests)
      await addCharge(String(base.admissionId), { serviceId: String(s), source: 'LAB' }, by);
  }
  await publish('lab.order.created', { orderNo: result.orderNo, source: base.source });
  return {
    orderNo: result.orderNo,
    billId: result.billId ? String(result.billId) : null,
    items: result.items.map((i) => itemOut(i.toObject())),
  };
}

export async function cancelItem(id, { reason }) {
  const i = await LabItem.findById(id);
  if (!i) throw errors.notFound('Lab test');
  if (i.status !== 'ORDERED')
    throw new AppError(409, 'INVALID_STATE', 'Only a test not yet collected can be cancelled.');
  i.status = 'CANCELLED';
  i.cancelReason = reason;
  await i.save();
  return itemOut(i.toObject());
}

// ---------------------------------------------------------------- worklists

const STAGES = {
  collect: ['ORDERED'],
  receive: ['COLLECTED'],
  results: ['RECEIVED', 'RESULTED'],
  verify: ['RESULTED'],
  validate: ['VERIFIED'],
  released: ['RELEASED'],
};

/** Worklist rows: STAT first, then the oldest due. */
export async function listItems(q = {}) {
  const filter = {};
  if (q.stage) filter.status = { $in: STAGES[q.stage] ?? [] };
  else if (q.status) filter.status = { $in: q.status.split(',') };
  else filter.status = { $ne: 'CANCELLED' };
  if (q.department) filter.department = q.department;
  // Cultures and histopathology are worked on their own screens, not by direct entry.
  else if (q.stage === 'results') filter.department = { $nin: ['MICROBIOLOGY', 'HISTOPATHOLOGY'] };
  if (q.priority) filter.priority = q.priority;
  if (q.source) filter.source = q.source;
  if (q.patientId) filter['patient.id'] = q.patientId;
  if (q.visitId) filter.visitId = q.visitId;
  if (q.admissionId) filter.admissionId = q.admissionId;
  if (q.orderNo) filter.orderNo = q.orderNo;
  if (q.held) filter.holds = { $elemMatch: { open: true } };
  if (q.q) {
    const rx = new RegExp(escape(q.q), 'i');
    filter.$or = [
      { 'patient.name': rx },
      { 'patient.uhid': rx },
      { orderNo: rx },
      { sampleNo: rx },
      { name: rx },
    ];
  }
  if (q.stage === 'released') {
    const since = new Date(Date.now() - (q.days ?? 2) * 86_400_000);
    filter.releasedAt = { $gte: since };
  }
  const limit = Math.min(q.limit ?? 200, 500);
  const rows = await LabItem.find(filter)
    .sort(q.stage === 'released' ? { releasedAt: -1 } : { orderedAt: 1 })
    .limit(limit)
    .lean();
  if (q.stage !== 'released')
    rows.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        (a.dueAt ?? a.orderedAt) - (b.dueAt ?? b.orderedAt),
    );
  return { items: rows.map(itemOut), total: rows.length, page: 1, limit };
}

export async function getItem(id) {
  const i = await LabItem.findById(id).lean();
  if (!i) throw errors.notFound('Lab test');
  return itemOut(i);
}

/** Counts per stage for the worklist tabs. */
export async function stageCounts() {
  const rows = await LabItem.aggregate([
    { $match: { status: { $nin: ['CANCELLED', 'RELEASED'] } } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const held = await LabItem.countDocuments({
    status: { $in: ['RESULTED', 'VERIFIED'] },
    holds: { $elemMatch: { open: true } },
  });
  return {
    collect: by.ORDERED ?? 0,
    receive: by.COLLECTED ?? 0,
    results: await LabItem.countDocuments({
      status: { $in: ['RECEIVED', 'RESULTED'] },
      department: { $nin: ['MICROBIOLOGY', 'HISTOPATHOLOGY'] },
    }),
    verify: by.RESULTED ?? 0,
    validate: by.VERIFIED ?? 0,
    held,
  };
}

// ---------------------------------------------------------------- collection (R1, R2)

/** Paid, or allowed to pay later (R2): in-patients, credit and corporate payers, STAT. */
async function paymentState(items) {
  const billIds = [
    ...new Set(
      items
        .map((i) => i.billId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const bills = billIds.length
    ? await Bill.find({ _id: { $in: billIds } })
        .select('totals status')
        .lean()
    : [];
  // A draft bill is not paid yet, whatever its balance says.
  const balance = new Map(
    bills.map((b) => [String(b._id), b.status === 'DRAFT' ? 1 : (b.totals?.balance ?? 0)]),
  );
  return (i) => {
    if (i.source === 'IPD' || PAY_LATER.includes(i.payerKind) || i.priority === 'STAT') return 'OK';
    if (!i.billId) return 'UNBILLED';
    return (balance.get(String(i.billId)) ?? 1) > 0 ? 'UNPAID' : 'OK';
  };
}

/** The collection list: tests to collect, grouped by patient order, with their payment state. */
export async function collectionList({ source, q } = {}) {
  const filter = { status: 'ORDERED' };
  if (source) filter.source = source;
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ 'patient.name': rx }, { 'patient.uhid': rx }, { orderNo: rx }, { ipNo: rx }];
  }
  const items = await LabItem.find(filter).sort({ orderedAt: 1 }).limit(500).lean();
  const state = await paymentState(items);
  const groups = new Map();
  for (const i of items) {
    const key = `${i.orderNo}`;
    if (!groups.has(key))
      groups.set(key, {
        orderNo: i.orderNo,
        orderedAt: i.orderedAt,
        source: i.source,
        location: i.location ?? null,
        ipNo: i.ipNo ?? null,
        patient: itemOut(i).patient,
        doctor: i.doctor?.name ?? null,
        priority: i.priority,
        payment: 'OK',
        billId: i.billId ? String(i.billId) : null,
        tests: [],
      });
    const g = groups.get(key);
    const pay = state(i);
    if (pay !== 'OK') g.payment = pay;
    if (PRIORITY_RANK[i.priority] < PRIORITY_RANK[g.priority]) g.priority = i.priority;
    g.tests.push({
      id: String(i._id),
      code: i.code,
      name: i.name,
      recollect: Boolean(i.recollect),
    });
  }
  const rows = [...groups.values()].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.orderedAt - b.orderedAt,
  );
  return { items: rows, total: rows.length, page: 1, limit: 500 };
}

/**
 * Collect: the wristband (or the walk-in's UHID card) is scanned first (R1); unpaid OPD and
 * walk-in tests are refused (R2). One barcode per container; the labels come back to print.
 */
export async function collect({ itemIds, scan }) {
  const items = await LabItem.find({ _id: { $in: itemIds } });
  if (items.length !== itemIds.length) throw errors.notFound('Lab test');
  const patientIds = new Set(items.map((i) => String(i.patient.id)));
  if (patientIds.size !== 1)
    throw errors.validation([{ path: 'itemIds', message: 'Collect one patient at a time' }]);
  if (items.some((i) => i.status !== 'ORDERED'))
    throw new AppError(409, 'INVALID_STATE', 'Some tests are already collected or cancelled.');
  const p = items[0].patient;
  const code = String(scan ?? '')
    .trim()
    .toUpperCase();
  const ids = [p.uhid, items[0].ipNo].filter(Boolean).map((x) => x.toUpperCase());
  if (!ids.includes(code))
    throw new AppError(
      409,
      'WRONG_PATIENT',
      `The wristband does not match ${p.name} (${p.uhid}). Check the patient before collecting.`,
    );
  const state = await paymentState(items.map((i) => i.toObject()));
  const unpaid = items.filter((i) => state(i) !== 'OK');
  if (unpaid.length)
    throw new AppError(
      402,
      'PAYMENT_PENDING',
      `Collect after payment at the counter: ${unpaid.map((i) => i.name).join(', ')}.`,
      { billId: unpaid[0].billId ? String(unpaid[0].billId) : null },
    );

  const tests = new Map(
    (await Promise.all(items.map((i) => testForService(i.serviceId)))).map((t) => [
      String(t._id),
      t,
    ]),
  );
  const by = await me();
  const now = new Date();
  return withTransaction(async () => {
    // One container per sample type and tube colour.
    const groups = new Map();
    for (const i of items) {
      const t = tests.get(String(i.testId));
      const key = `${t?.sampleType}|${t?.container}`;
      if (!groups.has(key))
        groups.set(key, { sampleType: t?.sampleType, container: t?.container, items: [] });
      groups.get(key).items.push(i);
    }
    const labels = [];
    for (const g of groups.values()) {
      const sampleNo = await sampleNumber();
      const priority = g.items.reduce(
        (best, i) => (PRIORITY_RANK[i.priority] < PRIORITY_RANK[best] ? i.priority : best),
        'ROUTINE',
      );
      const [s] = await LabSample.create([
        {
          sampleNo,
          orderNo: g.items[0].orderNo,
          patient: p,
          location: g.items[0].location,
          priority,
          sampleType: g.sampleType,
          container: g.container,
          itemIds: g.items.map((i) => i._id),
          tests: g.items.map((i) => i.code),
          status: 'COLLECTED',
          collectedAt: now,
          collectedBy: by.name,
        },
      ]);
      for (const i of g.items) {
        i.status = 'COLLECTED';
        i.collectedAt = now;
        i.sampleId = s._id;
        i.sampleNo = sampleNo;
        i.recollect = false;
        // R11: in-patient TAT runs from collection.
        if (i.source === 'IPD')
          i.dueAt = addMin(now, await tatMinutes(i, tests.get(String(i.testId))));
        await i.save();
      }
      labels.push({
        sampleNo,
        sampleType: g.sampleType,
        container: g.container,
        priority,
        tests: g.items.map((i) => i.code),
        patient: { name: p.name, uhid: p.uhid, age: p.age, gender: p.gender },
        location: g.items[0].location ?? null,
        collectedAt: now,
      });
    }
    await publish('lab.sample.collected', {
      orderNo: items[0].orderNo,
      samples: labels.map((l) => l.sampleNo),
    });
    return { labels };
  });
}

// ---------------------------------------------------------------- receipt (R3)

const sampleOut = (s) => ({
  id: String(s._id),
  sampleNo: s.sampleNo,
  orderNo: s.orderNo,
  patient: {
    name: s.patient?.name,
    uhid: s.patient?.uhid,
    age: s.patient?.age,
    gender: s.patient?.gender,
  },
  location: s.location ?? null,
  priority: s.priority,
  sampleType: s.sampleType,
  container: s.container,
  tests: s.tests,
  status: s.status,
  collectedAt: s.collectedAt,
  collectedBy: s.collectedBy ?? null,
  receivedAt: s.receivedAt ?? null,
  receivedBy: s.receivedBy ?? null,
  rejectReason: s.rejectReason ?? null,
  rejectNote: s.rejectNote ?? null,
  minutesInTransit: s.collectedAt
    ? Math.round(((s.receivedAt ?? new Date()) - s.collectedAt) / 60000)
    : null,
});

export async function listSamples({ status = 'COLLECTED', q } = {}) {
  const filter = { status: { $in: status.split(',') } };
  if (q) {
    const rx = new RegExp(escape(q), 'i');
    filter.$or = [{ sampleNo: rx }, { 'patient.name': rx }, { 'patient.uhid': rx }];
  }
  const rows = await LabSample.find(filter).sort({ collectedAt: 1 }).limit(300).lean();
  rows.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  return { items: rows.map(sampleOut), total: rows.length, page: 1, limit: 300 };
}

async function findSample(sampleNo) {
  const s = await LabSample.findOne({ sampleNo: String(sampleNo).trim().toUpperCase() });
  if (!s) throw new AppError(404, 'UNKNOWN_SAMPLE', 'No sample has this barcode. Check the label.');
  return s;
}

export async function getSample(sampleNo) {
  return sampleOut((await findSample(sampleNo)).toObject());
}

/** Accession on scan: the sample's tests move to the bench worklists. */
export async function receive(sampleNo) {
  const s = await findSample(sampleNo);
  if (s.status !== 'COLLECTED')
    throw new AppError(409, 'INVALID_STATE', `This sample is already ${s.status.toLowerCase()}.`);
  const by = await me();
  const now = new Date();
  return withTransaction(async () => {
    s.status = 'RECEIVED';
    s.receivedAt = now;
    s.receivedBy = by.name;
    await s.save();
    const items = await LabItem.find({ sampleId: s._id, status: 'COLLECTED' });
    for (const i of items) {
      i.status = 'RECEIVED';
      i.receivedAt = now;
      // R11: walk-in and OPD TAT runs from receipt.
      if (!i.dueAt) i.dueAt = addMin(now, await tatMinutes(i, await testForService(i.serviceId)));
      await i.save();
      await openForItem(i, s); // cultures and histopathology cases have their own benches
    }
    return sampleOut(s.toObject());
  });
}

/** Rejection with a reason (R3): the tests go back to collection, flagged for recollection. */
export async function reject(sampleNo, { reason, note }) {
  const s = await findSample(sampleNo);
  if (!['COLLECTED', 'RECEIVED'].includes(s.status))
    throw new AppError(409, 'INVALID_STATE', `This sample is already ${s.status.toLowerCase()}.`);
  const settings = await settingsDoc();
  if (!settings.rejectReasons.includes(reason))
    throw errors.validation([{ path: 'reason', message: 'Pick a rejection reason' }]);
  const by = await me();
  return withTransaction(async () => {
    s.status = 'REJECTED';
    s.rejectReason = reason;
    s.rejectNote = note;
    s.rejectedAt = new Date();
    s.rejectedBy = by.name;
    await s.save();
    const items = await LabItem.find({
      sampleId: s._id,
      status: { $in: ['COLLECTED', 'RECEIVED'] },
    });
    for (const i of items) {
      i.status = 'ORDERED';
      i.recollect = true;
      i.sampleId = undefined;
      i.sampleNo = undefined;
      i.collectedAt = undefined;
      i.receivedAt = undefined;
      if (i.source !== 'IPD') i.dueAt = undefined;
      await i.save();
    }
    await publish('lab.sample.rejected', {
      sampleNo: s.sampleNo,
      source: items[0]?.source ?? null,
      reason,
      location: s.location,
      patientName: s.patient.name,
      mobile: s.patient.mobile,
      tests: s.tests,
    });
    return sampleOut(s.toObject());
  });
}
