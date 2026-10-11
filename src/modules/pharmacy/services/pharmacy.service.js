import { z } from 'zod';
import { withTransaction } from '../../../core/db/model.js';
import { publish } from '../../../core/events/events.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { documentNumber } from '../../../core/sequences/sequence.service.js';
import { createBill, finalizeBill, receivePayment } from '../../billing/index.js';
import { Admission, syncStayBill } from '../../ipd/index.js';
import { Item, Store, addStock, deduct, pick, userName } from '../../inventory/index.js';
import { Patient, patientCard } from '../../patients/index.js';
import { Doctor } from '../../setup/index.js';
import { Dispense, PharmacyReturn, Prescription } from '../models/pharmacy.models.js';

const ACTIVE_STAY = ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'];
const PER_DAY = {
  OD: 1,
  OD_MORNING: 1,
  BD: 2,
  TDS: 3,
  QID: 4,
  Q6H: 4,
  Q8H: 3,
  HS: 1,
  SOS: 1,
  STAT: 1,
};
const CONTROLLED = ['H1', 'X', 'NARCOTIC'];
const CHILD_DAYS = 12 * 365;

async function patientSnap(patientId) {
  const p = await Patient.findById(patientId).lean();
  if (!p) throw errors.validation([{ path: 'patientId', message: 'Pick the patient' }]);
  const c = patientCard(p);
  return {
    id: p._id,
    uhid: c.uhid,
    name: c.name,
    gender: p.gender,
    age: c.age,
    ageDays: Math.floor((Date.now() - new Date(p.dob).getTime()) / 86_400_000),
    mobile: c.mobile,
  };
}

async function prescriberOf(doctorId) {
  if (!doctorId) return undefined;
  const d = await Doctor.findById(doctorId).select('name registrationNo').lean();
  return d ? { id: d._id, name: d.name, regNo: d.registrationNo } : undefined;
}

/** Units per intake from the dose ("1 tab", "500 mg" with a 500 mg tablet, "5 ml"). */
export function unitsPerDose(dose, item) {
  const n = Number(String(dose ?? '').match(/[\d.]+/)?.[0] ?? 1);
  if (/mg/i.test(dose ?? '') && item?.drug?.strengthMg) return n / item.drug.strengthMg;
  return n || 1;
}

/** Suggested quantity for a line: units per dose × doses a day × days (at least one). */
export function suggestQty(line, item) {
  const per = PER_DAY[line.frequency] ?? 1;
  return Math.max(1, Math.ceil(unitsPerDose(line.dose, item) * per * (line.days || 1)));
}

const rxOut = (r) => ({
  id: String(r._id),
  rxNo: r.rxNo,
  source: r.source,
  visitId: r.visitId ? String(r.visitId) : null,
  admissionId: r.admissionId ? String(r.admissionId) : null,
  location: r.location ?? null,
  patient: {
    id: String(r.patient.id),
    uhid: r.patient.uhid,
    name: r.patient.name,
    gender: r.patient.gender,
    age: r.patient.age,
  },
  child: (r.patient.ageDays ?? CHILD_DAYS) < CHILD_DAYS,
  prescriber: r.prescriber?.name
    ? { name: r.prescriber.name, regNo: r.prescriber.regNo ?? null }
    : null,
  stat: Boolean(r.stat),
  lines: r.lines,
  status: r.status,
  createdAt: r.createdAt,
});

// ---------------------------------------------------------------- the queue

async function linesWithQty(lines) {
  const items = await Item.find({
    code: { $in: lines.map((l) => l.drugId).filter(Boolean) },
  }).lean();
  const byCode = new Map(items.map((i) => [i.code, i]));
  return lines.map((l) => ({ ...l, suggestedQty: suggestQty(l, byCode.get(l.drugId)) }));
}

/** Event opd.visit.completed: the prescription joins the pharmacy queue. */
export async function fromOpdVisit({ visitId, patientId, doctorId, rx = [] }) {
  if (!rx.length || (await Prescription.exists({ visitId }))) return null;
  const [r] = await Prescription.create([
    {
      rxNo: await documentNumber('RX'),
      source: 'OPD',
      visitId,
      location: 'OPD',
      patient: await patientSnap(patientId),
      prescriber: await prescriberOf(doctorId),
      lines: await linesWithQty(rx),
    },
  ]);
  await publish('pharmacy.rx.queued', { rxId: String(r._id), source: 'OPD' });
  return String(r._id);
}

/** Events ipd.medicine.ordered (STAT) and ipd.medicine.verified: an issue for the stay. */
export async function fromWardOrder({ admissionId, line, stat }) {
  if (!line) return null;
  if (await Prescription.exists({ 'lines.orderId': line.orderId })) return null;
  const a = await Admission.findById(admissionId).lean();
  if (!a) return null;
  const [r] = await Prescription.create([
    {
      rxNo: await documentNumber('RX'),
      source: 'IPD',
      admissionId: a._id,
      location: `${a.bed?.ward ?? ''} ${a.bed?.code ?? ''}`.trim(),
      patient: await patientSnap(a.patient.id),
      prescriber: await prescriberOf(a.consultant?.id),
      stat: Boolean(stat),
      lines: await linesWithQty([line]),
    },
  ]);
  await publish('pharmacy.rx.queued', { rxId: String(r._id), source: 'IPD', stat: Boolean(stat) });
  return String(r._id);
}

export async function queue({ status = 'PENDING,PARTIAL', source, q } = {}) {
  const filter = { status: { $in: status.split(',') } };
  if (source) filter.source = source;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ 'patient.name': rx }, { 'patient.uhid': rx }, { rxNo: rx }];
  }
  const rows = await Prescription.find(filter).sort({ stat: -1, createdAt: 1 }).limit(200).lean();
  return { items: rows.map(rxOut), total: rows.length, page: 1, limit: 200 };
}

/** A prescription with each line matched to stock: the item, available quantity, generics. */
export async function getRx(id) {
  const r = await Prescription.findById(id).lean();
  if (!r) throw errors.notFound('Prescription');
  const store = await defaultStore();
  const out = rxOut(r);
  out.lines = await Promise.all(
    r.lines.map(async (l) => {
      const item = l.drugId ? await Item.findOne({ code: l.drugId, isActive: true }).lean() : null;
      const generic = item?.drug?.generic ?? l.generic;
      // Same generic and the same form: a syrup does not replace a tablet.
      const form = item?.drug?.form;
      const alternatives = generic
        ? await Item.find({
            'drug.generic': generic,
            ...(form ? { 'drug.form': form } : {}),
            isActive: true,
            _id: { $ne: item?._id },
          })
            .select('code name')
            .lean()
        : [];
      const available = async (it) => (it ? await stockOf(store?._id, it._id) : 0);
      return {
        ...l,
        item: item
          ? {
              id: String(item._id),
              code: item.code,
              name: item.name,
              schedule: item.drug?.schedule ?? 'H',
              unit: item.unit,
            }
          : null,
        available: await available(item),
        alternatives: await Promise.all(
          alternatives.map(async (a) => ({
            id: String(a._id),
            code: a.code,
            name: a.name,
            available: await available(a),
          })),
        ),
      };
    }),
  );
  return { ...out, storeId: store ? String(store._id) : null };
}

async function stockOf(storeId, itemId) {
  if (!storeId) return 0;
  try {
    const alloc = await pick({ storeId, itemId, qty: 1_000_000 });
    return alloc.reduce((s, a) => s + a.qty, 0);
  } catch (e) {
    return e?.details?.available ?? 0;
  }
}

async function defaultStore(storeId) {
  if (storeId) return Store.findById(storeId).lean();
  return Store.findOne({ kind: 'PHARMACY', isActive: true }).sort({ createdAt: 1 }).lean();
}

export async function cancelRx(id, { reason }) {
  const r = await Prescription.findById(id);
  if (!r) throw errors.notFound('Prescription');
  if (r.status !== 'PENDING')
    throw new AppError(409, 'INVALID_STATE', 'Part of it is already dispensed.');
  r.status = 'CANCELLED';
  r.cancelReason = reason;
  await r.save();
  return rxOut(r.toObject());
}

// ---------------------------------------------------------------- dispensing

export const dispenseInput = z.object({
  rxId: z.string().optional(),
  patientId: z.string().optional(),
  admissionId: z.string().optional(),
  storeId: z.string().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string(),
        qty: z.number().int().min(1).max(10000),
        batchNo: z.string().trim().max(30).optional(),
        rxLine: z.number().int().min(0).max(50).optional(), // index of the prescription line
        substituteFor: z.string().trim().max(120).optional(),
        consent: z.boolean().optional(), // doctor's consent to the generic substitute
      }),
    )
    .min(1)
    .max(40),
  prescriber: z
    .object({ name: z.string().trim().min(2).max(80), regNo: z.string().trim().min(3).max(30) })
    .optional(),
  prescriptionCopy: z.boolean().optional(),
  weightKg: z.number().positive().max(250).optional(),
  overrideReason: z.string().trim().max(300).optional(),
  payNow: z
    .object({
      mode: z.string().trim().min(2).max(20),
      reference: z.string().trim().max(60).optional(),
    })
    .optional(),
});

/**
 * Dispense: FEFO batches (expired never), generic substitution only with the doctor's consent,
 * prescriber name and registration for Schedule H1, X and narcotics, the weight-based dose check
 * for children. A sale makes an OP bill at batch MRP (paid now with an open shift, or at the
 * counter); a ward issue goes onto the running IP bill. Stock and bill move in one transaction.
 */
export async function dispense(input) {
  const rx = input.rxId ? await Prescription.findById(input.rxId) : null;
  if (input.rxId && !rx) throw errors.notFound('Prescription');
  if (rx && !['PENDING', 'PARTIAL'].includes(rx.status))
    throw new AppError(409, 'INVALID_STATE', 'This prescription is closed.');
  const admissionId = rx?.admissionId ?? input.admissionId;
  let stay = null;
  if (admissionId) {
    stay = await Admission.findById(admissionId).lean();
    if (!stay || !ACTIVE_STAY.includes(stay.status))
      throw new AppError(409, 'INVALID_STATE', 'The stay is closed; sell at the counter instead.');
  }
  const patientId = rx?.patient.id ?? stay?.patient.id ?? input.patientId;
  if (!patientId) throw errors.validation([{ path: 'patientId', message: 'Pick the patient' }]);
  const patient = rx?.patient ?? (await patientSnap(patientId));
  const store = await defaultStore(input.storeId);
  if (!store)
    throw errors.validation([{ path: 'storeId', message: 'Set up a pharmacy store first' }]);

  const items = await Item.find({
    _id: { $in: input.lines.map((l) => l.itemId) },
    isActive: true,
  }).lean();
  const byId = new Map(items.map((i) => [String(i._id), i]));
  const prescribedItems = rx
    ? await Item.find({ code: { $in: rx.lines.map((l) => l.drugId).filter(Boolean) } }).lean()
    : [];
  const byCode = new Map(prescribedItems.map((i) => [i.code, i]));
  const details = [];
  input.lines.forEach((l, i) => {
    const it = byId.get(l.itemId);
    if (!it)
      return details.push({ path: `lines.${i}.itemId`, message: 'Pick an item from the master' });
    const prescribed = rx && l.rxLine != null ? rx.lines[l.rxLine] : null;
    // Generic substitution: same generic only, and the doctor's consent is recorded.
    if (prescribed?.drugId && prescribed.drugId !== it.code) {
      const prescribedItem = byCode.get(prescribed.drugId);
      const sameForm = !prescribedItem?.drug?.form || prescribedItem.drug.form === it.drug?.form;
      if (
        (prescribed.generic &&
          it.drug?.generic &&
          prescribed.generic.toLowerCase() !== it.drug.generic.toLowerCase()) ||
        !sameForm
      )
        details.push({
          path: `lines.${i}.itemId`,
          message: `${it.name} is not the same generic and form as ${prescribed.brand}`,
        });
      else if (!l.consent)
        details.push({
          path: `lines.${i}.consent`,
          message: `Record the doctor's consent to substitute ${prescribed.brand}`,
        });
    }
    return null;
  });
  if (details.length) throw errors.validation(details);

  // Schedule H1, X and narcotics: the prescriber's name and registration number (and the copy at the counter).
  const controlled = input.lines.filter((l) =>
    CONTROLLED.includes(byId.get(l.itemId).drug?.schedule),
  );
  const prescriber = rx?.prescriber?.name ? rx.prescriber : input.prescriber;
  if (controlled.length) {
    if (!prescriber?.name || !prescriber?.regNo)
      throw new AppError(
        409,
        'PRESCRIBER_NEEDED',
        'Schedule H1, X and narcotic medicines need the prescriber’s name and registration number.',
      );
    if (!rx && !input.prescriptionCopy)
      throw errors.validation([
        { path: 'prescriptionCopy', message: 'Keep a copy of the prescription for the register' },
      ]);
  }

  // Children: daily dose against the weight-based limit, where the item has one.
  if ((patient.ageDays ?? CHILD_DAYS) < CHILD_DAYS) {
    const limited = input.lines.filter((l) => {
      const it = byId.get(l.itemId);
      return it.drug?.maxMgPerKgDay && it.drug?.strengthMg;
    });
    if (limited.length && !input.weightKg)
      throw new AppError(
        409,
        'WEIGHT_NEEDED',
        'Weigh the child: these medicines are dosed by weight.',
      );
    for (const l of limited) {
      const it = byId.get(l.itemId);
      const pl = rx && l.rxLine != null ? rx.lines[l.rxLine] : null;
      if (!pl) continue;
      const dailyMg = unitsPerDose(pl.dose, it) * (PER_DAY[pl.frequency] ?? 1) * it.drug.strengthMg;
      const limit = it.drug.maxMgPerKgDay * input.weightKg;
      if (dailyMg > limit && !input.overrideReason?.trim())
        throw new AppError(
          409,
          'DOSE_ABOVE_LIMIT',
          `${it.name}: ${Math.round(dailyMg)} mg a day is above ${Math.round(limit)} mg for ${input.weightKg} kg. Confirm with the doctor and give a reason to go ahead.`,
          { itemId: l.itemId, dailyMg, limit },
        );
    }
  }

  const by = await userName();
  return withTransaction(async () => {
    const dispNo = await documentNumber(stay ? 'PI' : 'PS');
    const lines = [];
    for (const l of input.lines) {
      const it = byId.get(l.itemId);
      const alloc = await pick({
        storeId: store._id,
        itemId: it._id,
        qty: l.qty,
        batchNo: l.batchNo,
      });
      await deduct(alloc, { kind: stay ? 'ISSUE' : 'SALE', ref: dispNo, by });
      for (const a of alloc)
        lines.push({
          itemId: it._id,
          code: it.code,
          name: it.name,
          generic: it.drug?.generic,
          schedule: it.kind === 'DRUG' ? (it.drug?.schedule ?? 'H') : undefined,
          batchNo: a.batchNo,
          expiry: a.expiry,
          qty: a.qty,
          mrp: a.mrp,
          gstRate: it.gstRate,
          hsn: it.hsn,
          substituteFor: l.substituteFor,
        });
    }
    const total = lines.reduce((s, l) => s + l.mrp * l.qty, 0);
    const [d] = await Dispense.create([
      {
        dispNo,
        kind: stay ? 'ISSUE' : 'SALE',
        rxId: rx?._id,
        storeId: store._id,
        patient,
        admissionId: stay?._id,
        location: stay
          ? `${stay.bed?.ward ?? ''} ${stay.bed?.code ?? ''}`.trim()
          : 'Pharmacy counter',
        prescriber: prescriber?.name ? prescriber : undefined,
        prescriptionCopy: input.prescriptionCopy,
        weightKg: input.weightKg,
        overrideReason: input.overrideReason,
        lines,
        total,
        by,
        at: new Date(),
      },
    ]);
    let receipt = null;
    if (!stay) {
      const bill = await createBill({
        patientId: String(patient.id),
        type: 'OP',
        lines: lines.map((l) => ({
          item: { itemId: l.itemId, batchNo: l.batchNo, expiry: l.expiry },
          code: l.code,
          name: `${l.name} (batch ${l.batchNo})`,
          qty: l.qty,
          unitPrice: l.mrp,
          taxRate: l.gstRate,
          hsnSac: l.hsn,
          source: { type: 'PHARMACY', ref: dispNo },
        })),
        notes: `Pharmacy sale ${dispNo}`,
      });
      d.billId = bill.id;
      if (input.payNow) {
        // Billing rules apply: an open shift, the cash limit, the payment reference.
        const final = await finalizeBill(bill.id, { version: bill.version });
        const pay = await receivePayment({
          patientId: String(patient.id),
          mode: input.payNow.mode,
          reference: input.payNow.reference,
          amount: final.totals.balance,
          allocations: [{ billId: final.id, amount: final.totals.balance }],
        });
        d.receiptNo = pay.receiptNo ?? pay.payment?.receiptNo;
        receipt = { no: d.receiptNo, amount: final.totals.balance, billNo: final.billNo };
      }
      await d.save();
    }
    if (rx) {
      for (const l of input.lines)
        if (l.rxLine != null && rx.lines[l.rxLine]) rx.lines[l.rxLine].dispensedQty += l.qty;
      rx.status = rx.lines.every((x) => x.dispensedQty >= (x.suggestedQty ?? 1))
        ? 'DISPENSED'
        : 'PARTIAL';
      await rx.save();
    }
    if (stay) await syncStayBill(stay._id);
    await publish('pharmacy.dispensed', {
      dispenseId: String(d._id),
      dispNo,
      kind: d.kind,
      total,
      admissionId: stay ? String(stay._id) : null,
    });
    return { ...dispenseOut(d.toObject()), receipt };
  });
}

const dispenseOut = (d) => ({
  id: String(d._id),
  dispNo: d.dispNo,
  kind: d.kind,
  rxId: d.rxId ? String(d.rxId) : null,
  patient: {
    id: String(d.patient.id),
    uhid: d.patient.uhid,
    name: d.patient.name,
    age: d.patient.age,
  },
  admissionId: d.admissionId ? String(d.admissionId) : null,
  location: d.location ?? null,
  prescriber: d.prescriber?.name
    ? { name: d.prescriber.name, regNo: d.prescriber.regNo ?? null }
    : null,
  lines: d.lines.map((l) => ({ ...l, id: String(l._id), itemId: String(l.itemId) })),
  total: d.total,
  billId: d.billId ? String(d.billId) : null,
  receiptNo: d.receiptNo ?? null,
  by: d.by,
  at: d.at,
});

export async function listDispenses({ admissionId, patientId, kind, days = 1 } = {}) {
  const filter = {};
  if (admissionId) filter.admissionId = admissionId;
  else if (patientId) filter['patient.id'] = patientId;
  else filter.at = { $gte: new Date(Date.now() - days * 86_400_000) };
  if (kind) filter.kind = kind;
  const rows = await Dispense.find(filter).sort({ at: -1 }).limit(200).lean();
  return { items: rows.map(dispenseOut), total: rows.length, page: 1, limit: 200 };
}

/** Running IP bill lines from this stay's issues, net of accepted returns. */
export async function stayBillLines(a) {
  const issues = await Dispense.find({ admissionId: a._id, kind: 'ISSUE' }).lean();
  const out = [];
  for (const d of issues)
    for (const l of d.lines) {
      const qty = l.qty - (l.returnedQty ?? 0);
      if (qty <= 0) continue;
      out.push({
        item: { itemId: l.itemId, batchNo: l.batchNo, expiry: l.expiry },
        code: l.code,
        name: `${l.name} (batch ${l.batchNo})`,
        qty,
        unitPrice: l.mrp,
        taxRate: l.gstRate,
        hsnSac: l.hsn,
        source: { type: 'PHARMACY', ref: d.dispNo },
      });
    }
  return out;
}

// ---------------------------------------------------------------- ward returns (R15)

export const returnInput = z.object({
  dispenseId: z.string(),
  lines: z
    .array(z.object({ lineId: z.string(), qty: z.number().int().min(1).max(10000) }))
    .min(1)
    .max(40),
  reason: z.string().trim().max(200).optional(),
});

export async function requestReturn(input) {
  const d = await Dispense.findById(input.dispenseId).lean();
  if (!d || d.kind !== 'ISSUE') throw errors.notFound('Ward issue');
  const lines = input.lines.map((r, i) => {
    const l = d.lines.find((x) => String(x._id) === r.lineId);
    if (!l)
      throw errors.validation([
        { path: `lines.${i}.lineId`, message: 'Pick a line of this issue' },
      ]);
    if (r.qty > l.qty - (l.returnedQty ?? 0))
      throw errors.validation([
        {
          path: `lines.${i}.qty`,
          message: `At most ${l.qty - (l.returnedQty ?? 0)} can come back`,
        },
      ]);
    return { lineId: r.lineId, name: l.name, batchNo: l.batchNo, qty: r.qty };
  });
  const [r] = await PharmacyReturn.create([
    {
      dispenseId: d._id,
      dispNo: d.dispNo,
      admissionId: d.admissionId,
      patientName: d.patient.name,
      lines,
      reason: input.reason,
      requestedBy: await userName(),
    },
  ]);
  return { id: String(r._id), status: r.status, lines };
}

export async function listReturns({ status = 'PENDING' } = {}) {
  const rows = await PharmacyReturn.find({ status }).sort({ createdAt: 1 }).lean();
  return {
    items: rows.map((r) => ({
      id: String(r._id),
      dispNo: r.dispNo,
      admissionId: r.admissionId ? String(r.admissionId) : null,
      patientName: r.patientName,
      lines: r.lines,
      status: r.status,
      reason: r.reason ?? null,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt,
    })),
  };
}

/** Accept: stock back to the batch, the running bill credited. Reject: nothing moves. */
export async function decideReturn(id, { accept }) {
  const r = await PharmacyReturn.findById(id);
  if (!r) throw errors.notFound('Return');
  if (r.status !== 'PENDING') throw new AppError(409, 'INVALID_STATE', 'Already decided.');
  const by = await userName();
  return withTransaction(async () => {
    if (accept) {
      const d = await Dispense.findById(r.dispenseId);
      for (const rl of r.lines) {
        const l = d.lines.id(rl.lineId);
        await addStock({
          storeId: d.storeId,
          itemId: l.itemId,
          batchNo: l.batchNo,
          expiry: l.expiry,
          mrp: l.mrp,
          qty: rl.qty,
          kind: 'RETURN',
          ref: d.dispNo,
          by,
        });
        l.returnedQty = (l.returnedQty ?? 0) + rl.qty;
      }
      await d.save();
      if (d.admissionId) await syncStayBill(d.admissionId);
    }
    r.status = accept ? 'ACCEPTED' : 'REJECTED';
    r.decidedBy = by;
    r.decidedAt = new Date();
    await r.save();
    return { id: String(r._id), status: r.status };
  });
}

/** Rule R15: the final IP bill waits while a ward return is not settled by the pharmacy. */
export async function pendingReturnsCheck(a) {
  const n = await PharmacyReturn.countDocuments({ admissionId: a._id, status: 'PENDING' });
  return n
    ? {
        code: 'PHARMACY_RETURNS_PENDING',
        message: `The pharmacy has ${n} ward return${n > 1 ? 's' : ''} to settle before the final bill.`,
      }
    : null;
}

// ---------------------------------------------------------------- registers and reports

/** Schedule H1 / X / narcotic register for a month. */
export async function register({ schedule = 'H1', month } = {}) {
  const m = month ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  const start = new Date(`${m}-01T00:00:00+05:30`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const rows = await Dispense.find({ at: { $gte: start, $lt: end }, 'lines.schedule': schedule })
    .sort({ at: 1 })
    .lean();
  const items = [];
  for (const d of rows)
    for (const l of d.lines.filter((x) => x.schedule === schedule))
      items.push({
        at: d.at,
        dispNo: d.dispNo,
        patient: d.patient.name,
        uhid: d.patient.uhid,
        prescriber: d.prescriber?.name ?? null,
        regNo: d.prescriber?.regNo ?? null,
        item: l.name,
        batchNo: l.batchNo,
        qty: l.qty,
        by: d.by,
      });
  return { schedule, month: m, items };
}

/** Day's sales: counter and ward, by GST rate (HSN-wise GST register comes from these lines). */
export async function salesSummary({ date } = {}) {
  const day = date ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00+05:30`);
  const rows = await Dispense.find({
    at: { $gte: start, $lt: new Date(start.getTime() + 86_400_000) },
  }).lean();
  const byRate = new Map();
  let sales = 0;
  let issues = 0;
  for (const d of rows) {
    if (d.kind === 'SALE') sales += d.total;
    else issues += d.total;
    for (const l of d.lines) {
      const value = l.mrp * (l.qty - (l.returnedQty ?? 0));
      const taxable = Math.round((value * 100) / (100 + (l.gstRate ?? 0)));
      const r = byRate.get(l.gstRate) ?? { rate: l.gstRate, value: 0, taxable: 0, tax: 0 };
      r.value += value;
      r.taxable += taxable;
      r.tax += value - taxable;
      byRate.set(l.gstRate, r);
    }
  }
  return {
    date: day,
    sales,
    issues,
    dispenses: rows.length,
    gst: [...byRate.values()].sort((a, b) => a.rate - b.rate),
  };
}
