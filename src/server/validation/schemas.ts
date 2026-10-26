import { z } from "zod";
import { bdtToPoisa } from "@/lib/money";

/** Shared validators. The same schemas guard route handlers and server actions. */

const pricePoisa = z
  .union([z.string(), z.number()])
  .refine((value) => String(value).trim() !== "", "Enter an amount.")
  .transform((value) => {
    try {
      return bdtToPoisa(value);
    } catch {
      return NaN;
    }
  })
  .refine((value) => Number.isInteger(value) && value >= 0, "Amount must be a positive number.")
  .refine((value) => value <= 100_000_000, "Amount is unrealistically large.");

const timeOfDay = /^\d{2}:\d{2}$/;
const dateKey = /^\d{4}-\d{2}-\d{2}$/;

export const bdPhone = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ""))
  .refine((value) => /^(\+?880|880|0)(1[3-9]\d{8})$/.test(value), {
    message: "Use a Bangladeshi mobile number, e.g. 01712345678 or +8801712345678.",
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password.").max(200),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  phone: bdPhone,
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(200)
    .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), {
      message: "Mix upper and lower case letters and include a digit.",
    }),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Category name is required.").max(60),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,72}$/).optional(),
  description: z.string().trim().max(400).optional().nullable(),
  imageUrl: z.string().trim().url("Image must be an absolute URL.").optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const menuItemSchema = z.object({
  name: z.string().trim().min(2, "Item name is required.").max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,72}$/).optional(),
  description: z.string().trim().max(600).optional().nullable(),
  categoryId: z.string().min(1, "Choose a category."),
  priceBdt: pricePoisa,
  imageUrl: z.string().trim().max(500).optional().nullable(),
  available: z.boolean().default(true),
  featured: z.boolean().default(false),
  prepMinutes: z.coerce.number().int().min(0).max(600).optional().nullable(),
  ingredients: z.string().trim().max(600).optional().nullable(),
  allergens: z.string().trim().max(400).optional().nullable(),
  spicyLevel: z.coerce.number().int().min(0).max(5).default(0),
  servesInfo: z.string().trim().max(120).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export const customizationGroupSchema = z.object({
  name: z.string().trim().min(2).max(60),
  required: z.boolean().default(false),
  minSelect: z.coerce.number().int().min(0).max(10).default(0),
  maxSelect: z.coerce.number().int().min(1).max(10).default(1),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  options: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(60),
        priceDeltaBdt: pricePoisa,
        available: z.boolean().default(true),
        sortOrder: z.coerce.number().int().min(0).max(999).default(0),
      }),
    )
    .min(1, "Add at least one option.")
    .max(20),
});

const orderOptionSchema = z.object({
  groupId: z.string().min(1),
  optionId: z.string().min(1),
});

export const orderItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(99),
  options: z.array(orderOptionSchema).max(20).default([]),
  instructions: z.string().trim().max(280).optional(),
});

export const orderCreateSchema = z
  .object({
    type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]).default("DINE_IN"),
    tableToken: z.string().min(8).max(64).optional(),
    participantToken: z.string().min(8).max(64).optional(),
    contact: z
      .object({
        name: z.string().trim().min(2).max(80),
        phone: bdPhone,
        address: z.string().trim().max(300).optional(),
      })
      .optional(),
    items: z.array(orderItemSchema).min(1, "Add at least one dish.").max(60),
    specialInstructions: z.string().trim().max(300).optional(),
    idempotencyKey: z.string().min(8).max(64),
  })
  .refine(
    (value) => value.type === "DINE_IN" || value.contact !== undefined,
    { message: "Name and phone are required for takeaway and delivery orders.", path: ["contact"] },
  )
  .refine((value) => value.type !== "DINE_IN" || value.tableToken !== undefined, {
    message: "A table token is required for dine-in orders.",
    path: ["tableToken"],
  });

export const orderStatusUpdateSchema = z.object({
  status: z.enum(["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"]),
  note: z.string().trim().max(200).optional(),
});

export const orderCancelSchema = z.object({
  reason: z.string().trim().min(3, "Give a short reason.").max(200),
});

export const tableSchema = z.object({
  label: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/, "Use letters, numbers or dashes.").refine((v) => !/^T?0*$/.test(v), "Table label is required."),
  number: z.coerce.number().int().min(1).max(9999),
  capacity: z.coerce.number().int().min(1).max(40),
  section: z.string().trim().max(40).optional().nullable(),
  isEnabled: z.boolean().default(true),
});

export const tableStatusSchema = z.object({ status: z.enum(["AVAILABLE", "RESERVED", "OCCUPIED", "CLEANING", "DISABLED"]) });

export const sessionOpenSchema = z.object({
  tableId: z.string().min(1),
  guestCount: z.coerce.number().int().min(1).max(40).default(2),
  reservationId: z.string().optional(),
  notes: z.string().trim().max(200).optional(),
});

export const sessionCloseSchema = z.object({
  reason: z.enum(["SETTLED", "NO_PAYMENT", "TRANSFERRED", "MANUAL"]).default("SETTLED"),
});

export const reservationCreateSchema = z.object({
  customerName: z.string().trim().min(2, "Enter the guest name.").max(80),
  phone: bdPhone,
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  dateKey: z.string().regex(dateKey, "Choose a date."),
  time: z.string().regex(timeOfDay, "Choose a time."),
  partySize: z.coerce.number().int().min(1).max(50),
  specialRequests: z.string().trim().max(400).optional(),
  policyAccepted: z.boolean().refine((value) => value, "Please accept the reservation policy."),
});

export const reservationUpdateSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  dateKey: z.string().regex(dateKey).optional(),
  time: z.string().regex(timeOfDay).optional(),
  partySize: z.coerce.number().int().min(1).max(50).optional(),
  tableIds: z.array(z.string()).optional(),
  note: z.string().trim().max(300).optional(),
});

export const billCreateSchema = z.object({
  sessionId: z.string().min(1).optional(),
  orderId: z.string().min(1).optional(),
  discountBdt: pricePoisa.optional(),
}).refine((value) => Boolean(value.sessionId) !== Boolean(value.orderId), {
  message: "Provide either a table session or a single order.",
});

export const billFinalizeSchema = z.object({
  discountBdt: pricePoisa.optional(),
});

export const paymentRecordSchema = z.object({
  billId: z.string().min(1).optional(),
  orderId: z.string().min(1).optional(),
  method: z.enum(["CASH", "CARD", "MOBILE_BANKING", "ONLINE_GATEWAY", "OTHER"]),
  amountBdt: pricePoisa,
  reference: z.string().trim().max(80).optional(),
});

export const paymentInitSchema = z.object({
  billId: z.string().min(1),
  method: z.enum(["ONLINE_GATEWAY"]),
  successUrl: z.string().url().optional(),
  failureUrl: z.string().url().optional(),
});

export const refundSchema = z.object({
  paymentId: z.string().min(1),
  amountBdt: pricePoisa,
  reason: z.string().trim().min(5, "Explain the refund.").max(300),
});

export const staffSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: bdPhone.optional().or(z.literal("")),
  role: z.enum(["OWNER", "MANAGER", "CASHIER", "KITCHEN"]),
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(200)
    .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), {
      message: "Mix upper and lower case letters and include a digit.",
    })
    .optional(),
  isActive: z.boolean().default(true),
});

export const openingHourRuleSchema = z.object({
  days: z.array(z.coerce.number().int().min(0).max(6)).min(1),
  opens: z.string().regex(timeOfDay),
  closes: z.string().regex(timeOfDay),
});

export const settingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  logoUrl: z.string().trim().max(500).optional().nullable(),
  addressLine1: z.string().trim().min(3).max(200),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(80),
  phonePrimary: bdPhone,
  phoneSecondary: bdPhone.optional().or(z.literal("")).nullable(),
  emailPublic: z.string().trim().email().optional().or(z.literal("")).nullable(),
  mapsUrl: z.string().trim().url().optional().nullable(),
  facebookUrl: z.string().trim().url().optional().nullable(),
  instagramUrl: z.string().trim().url().optional().nullable(),
  contactNote: z.string().trim().max(400).optional().nullable(),
  timezone: z.string().trim().min(3).max(60),
  currencyCode: z.string().trim().length(3),
  currencySymbol: z.string().trim().min(1).max(3),
  openingHours: z.array(openingHourRuleSchema).max(14),
  serviceChargeBps: z.coerce.number().int().min(0).max(5000),
  vatBps: z.coerce.number().int().min(0).max(5000),
  vatOnServiceCharge: z.boolean(),
  roundingStepPoisa: z.coerce.number().int().min(1).max(1000),
  reservationSlotMinutes: z.coerce.number().int().min(5).max(180),
  reservationDurationMinutes: z.coerce.number().int().min(15).max(480),
  reservationBufferMinutes: z.coerce.number().int().min(0).max(240),
  reservationMaxDaysAhead: z.coerce.number().int().min(1).max(365),
  reservationCutoffMinutes: z.coerce.number().int().min(0).max(1440),
  reservationDepositPoisa: z.coerce.number().int().min(0).max(1_000_000),
  requirePolicyAcceptance: z.boolean(),
  allowDineIn: z.boolean(),
  allowTakeaway: z.boolean(),
  allowDelivery: z.boolean(),
  deliveryFeePoisa: z.coerce.number().int().min(0).max(100_000),
  autoConfirmOrders: z.boolean(),
  enablePartialPayments: z.boolean(),
  paymentProvider: z.enum(["simulated", "sslcommerz"]),
  paymentStoreId: z.string().trim().max(80).optional().nullable(),
  chatbotEnabled: z.boolean(),
  chatbotFallbackOnly: z.boolean(),
  emailNotificationsEnabled: z.boolean(),
  receiptFooter: z.string().trim().max(300),
  receiptHeader: z.string().trim().max(120),
});

export const chatSendSchema = z.object({
  conversationToken: z.string().min(8).max(64).optional(),
  message: z
    .string()
    .trim()
    .min(2, "Type a question first.")
    .max(600, "Keep questions under 600 characters."),
  tableToken: z.string().min(8).max(64).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(600) }))
    .max(12)
    .default([]),
});

export const idParam = z.string().min(1).max(64);
export const tokenParam = z.string().min(8).max(64);

export type MenuItemInput = z.infer<typeof menuItemSchema>;
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
