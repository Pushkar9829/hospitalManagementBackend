import { z } from 'zod';
import { mobile, objectId } from './common.js';
import { passwordPolicy } from './auth.js';
import { LANGUAGES } from '../enums/patient.js';

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,40}$/, 'Use 2 to 40 lower-case letters, digits, dot, dash or underscore');
const roleCode = z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/);

const userFields = {
  name: z.string().trim().min(2, 'Enter the full name').max(120),
  mobile: mobile.optional(),
  email: z
    .email('Enter a valid e-mail')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  designation: z.string().trim().max(80).optional(),
  roleCodes: z.array(roleCode).min(1, 'Give at least one role').max(5),
  branchIds: z.array(objectId).min(1, 'Choose at least one branch'),
  defaultBranchId: objectId.optional(),
  departmentIds: z.array(objectId).max(10).default([]),
  preferredLanguage: z.enum(Object.keys(LANGUAGES)).default('en'),
};

/**
 * New staff login (spec 4.4 user flow). INVITE sends a one-time link by SMS; TEMP_PASSWORD lets
 * the admin hand over a temporary password that must be changed at first sign-in.
 */
export const userCreateInput = z
  .object({
    ...userFields,
    username,
    onboarding: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('INVITE') }),
      z.object({ mode: z.literal('TEMP_PASSWORD'), temporaryPassword: passwordPolicy }),
    ]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((u) => !u.defaultBranchId || u.branchIds.includes(u.defaultBranchId), {
    path: ['defaultBranchId'],
    message: 'The default branch must be one of the branches',
  })
  .refine((u) => u.onboarding.mode !== 'INVITE' || u.mobile, {
    path: ['mobile'],
    message: 'An invitation is sent by SMS: enter the mobile number',
  });

export const userUpdateInput = z
  .object({
    ...userFields,
    version: z.number().int().min(0),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((u) => !u.defaultBranchId || u.branchIds.includes(u.defaultBranchId), {
    path: ['defaultBranchId'],
    message: 'The default branch must be one of the branches',
  });

export const inviteAcceptBody = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordPolicy,
});

export const roleInput = z.object({
  code: roleCode,
  name: z.string().trim().min(2).max(80),
  /** Custom roles start as a copy of a system role. */
  clonedFrom: roleCode,
  permissions: z.array(z.string().max(80)).max(300),
  scope: z.enum(['own', 'ward', 'department', 'branch', 'all']),
  maxSessions: z.number().int().min(1).max(10).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});
