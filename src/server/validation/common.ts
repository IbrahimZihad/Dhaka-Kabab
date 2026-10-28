import { z } from "zod";

/** Shared primitives used by every domain validator. */

/** Bangladesh mobile number, normalised to digits before matching. */
/**
 * Bangladesh mobile numbers arrive as `01712345678`, `+880 17-1234 5678` or
 * `8801712345678`. They all describe the same subscriber, so they are stored in
 * one shape — the local trunk form — otherwise the same guest becomes two rows
 * and the customer search finds only one of them.
 */
export function normaliseBdPhone(raw: string): string {
  const stripped = raw.replace(/[\s()-]/g, "");
  const match = /^(?:\+?880|880|0)?(1[3-9]\d{8})$/.exec(stripped);
  return match ? `0${match[1]}` : stripped;
}

export const bdPhone = z
  .string()
  .trim()
  .transform(normaliseBdPhone)
  .refine((value) => /^01[3-9]\d{8}$/.test(value), {
    message: "Use a Bangladeshi mobile number, e.g. 01712345678 or +8801712345678.",
  });

/**
 * Digits to match a stored phone against in a search box. Numbers are kept in
 * the trunk form, so a pasted "+880 17-1234 5678" must lose its country code or
 * the search returns nothing for the very customer staff are looking for. A
 * short paste that is mostly country code is left alone rather than collapsing
 * to a fragment that matches everyone.
 */
export function phoneSearchDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("880") && digits.length - 3 >= 4 ? digits.slice(3) : digits;
}

/**
 * A date key that names a real calendar day. The shape alone is not enough:
 * `2026-13-45` looks right but rolls over inside the day-window helper, so a
 * typo would surface as a 500 instead of a refusal.
 */
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    );
  }, "That date does not exist.");
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time.");

export const idSchema = z.string().min(1).max(64);
export const publicTokenSchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9]+$/, "Invalid link.");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.enum(["createdAt", "updatedAt", "totalPoisa", "status", "name"]).optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
