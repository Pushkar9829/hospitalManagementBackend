import { z } from 'zod';
import { objectId } from './common.js';

/** Bill types built in Phase 1 and their number series; IP and pharmacy bills come with those modules. */
export const BILL_TYPES = Object.freeze({
  OP: { label: 'OPD bill', series: 'OP_BILL' },
  IP: { label: 'In-patient bill', series: 'IP_BILL' },
  MISC: { label: 'Miscellaneous bill', series: 'MISC_BILL' },
});

/** Spec section 269ST of the Income-tax Act: no cash of ₹2,00,000 or more from one person in a day. */
export const CASH_LIMIT_PAISE = 2_00_000_00;
/** Shift variance above ₹100 needs a reason and Billing Manager verification (rule R11). */
export const SHIFT_VARIANCE_PAISE = 100_00;
/** Notes and coins counted at shift close. */
export const DENOMINATIONS = Object.freeze([2000, 500, 200, 100, 50, 20, 10, 5, 2, 1]);

const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500);
const rupeesToPaise = z
  .number()
  .min(0)
  .max(1_00_00_000)
  .transform((r) => Math.round(r * 100));
const version = z.number().int().min(0);

export const billLineInput = z.object({
  serviceId: objectId,
  qty: z.number().int().min(1).max(999).default(1),
});

export const billCreateInput = z.object({
  patientId: objectId,
  type: z.enum(Object.keys(BILL_TYPES)).default('OP'),
  lines: z.array(billLineInput).min(1, 'Add at least one service').max(100),
  /** Referring or treating doctor, for doctor-wise revenue. */
  doctorUserId: objectId.optional(),
  /** A corporate or government payer billed on credit (its price list applies). */
  payerId: objectId.optional(),
  notes: z.string().trim().max(300).optional(),
});

export const billLinesUpdate = z.object({ version, lines: z.array(billLineInput).min(1).max(100) });

export const finalizeInput = z.object({ version });

/** One receipt can pay several bills (a parent paying for two children). Amounts in rupees. */
export const paymentInput = z
  .object({
    patientId: objectId,
    mode: z.string().trim().toUpperCase().min(2).max(12),
    amount: rupeesToPaise.refine((p) => p > 0, 'Enter the amount'),
    reference: z.string().trim().max(60).optional(),
    allocations: z
      .array(z.object({ billId: objectId, amount: rupeesToPaise }))
      .min(1)
      .max(10),
    /** For mode ADVANCE: the deposit to use. */
    depositId: objectId.optional(),
  })
  .refine((p) => p.allocations.reduce((s, a) => s + a.amount, 0) === p.amount, {
    path: ['allocations'],
    message: 'Allocations must add up to the amount',
  });

export const depositInput = z.object({
  patientId: objectId,
  mode: z.string().trim().toUpperCase().min(2).max(12),
  amount: rupeesToPaise.refine((p) => p > 0, 'Enter the amount'),
  reference: z.string().trim().max(60).optional(),
  purpose: z.string().trim().max(120).optional(),
});

export const discountRequestInput = z
  .object({ version, kind: z.enum(['PERCENT', 'AMOUNT']), value: z.number().positive(), reason })
  .refine((d) => d.kind !== 'PERCENT' || d.value <= 100, {
    path: ['value'],
    message: 'At most 100%',
  });

export const cancelRequestInput = z.object({ version, reason });

export const refundPayInput = z.object({
  version,
  reference: z.string().trim().max(60).optional(),
});

export const shiftOpenInput = z.object({
  counter: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,12}$/, 'Counter code: letters and digits'),
  openingCash: rupeesToPaise,
});

export const shiftCloseInput = z.object({
  version,
  // partialRecord: a cashier counts only the notes they have (an enum record would demand all).
  notes: z
    .partialRecord(z.enum(DENOMINATIONS.map(String)), z.number().int().min(0).max(100000))
    .default({}),
  /** Totals from the card machine and UPI settlement screen, in rupees. */
  nonCash: z.record(z.string().toUpperCase(), rupeesToPaise).default({}),
  varianceReason: z.string().trim().max(500).optional(),
});

export const shiftVerifyInput = z.object({
  version,
  comment: z.string().trim().max(500).optional(),
});
