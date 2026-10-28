import { z } from "zod";

/** Tables, QR tokens and dining sessions. */

export const tableInputSchema = z.object({
  label: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,12}$/, "Use letters, numbers or dashes (max 12)."),
  number: z.coerce.number().int().min(1).max(9999),
  capacity: z.coerce.number().int().min(1, "A table seats at least one guest.").max(40),
  section: z.string().trim().max(40).nullish(),
  isEnabled: z.boolean().default(true),
});

export const tableStatusSchema = z.object({
  status: z.enum(["AVAILABLE", "RESERVED", "OCCUPIED", "CLEANING", "DISABLED"]),
  reason: z.string().trim().max(200).optional(),
});

export const tableDisableSchema = z.object({
  isEnabled: z.boolean(),
  reason: z.string().trim().min(3, "Say why the table is disabled.").max(200).optional(),
});

export const sessionOpenSchema = z.object({
  tableId: z.string().min(1),
  guestCount: z.coerce.number().int().min(1).max(40).default(2),
  reservationId: z.string().optional(),
  notes: z.string().trim().max(200).optional(),
});

export const sessionCloseSchema = z.object({
  reason: z.enum(["SETTLED", "TRANSFERRED", "NO_PAYMENT", "MANUAL"]).default("SETTLED"),
  note: z.string().trim().max(200).optional(),
});

export const sessionTransferSchema = z.object({
  fromTableId: z.string().min(1),
  toTableId: z.string().min(1),
  reason: z.string().trim().max(200).optional(),
});

/** Guest device → session join, sent when a QR link is opened. */
export const sessionJoinSchema = z.object({
  tableToken: z.string().min(8).max(64),
  participantToken: z.string().min(8).max(64).optional(),
  label: z.string().trim().max(24).optional(),
});

export type TableInput = z.infer<typeof tableInputSchema>;
