import { z } from "zod";
import { bdPhone, dateKeySchema } from "@/server/validation/common";

/**
 * Order creation. Note what is *not* here: prices, totals, availability. The
 * client sends ids and quantities; the server re-derives every figure.
 */

export const orderOptionChoiceSchema = z.object({
  groupId: z.string().min(1),
  optionId: z.string().min(1),
});

export const orderItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(99, "Maximum 99 of one dish per line."),
  options: z.array(orderOptionChoiceSchema).max(20).default([]),
  /** A cart line with no note sends null, which is not the same as an invalid note. */
  instructions: z.string().trim().max(280, "Kitchen notes are limited to 280 characters.").nullish(),
});

export const orderContactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  phone: bdPhone,
  address: z.string().trim().min(6, "Enter the delivery address.").max(300).optional(),
});

export const orderCreateSchema = z
  .object({
    type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]).default("DINE_IN"),
    tableToken: z.string().min(8).max(64).optional(),
    participantToken: z.string().min(8).max(64).optional(),
    contact: orderContactSchema.optional(),
    items: z.array(orderItemSchema).min(1, "Add at least one dish.").max(60),
    specialInstructions: z.string().trim().max(300).optional(),
    /** Retried submissions reuse this key and receive the original order back. */
    idempotencyKey: z.string().min(10).max(64),
    /**
     * The cart's food subtotal, at the prices the menu page just showed. Checked
     * against the server's own subtotal to catch a stale cart — never as the
     * charged amount, and never compared to the grand total, which the guest
     * cannot know before the charges are applied.
     */
    cartTotalPoisa: z.coerce.number().int().min(0).optional(),
  })
  .refine((value) => value.type === "DINE_IN" || value.contact !== undefined, {
    message: "Name and phone number are required for takeaway and delivery orders.",
    path: ["contact"],
  })
  .refine((value) => value.type !== "DINE_IN" || value.tableToken !== undefined, {
    message: "Scan the table QR code to place a dine-in order.",
    path: ["tableToken"],
  });

export const orderStatusUpdateSchema = z.object({
  status: z.enum(["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"]),
  note: z.string().trim().max(200).optional(),
});

export const orderCancelSchema = z.object({
  reason: z.string().trim().min(3, "Give a short reason.").max(200),
});

export const orderListQuerySchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"]).optional(),
  type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]).optional(),
  tableId: z.string().optional(),
  sessionId: z.string().optional(),
  search: z.string().trim().max(60).optional(),
  dateKey: dateKeySchema.optional(),
});

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
