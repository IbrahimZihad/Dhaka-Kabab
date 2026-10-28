import { z } from "zod";
import { bdPhone, dateKeySchema, timeOfDaySchema } from "@/server/validation/common";

/** Reservation creation (public) and management (staff). */

export const reservationCreateSchema = z.object({
  customerName: z.string().trim().min(2, "Enter the guest name.").max(80),
  phone: bdPhone,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  dateKey: dateKeySchema,
  time: timeOfDaySchema,
  partySize: z.coerce.number().int().min(1, "At least one guest.").max(60, "Parties over 60 need a phone call."),
  specialRequests: z.string().trim().max(400).optional(),
  policyAccepted: z.boolean().refine((value) => value, "Please accept the reservation policy to continue."),
});

export const reservationAvailabilitySchema = z.object({
  dateKey: dateKeySchema,
  partySize: z.coerce.number().int().min(1).max(60),
});

export const reservationManageSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  dateKey: dateKeySchema.optional(),
  time: timeOfDaySchema.optional(),
  partySize: z.coerce.number().int().min(1).max(60).optional(),
  note: z.string().trim().max(300).optional(),
  reason: z.string().trim().max(300).optional(),
});

export const reservationAssignTablesSchema = z.object({
  tableIds: z.array(z.string().min(1)).min(1, "Pick at least one table.").max(12),
});

export const reservationListQuerySchema = z.object({
  dateKey: dateKeySchema.optional(),
  status: z.enum(["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  search: z.string().trim().max(60).optional(),
});

export type ReservationCreateInput = z.infer<typeof reservationCreateSchema>;
