import { z } from 'zod';
import { isMobile, normaliseMobile } from '../ids.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid id');

export const mobile = z
  .string()
  .trim()
  .refine(isMobile, 'Enter a 10-digit mobile number')
  .transform(normaliseMobile);

/** ?page=1&limit=25&sort=-createdAt (spec "Conventions": max 100). */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z][\w.]*$/, 'Invalid sort field')
    .optional(),
});

export const pageOf = (item) =>
  z.object({ items: z.array(item), page: z.number(), limit: z.number(), total: z.number() });

export const errorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    requestId: z.string().optional(),
  }),
});

/** Optimistic locking: every update sends the version it read. */
export const versioned = z.object({ version: z.number().int().min(0) });
