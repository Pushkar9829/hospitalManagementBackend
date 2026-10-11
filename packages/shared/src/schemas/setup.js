import { z } from 'zod';
import { isGstin, isPan, isPinCode } from '../ids.js';
import { objectId } from './common.js';

const code = (max = 12) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      new RegExp(`^[A-Z0-9][A-Z0-9_-]{0,${max - 1}}$`),
      `Use up to ${max} letters, digits, - or _`,
    );
const name = z.string().trim().min(2, 'Enter a name').max(120);
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined));

export const address = z.object({
  line1: optionalText(),
  line2: optionalText(),
  city: optionalText(80),
  state: optionalText(80),
  pin: z
    .string()
    .trim()
    .refine((v) => !v || isPinCode(v), 'Enter a 6-digit PIN code')
    .optional(),
});

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isGstin, 'Enter a valid GSTIN')
  .optional()
  .or(z.literal('').transform(() => undefined));
export const pan = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isPan, 'Enter a valid PAN')
  .optional()
  .or(z.literal('').transform(() => undefined));

// ---------------------------------------------------------------- hospital, entities, branches

export const legalEntityInput = z.object({
  name,
  registrationNo: optionalText(60),
  gstin,
  pan,
  address: address.optional(),
  signatory: optionalText(120),
  logoFileId: objectId.optional(),
  letterheadFileId: objectId.optional(),
});

export const branchInput = z.object({
  name,
  code: code(8),
  entityId: objectId.optional(),
  address: address.optional(),
  gstin,
  phone: optionalText(20),
  email: z
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

/** Hospital-editable settings (spec 5.1). */
export const hospitalSettingsInput = z.object({
  displayName: name,
  financialYearStartMonth: z.number().int().min(1).max(12),
  timezone: z.literal('Asia/Kolkata'),
  dateFormat: z.enum(['DD/MM/YYYY', 'DD-MMM-YYYY']),
  languages: z.array(z.enum(['en', 'hi', 'mr', 'ta', 'te', 'kn', 'bn', 'gu', 'ml'])).min(1),
  idleTimeoutMin: z.number().int().min(5).max(60),
  communication: z
    .object({
      smsSenderId: optionalText(6),
      emailFrom: optionalText(120),
      whatsappNumber: optionalText(15),
    })
    .optional(),
});

// ---------------------------------------------------------------- numbering

export const NUMBER_SERIES = Object.freeze({
  UHID: { label: 'Patient UHID', prefix: 'CC', reset: 'NEVER', perBranch: false, width: 7 },
  OPD_VISIT: { label: 'OPD visit', prefix: 'OV', reset: 'YEARLY', perBranch: true, width: 6 },
  IP: { label: 'In-patient admission', prefix: 'IP', reset: 'YEARLY', perBranch: true, width: 6 },
  OP_BILL: { label: 'OPD bill', prefix: 'OP', reset: 'YEARLY', perBranch: true, width: 6 },
  IP_BILL: { label: 'IPD bill', prefix: 'IPB', reset: 'YEARLY', perBranch: true, width: 6 },
  RECEIPT: { label: 'Receipt', prefix: 'RC', reset: 'YEARLY', perBranch: true, width: 6 },
  REFUND: { label: 'Refund', prefix: 'RF', reset: 'YEARLY', perBranch: true, width: 6 },
  CREDIT_NOTE: { label: 'Credit note', prefix: 'CN', reset: 'YEARLY', perBranch: true, width: 6 },
  MISC_BILL: {
    label: 'Miscellaneous bill',
    prefix: 'MS',
    reset: 'YEARLY',
    perBranch: true,
    width: 6,
  },
  DEPOSIT: { label: 'Deposit', prefix: 'DP', reset: 'YEARLY', perBranch: true, width: 6 },
  PO: { label: 'Purchase order', prefix: 'PO', reset: 'YEARLY', perBranch: true, width: 6 },
  GRN: { label: 'Goods receipt', prefix: 'GRN', reset: 'YEARLY', perBranch: true, width: 6 },
  EMPLOYEE: { label: 'Employee ID', prefix: 'EMP', reset: 'NEVER', perBranch: false, width: 5 },
});

export const numberSeriesInput = z.object({
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,5}$/, 'Use 1 to 5 capital letters'),
  reset: z.enum(['YEARLY', 'MONTHLY', 'NEVER']),
  width: z.number().int().min(3).max(9),
});

// ---------------------------------------------------------------- departments

export const DEPARTMENT_TYPES = Object.freeze({
  CLINICAL: 'Clinical',
  DIAGNOSTIC: 'Diagnostic',
  SUPPORT: 'Support',
  ADMINISTRATIVE: 'Administrative',
});

export const DEPARTMENT_STATUS = Object.freeze({
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'warning' },
  ACTIVE: { label: 'Active', tone: 'success' },
  CLOSING: { label: 'Closing (approval)', tone: 'warning' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const departmentInput = z.object({
  code: code(8),
  name,
  type: z.enum(Object.keys(DEPARTMENT_TYPES)),
  parentId: objectId.optional(),
  hodUserId: objectId.optional(),
  location: z.object({
    branchId: objectId,
    building: optionalText(60),
    floor: optionalText(20),
    rooms: optionalText(60),
  }),
  services: z.object({
    opd: z.boolean(),
    ipd: z.boolean(),
    procedures: z.boolean(),
    diagnostics: z.boolean(),
  }),
  costCentre: optionalText(30),
  opdTimings: z
    .array(
      z
        .object({ day: z.number().int().min(0).max(6), from: time, to: time })
        .refine((t) => t.from < t.to, { path: ['to'], message: 'End after start' }),
    )
    .max(21)
    .default([]),
});

// ---------------------------------------------------------------- masters

const rupees = z.coerce.number().min(0).max(1_00_00_000);

/** Every master type: label, input schema and Excel import columns (header -> field). */
export const MASTERS = Object.freeze({
  'price-lists': {
    label: 'Price lists',
    input: z.object({
      code: code(),
      name,
      kind: z.enum(['GENERAL', 'STAFF', 'SENIOR', 'CORPORATE']),
      isDefault: z.boolean().default(false),
    }),
    columns: { Code: 'code', Name: 'name', Kind: 'kind', Default: 'isDefault' },
  },
  'tax-codes': {
    label: 'Tax codes',
    input: z
      .object({
        code: code(),
        name,
        kind: z.enum(['GST', 'EXEMPT']),
        // GST slabs after the September 2025 rationalisation (0.25% and 3% are special rates).
        rate: z.coerce
          .number()
          .refine((r) => [0, 0.25, 3, 5, 18, 40].includes(r), 'Not a current GST rate'),
        hsnSac: z
          .string()
          .trim()
          .regex(/^\d{4,8}$/, 'HSN/SAC has 4 to 8 digits')
          .optional(),
      })
      .refine((t) => t.kind !== 'EXEMPT' || t.rate === 0, {
        path: ['rate'],
        message: 'Exempt codes have rate 0',
      }),
    columns: { Code: 'code', Name: 'name', Kind: 'kind', 'Rate %': 'rate', 'HSN/SAC': 'hsnSac' },
  },
  'payment-modes': {
    label: 'Payment modes',
    input: z.object({
      code: code(),
      name,
      kind: z.enum([
        'CASH',
        'CARD',
        'UPI',
        'CHEQUE',
        'BANK_TRANSFER',
        'WALLET',
        'ADVANCE',
        'PAYMENT_LINK',
      ]),
      requiresReference: z.boolean().default(false),
    }),
    columns: { Code: 'code', Name: 'name', Kind: 'kind', 'Needs reference': 'requiresReference' },
  },
  'referral-sources': {
    label: 'Referral sources',
    input: z.object({
      code: code(),
      name,
      kind: z.enum(['DOCTOR', 'CAMP', 'WEBSITE', 'WALK_IN', 'CORPORATE', 'OTHER']),
      phone: optionalText(15),
    }),
    columns: { Code: 'code', Name: 'name', Kind: 'kind', Phone: 'phone' },
  },
  units: {
    label: 'Units of measure',
    input: z.object({
      code: code(),
      name,
      baseUnit: code().optional(),
      factor: z.coerce.number().positive().default(1),
    }),
    columns: { Code: 'code', Name: 'name', 'Base unit': 'baseUnit', Factor: 'factor' },
  },
  designations: {
    label: 'Designations',
    input: z.object({ code: code(), name, grade: optionalText(20) }),
    columns: { Code: 'code', Name: 'name', Grade: 'grade' },
  },
  holidays: {
    label: 'Public holidays',
    input: z.object({
      code: code(16),
      name,
      date: z.coerce.date(),
      branchCodes: z.array(code(8)).default([]),
    }),
    columns: { Code: 'code', Name: 'name', Date: 'date', Branches: 'branchCodes' },
  },
  services: {
    label: 'Services and tariffs',
    input: z.object({
      code: code(16),
      name,
      category: z.enum([
        'CONSULTATION',
        'PROCEDURE',
        'BED',
        'LAB',
        'RAD',
        'PACKAGE',
        'NURSING',
        'OTHER',
      ]),
      departmentCode: code(8).optional(),
      taxCode: code(),
      revenueHead: optionalText(40),
      /** Price list code -> amount in rupees (stored in paise). */
      rates: z
        .record(code(), rupees)
        .refine((r) => Object.keys(r).length > 0, 'Give at least one rate'),
    }),
    columns: {
      Code: 'code',
      Name: 'name',
      Category: 'category',
      Department: 'departmentCode',
      'Tax code': 'taxCode',
      'Revenue head': 'revenueHead',
      'Rate *': 'rates',
    },
  },
  wards: {
    label: 'Wards',
    input: z.object({
      code: code(8),
      name,
      branchCode: code(8),
      floor: optionalText(20),
      category: z.enum([
        'GENERAL',
        'SEMI_PRIVATE',
        'PRIVATE',
        'DELUXE',
        'ICU',
        'NICU',
        'PICU',
        'HDU',
        'ISOLATION',
        'DAYCARE',
        'EMERGENCY',
        'LABOUR',
      ]),
      gender: z.enum(['ANY', 'MALE', 'FEMALE']).default('ANY'),
      /** Bed-day service whose tariff (per price list, approved) is the rate per day. */
      bedServiceCode: code(16).optional(),
      departmentCode: code(8).optional(),
    }),
    columns: {
      Code: 'code',
      Name: 'name',
      Branch: 'branchCode',
      Floor: 'floor',
      Category: 'category',
      Gender: 'gender',
      'Bed service': 'bedServiceCode',
      Department: 'departmentCode',
    },
  },
  beds: {
    label: 'Beds',
    input: z.object({
      code: code(12),
      name: z.string().trim().min(1).max(40),
      wardCode: code(8),
      room: optionalText(20),
      kind: z
        .enum(['STANDARD', 'ISOLATION', 'VENTILATOR', 'CRADLE', 'DAYCARE'])
        .default('STANDARD'),
    }),
    columns: { Code: 'code', Label: 'name', Ward: 'wardCode', Room: 'room', Kind: 'kind' },
  },
  packages: {
    label: 'Packages',
    input: z.object({
      code: code(16),
      name,
      kind: z.enum(['SURGICAL', 'MEDICAL', 'DAYCARE', 'MATERNITY', 'HEALTH_CHECK']),
      price: rupees,
      stayDays: z.coerce.number().int().min(0).max(60).default(0),
      wardCategory: optionalText(20),
      includes: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
      excludes: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
      taxCode: code(),
      departmentCode: code(8).optional(),
    }),
    columns: {
      Code: 'code',
      Name: 'name',
      Kind: 'kind',
      'Price ₹': 'price',
      'Stay days': 'stayDays',
      Includes: 'includes',
      Excludes: 'excludes',
      'Tax code': 'taxCode',
      Department: 'departmentCode',
    },
  },
  payers: {
    label: 'Payers (insurers, TPAs, corporates, schemes)',
    input: z.object({
      code: code(12),
      name,
      kind: z.enum(['INSURER', 'TPA', 'CORPORATE', 'GOVT_SCHEME']),
      priceListCode: code().optional(),
      /** Credit for corporates: limit in rupees and days to pay. */
      creditLimit: rupees.default(0),
      creditDays: z.coerce.number().int().min(0).max(180).default(30),
      gstin,
      contactName: optionalText(80),
      email: z
        .email()
        .optional()
        .or(z.literal('').transform(() => undefined)),
      phone: optionalText(15),
    }),
    columns: {
      Code: 'code',
      Name: 'name',
      Kind: 'kind',
      'Price list': 'priceListCode',
      'Credit limit ₹': 'creditLimit',
      'Credit days': 'creditDays',
      GSTIN: 'gstin',
      Contact: 'contactName',
      Email: 'email',
      Phone: 'phone',
    },
  },
  doctors: {
    label: 'Doctors',
    input: z.object({
      code: code(12),
      name,
      kind: z.enum(['FULL_TIME', 'VISITING', 'CONSULTANT', 'RESIDENT']),
      departmentCode: code(8),
      /** State medical council or NMC registration number (shown on prescriptions). */
      registrationNo: z.string().trim().min(3).max(30),
      council: optionalText(80),
      qualification: optionalText(120),
      specialisation: optionalText(80),
      /** Sign-in of this doctor, if they use the system. */
      username: optionalText(40),
      consultationServiceCode: code(16).optional(),
    }),
    columns: {
      Code: 'code',
      Name: 'name',
      Kind: 'kind',
      Department: 'departmentCode',
      'Registration no.': 'registrationNo',
      Council: 'council',
      Qualification: 'qualification',
      Specialisation: 'specialisation',
      Username: 'username',
      'Consultation service': 'consultationServiceCode',
    },
  },
});

export const MASTER_TYPES = Object.freeze(Object.keys(MASTERS));
