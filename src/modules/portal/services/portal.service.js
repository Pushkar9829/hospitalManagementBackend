import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { redis } from '../../../core/cache/redis.js';
import { AppError, errors } from '../../../core/errors/index.js';
import { sendSms } from '../../../core/notify/notify.service.js';
import { current, runInContext } from '../../../core/tenancy/context.js';
import { Branch } from '../../../core/tenancy/branch.model.js';
import { Bill, Deposit, Payment } from '../../billing/index.js';
import { Admission } from '../../ipd/index.js';
import { LabItem } from '../../lab/index.js';
import { Appointment, book, cancel, listDepartments, newVisitFee, slots } from '../../opd/index.js';
import { Doctor } from '../../setup/index.js';
import { Patient, patientCard } from '../../patients/index.js';
import { RadStudy } from '../../radiology/index.js';

/**
 * Patient portal (catalogue screens Portal, PortalBooking, PortalStay, PortalPay): a patient or
 * attendant signs in with a one-time code on the registered mobile and sees every patient on
 * that number (the family): reports, bills and receipts, the current stay, and booking.
 */

export const PORTAL_COOKIE = 'portal_token';
const OTP_TTL_SEC = 300;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS = 3;
const SESSION_MIN = 120;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const safeEqual = (a, b) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const mobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile');

// ---------------------------------------------------------------- sign-in

/** Sends a code when the number belongs to a patient; the answer is the same either way. */
export async function requestOtp({ mobile }) {
  const { tenantId, tenant } = current();
  const sendsKey = `portal-otp:sends:${tenantId}:${mobile}`;
  const sends = await redis().incr(sendsKey);
  if (sends === 1) await redis().expire(sendsKey, 600);
  const result = { expiresInSec: OTP_TTL_SEC };
  if (sends > OTP_MAX_SENDS) return result;
  const p = await Patient.findOne({ mobile, status: 'ACTIVE' }).select('preferredLanguage').lean();
  if (!p) return result;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await redis().set(
    `portal-otp:${tenantId}:${mobile}`,
    JSON.stringify({ hash: sha256(`${mobile}:${code}`), attempts: 0 }),
    'EX',
    OTP_TTL_SEC,
  );
  await sendSms({
    to: mobile,
    template: 'LOGIN_OTP',
    vars: { code, hospital: tenant.name },
    lang: p.preferredLanguage,
  });
  return result;
}

export async function verifyOtp({ mobile, code }, res) {
  const { tenantId } = current();
  const key = `portal-otp:${tenantId}:${mobile}`;
  const wrong = new AppError(401, 'INVALID_CREDENTIALS', 'The code is incorrect or has expired');
  const raw = await redis().get(key);
  if (!raw) throw wrong;
  const otp = JSON.parse(raw);
  if (!safeEqual(otp.hash, sha256(`${mobile}:${code}`))) {
    otp.attempts += 1;
    if (otp.attempts >= OTP_MAX_ATTEMPTS) await redis().del(key);
    else await redis().set(key, JSON.stringify(otp), 'KEEPTTL');
    throw wrong;
  }
  await redis().del(key);
  const token = jwt.sign({ tid: tenantId }, env.JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    subject: mobile,
    audience: 'portal',
    issuer: 'hms',
    expiresIn: `${SESSION_MIN}m`,
  });
  res.cookie(PORTAL_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MIN * 60_000,
  });
  return me(mobile);
}

export function logout(res) {
  res.clearCookie(PORTAL_COOKIE, { path: '/' });
  return { ok: true };
}

/** The signed-in mobile from the portal cookie (401 without a valid one for this hospital). */
export function portalMobile(req) {
  const token = req.cookies?.[PORTAL_COOKIE];
  const out = new AppError(401, 'UNAUTHENTICATED', 'Please sign in with your mobile number');
  if (!token) throw out;
  let claims;
  try {
    claims = jwt.verify(token, env.JWT_PUBLIC_KEY, {
      algorithms: ['RS256'],
      issuer: 'hms',
      audience: 'portal',
    });
  } catch {
    throw out;
  }
  if (claims.tid !== current().tenantId) throw out;
  return claims.sub;
}

/** Patients on the mobile (the family); `patientId`, when given, must be one of them. */
async function family(mobile, patientId) {
  const rows = await Patient.find({ mobile, status: 'ACTIVE' }).sort({ createdAt: 1 }).lean();
  if (patientId && !rows.some((p) => String(p._id) === String(patientId)))
    throw new AppError(404, 'NOT_FOUND', 'Patient not found');
  return rows;
}

// ---------------------------------------------------------------- home

export async function me(mobile) {
  const patients = await family(mobile);
  const ids = patients.map((p) => p._id);
  const today = todayIST();
  const [next, dueBills, stay, reports] = await Promise.all([
    Appointment.findOne({
      'patient.id': { $in: ids },
      date: { $gte: today },
      status: { $in: ['BOOKED', 'CONFIRMED'] },
    })
      .sort({ date: 1, time: 1 })
      .lean(),
    Bill.find({ 'patient.id': { $in: ids }, status: { $in: ['FINAL', 'PARTLY_PAID'] } })
      .select('totals')
      .lean(),
    Admission.findOne({
      'patient.id': { $in: ids },
      status: { $in: ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'] },
    })
      .select('_id patient ipNo')
      .lean(),
    LabItem.countDocuments({
      'patient.id': { $in: ids },
      status: 'RELEASED',
      sensitive: { $ne: true },
      releasedAt: { $gte: new Date(Date.now() - 7 * 86_400_000) },
    }),
  ]);
  return {
    mobile,
    hospital: current().tenant?.name ?? null,
    patients: patients.map((p) => {
      const c = patientCard(p);
      return { id: c.id, uhid: c.uhid, name: c.name, age: c.age, gender: c.gender };
    }),
    nextAppointment: next
      ? {
          id: String(next._id),
          patient: next.patient?.name,
          date: next.date,
          time: next.time,
          doctor: next.doctor?.name ?? null,
          department: next.doctor?.department ?? null,
          token: next.token ?? null,
        }
      : null,
    due: dueBills.reduce((t, b) => t + (b.totals?.balance ?? 0), 0),
    dueBills: dueBills.length,
    newReports: reports,
    stay: stay
      ? { admissionId: String(stay._id), patient: stay.patient?.name, ipNo: stay.ipNo }
      : null,
  };
}

// ---------------------------------------------------------------- reports

/**
 * Released reports for one family member: lab orders (sensitive tests, e.g. HIV, are given in
 * person, rule R13) and signed imaging reports.
 */
export async function reports(mobile, patientId) {
  await family(mobile, patientId);
  const [lab, rad] = await Promise.all([
    LabItem.find({ 'patient.id': patientId, status: 'RELEASED' })
      .sort({ releasedAt: -1 })
      .limit(200)
      .lean(),
    RadStudy.find({ 'patient.id': patientId, status: 'SIGNED' })
      .sort({ signedAt: -1 })
      .limit(50)
      .lean(),
  ]);
  const orders = new Map();
  for (const i of lab) {
    const o = orders.get(i.orderNo) ?? {
      orderNo: i.orderNo,
      orderedAt: i.orderedAt,
      releasedAt: i.releasedAt,
      doctor: i.doctor?.name ?? null,
      tests: [],
      inPerson: [],
    };
    if (i.sensitive) o.inPerson.push(i.name);
    else
      o.tests.push({
        code: i.code,
        name: i.name,
        results: (i.results ?? []).map((r) => ({
          name: r.name,
          value: r.value ?? null,
          unit: r.unit ?? null,
          range: r.range ?? null,
          flag: r.flag ?? null,
        })),
        comment: i.comment ?? null,
      });
    if (i.releasedAt > o.releasedAt) o.releasedAt = i.releasedAt;
    orders.set(i.orderNo, o);
  }
  return {
    lab: [...orders.values()],
    imaging: rad.map((s) => ({
      accessionNo: s.accessionNo,
      name: s.name,
      signedAt: s.signedAt,
      findings: s.report?.findings ?? null,
      impression: s.report?.impression ?? null,
    })),
  };
}

// ---------------------------------------------------------------- bills and receipts

const billOut = (b) => ({
  id: String(b._id),
  billNo: b.billNo ?? null,
  type: b.type,
  patient: b.patient?.name,
  status: b.status,
  date: b.finalizedAt ?? b.createdAt,
  total: b.totals?.total ?? 0,
  paid: b.totals?.paid ?? 0,
  balance: b.totals?.balance ?? 0,
  lines: (b.lines ?? []).map((l) => ({ name: l.name, qty: l.qty, amount: l.net ?? l.amount ?? 0 })),
});

/** Bills of the family: due first, then the last paid ones; receipts and deposits. */
export async function bills(mobile) {
  const ids = (await family(mobile)).map((p) => p._id);
  const [open, paid, payments, deposits] = await Promise.all([
    Bill.find({ 'patient.id': { $in: ids }, status: { $in: ['FINAL', 'PARTLY_PAID'] } })
      .sort({ finalizedAt: 1 })
      .lean(),
    Bill.find({ 'patient.id': { $in: ids }, status: 'PAID' })
      .sort({ finalizedAt: -1 })
      .limit(20)
      .lean(),
    Payment.find({ patientId: { $in: ids }, status: 'CAPTURED' })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    Deposit.find({ patientId: { $in: ids } })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);
  return {
    due: open.reduce((t, b) => t + (b.totals?.balance ?? 0), 0),
    open: open.map(billOut),
    paid: paid.map(billOut),
    receipts: payments.map((p) => ({
      id: String(p._id),
      receiptNo: p.receiptNo,
      patient: p.patient?.name ?? null,
      amount: p.amount,
      mode: p.mode,
      at: p.createdAt,
    })),
    deposits: deposits.map((d) => ({
      id: String(d._id),
      depositNo: d.depositNo ?? null,
      amount: d.amount,
      left: d.amount - (d.used ?? 0) - (d.refunded ?? 0),
      at: d.createdAt,
    })),
    // Online payment needs the hospital's payment gateway; until then bills are paid at the counter.
    onlinePayment: false,
  };
}

// ---------------------------------------------------------------- the stay

/** The current stay for the attendant: bed, consultant, deposit, running bill, discharge steps. */
export async function stay(mobile) {
  const ids = (await family(mobile)).map((p) => p._id);
  const a = await Admission.findOne({
    'patient.id': { $in: ids },
    status: { $in: ['ADMITTED', 'UNDER_TREATMENT', 'DISCHARGE_PLANNED', 'DISCHARGE_STARTED'] },
  }).lean();
  if (!a) return { stay: null };
  const [bill, deposits] = await Promise.all([
    a.billId ? Bill.findById(a.billId).lean() : null,
    Deposit.find({ patientId: a.patient.id, status: { $ne: 'CANCELLED' } }).lean(),
  ]);
  const byCategory = new Map();
  for (const l of bill?.lines ?? []) {
    const k = l.category ?? 'OTHER';
    byCategory.set(k, (byCategory.get(k) ?? 0) + (l.net ?? l.amount ?? 0));
  }
  const deposit = deposits.reduce((t, d) => t + d.amount - (d.used ?? 0) - (d.refunded ?? 0), 0);
  const total = bill?.totals?.total ?? 0;
  const steps = [
    ['ADVICE', Boolean(a.dischargeAdviceAt)],
    ['SUMMARY', a.summary?.status === 'SIGNED'],
    ['BILL', Boolean(a.billReadyAt)],
  ];
  return {
    stay: {
      admissionId: String(a._id),
      ipNo: a.ipNo,
      patient: a.patient?.name,
      admittedAt: a.admittedAt,
      ward: a.bed?.ward ?? null,
      bed: a.bed?.code ?? null,
      category: a.bed?.category ?? null,
      consultant: a.consultant?.name ?? null,
      status: a.status,
      expectedDischargeAt: a.expectedDischargeAt ?? null,
      bill: {
        total,
        deposit,
        balance: total - deposit,
        byCategory: [...byCategory.entries()]
          .map(([category, amount]) => ({ category, amount }))
          .sort((x, y) => y.amount - x.amount),
      },
      discharge: a.dischargeAdviceAt ? steps.map(([step, done]) => ({ step, done })) : null,
    },
  };
}

// ---------------------------------------------------------------- booking

export async function departments() {
  return listDepartments();
}

/** Free slots for a date: doctors with their open times (patients never see who else booked). */
export async function freeSlots({ date = todayIST(), department }) {
  const grid = await slots({ date, department });
  const out = [];
  for (const d of grid.doctors) {
    const cell = grid.cells.find((c) => c.doctorId === d.id);
    const times = (cell?.slots ?? []).filter((x) => x.status === 'FREE').map((x) => x.time);
    if (!times.length) continue;
    const doc = await Doctor.findById(d.id).lean();
    out.push({
      id: d.id,
      name: d.name,
      department: d.department ?? null,
      fee: doc ? await newVisitFee(doc) : null,
      times,
    });
  }
  return { date, doctors: out };
}

export const bookingInput = z.object({
  patientId: z.string(),
  doctorId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  visitType: z.enum(['NEW', 'FOLLOW_UP']).default('NEW'),
  notes: z.string().trim().max(200).optional(),
});

/** Books through the OPD rules (slots, book-ahead window, limits); the fee is paid at the visit. */
export async function bookVisit(mobile, input) {
  await family(mobile, input.patientId);
  const branch = await Branch.findOne({}).sort({ createdAt: 1 }).select('_id').lean();
  const c = current();
  const out = await runInContext(
    {
      ...c,
      branchId: c.branchId ?? (branch ? String(branch._id) : undefined),
      userName: 'Patient portal',
    },
    () => book({ ...input, channel: 'PORTAL' }),
  );
  return out;
}

export async function cancelVisit(mobile, appointmentId) {
  const ids = (await family(mobile)).map((p) => String(p._id));
  const a = await Appointment.findById(appointmentId).lean();
  if (!a || !ids.includes(String(a.patient.id))) throw errors.notFound('Appointment');
  return cancel(appointmentId, { reason: 'Cancelled by the patient on the portal' });
}

export async function appointments(mobile) {
  const ids = (await family(mobile)).map((p) => p._id);
  const rows = await Appointment.find({
    'patient.id': { $in: ids },
    date: { $gte: todayIST() },
    status: { $in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] },
  })
    .sort({ date: 1, time: 1 })
    .lean();
  return {
    items: rows.map((a) => ({
      id: String(a._id),
      patient: a.patient?.name,
      date: a.date,
      time: a.time,
      doctor: a.doctor?.name ?? null,
      department: a.doctor?.department ?? null,
      status: a.status,
      fee: a.fee?.amount ?? null,
    })),
  };
}
