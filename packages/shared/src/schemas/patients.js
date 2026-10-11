import { z } from 'zod';
import { BLOOD_GROUPS, GENDERS, LANGUAGES, RELATIONS, TITLES } from '../enums/patient.js';
import { isAbhaNumber, isPinCode } from '../ids.js';
import { mobile, objectId } from './common.js';

const text = (max) => z.string().trim().max(max);
const optional = (s) => s.optional().or(z.literal('').transform(() => undefined));

export const ID_TYPES = Object.freeze({
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  PASSPORT: 'Passport',
  VOTER: 'Voter ID',
  DRIVING: 'Driving licence',
  RATION: 'Ration card',
  OTHER: 'Other',
});

export const PATIENT_CATEGORIES = Object.freeze({
  GENERAL: 'General',
  STAFF: 'Staff',
  SENIOR: 'Senior citizen',
  CORPORATE: 'Corporate',
});

export const ALLERGY_SEVERITY = Object.freeze({
  MILD: 'Mild',
  MODERATE: 'Moderate',
  SEVERE: 'Severe',
});

const name = z.object({
  title: z.enum(TITLES).optional(),
  first: text(60).min(1, 'Enter the first name'),
  middle: optional(text(60)),
  last: optional(text(60)),
  /** The name in the patient's own script, e.g. Devanagari. */
  regional: optional(text(120)),
});

/** Date of birth, or age in years/months/days (stored as an estimated date of birth). */
const birth = z
  .object({
    dob: z.coerce
      .date()
      .max(new Date(Date.now() + 86_400_000), 'Date of birth cannot be in the future')
      .optional(),
    age: z
      .object({
        years: z.number().int().min(0).max(130).default(0),
        months: z.number().int().min(0).max(11).default(0),
        days: z.number().int().min(0).max(30).default(0),
      })
      .optional(),
  })
  .refine((b) => b.dob || (b.age && b.age.years + b.age.months + b.age.days > 0), {
    path: ['dob'],
    message: 'Enter the date of birth or the age',
  });

const idDoc = z
  .object({
    type: z.enum(Object.keys(ID_TYPES)),
    number: text(30).min(4, 'Enter the ID number'),
    fileId: objectId.optional(),
  })
  // On edit the API sends Aadhaar back masked (XXXX XXXX 4321); the stored hash is kept.
  .refine(
    (d) =>
      d.type !== 'AADHAAR' ||
      /^\d{12}$/.test(d.number.replace(/\s|-/g, '')) ||
      /^X{4}\s?X{4}\s?\d{4}$/i.test(d.number.trim()),
    {
      path: ['number'],
      message: 'Aadhaar has 12 digits',
    },
  );

const allergy = z.object({
  substance: text(80).min(2, 'Name the substance'),
  reaction: optional(text(120)),
  severity: z.enum(Object.keys(ALLERGY_SEVERITY)),
});

const contact = z.object({ name: text(120).min(2), relation: text(40).min(2), mobile });

const fullFields = {
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  maritalStatus: z.enum(['SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED', 'UNKNOWN']).optional(),
  altMobile: mobile.optional(),
  email: z
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  address: z
    .object({
      line1: optional(text(160)),
      line2: optional(text(160)),
      city: optional(text(80)),
      district: optional(text(80)),
      state: optional(text(80)),
      pin: z
        .string()
        .trim()
        .refine((v) => !v || isPinCode(v), 'Enter a 6-digit PIN code')
        .optional(),
    })
    .optional(),
  /** Indian registers record S/o, D/o, W/o with the name. */
  relation: z.object({ type: z.enum(Object.keys(RELATIONS)), name: text(120).min(2) }).optional(),
  guardian: contact.optional(),
  emergencyContact: contact.optional(),
  ids: z.array(idDoc).max(5).default([]),
  abhaNumber: z
    .string()
    .trim()
    .refine((v) => !v || isAbhaNumber(v), 'ABHA number has 14 digits')
    .optional(),
  abhaAddress: optional(text(60)),
  allergies: z.array(allergy).max(20).default([]),
  noKnownAllergies: z.boolean().default(false),
  chronicConditions: z.array(text(80)).max(20).default([]),
  flags: z
    .object({ vip: z.boolean().default(false), mlc: z.boolean().default(false) })
    .default({ vip: false, mlc: false }),
  category: z.enum(Object.keys(PATIENT_CATEGORIES)).default('GENERAL'),
  referral: z.object({ sourceId: objectId.optional(), doctorName: optional(text(120)) }).optional(),
  photoFileId: objectId.optional(),
};

const common = {
  name,
  gender: z.enum(Object.keys(GENDERS)),
  mobile,
  preferredLanguage: z.enum(Object.keys(LANGUAGES)).default('en'),
  ...fullFields,
};

/**
 * Quick registration needs only name, gender, age and mobile so a queue never stops; missing
 * fields are flagged until completed (spec 5.4). Full registration checks more.
 */
export const patientCreateInput = z
  .object({
    registrationType: z.enum(['QUICK', 'FULL']),
    ...common,
    birth,
    /** Resend with true after the desk confirmed the possible duplicates are different people. */
    confirmNotDuplicate: z.boolean().default(false),
  })
  .refine((p) => !p.allergies.length || !p.noKnownAllergies, {
    path: ['noKnownAllergies'],
    message: 'Remove the allergies or untick "no known allergies"',
  });

export const patientUpdateInput = z
  .object({ ...common, birth, version: z.number().int().min(0) })
  .refine((p) => !p.allergies.length || !p.noKnownAllergies, {
    path: ['noKnownAllergies'],
    message: 'Remove the allergies or untick "no known allergies"',
  });

export const patientSearchQuery = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(60),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const patientMergeInput = z
  .object({
    survivorId: objectId,
    mergedId: objectId,
    reason: text(500).min(5, 'Explain why these are the same person'),
  })
  .refine((m) => m.survivorId !== m.mergedId, {
    path: ['mergedId'],
    message: 'Choose two different records',
  });

/** Fields a quick registration usually lacks; shown as "to complete" on the profile. */
export const COMPLETION_FIELDS = Object.freeze([
  'address',
  'emergencyContact',
  'ids',
  'allergiesRecorded',
]);
