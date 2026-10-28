import { z } from "zod";
import { bdPhone } from "@/server/validation/common";
import { pricePoisa } from "@/server/validation/menu";

/**
 * Restaurant configuration. Secrets deliberately have no field here: gateway
 * keys, AI keys and SMTP credentials are environment-only, so this payload is
 * safe to display on a settings screen.
 */

export const openingHourRuleSchema = z.object({
  days: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one day."),
  opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closes: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const settingsInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  logoUrl: z.string().trim().max(500).nullish(),
  addressLine1: z.string().trim().min(3, "Enter the street address.").max(200),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(80),
  phonePrimary: bdPhone,
  phoneSecondary: bdPhone.nullish(),
  // Non-nullable column: an empty string is the "cleared" value, not null.
  emailPublic: z.string().trim().email().optional().or(z.literal("")),
  mapsUrl: z.string().trim().url().optional().or(z.literal("")).nullish(),
  facebookUrl: z.string().trim().url().optional().or(z.literal("")).nullish(),
  instagramUrl: z.string().trim().url().optional().or(z.literal("")).nullish(),
  contactNote: z.string().trim().max(400).nullish(),

  timezone: z.string().trim().min(3).max(60).refine((value) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone."),
  currencyCode: z.string().trim().length(3),
  currencySymbol: z.string().trim().min(1).max(3),

  openingHours: z.array(openingHourRuleSchema).max(14),

  serviceChargeBps: z.coerce.number().int().min(0).max(5000),
  vatBps: z.coerce.number().int().min(0).max(5000),
  vatOnServiceCharge: z.boolean().default(false),
  roundingStepPoisa: z.coerce.number().int().min(1).max(1000).default(1),

  reservationSlotMinutes: z.coerce.number().int().min(5).max(180),
  reservationDurationMinutes: z.coerce.number().int().min(15).max(480),
  reservationBufferMinutes: z.coerce.number().int().min(0).max(240),
  reservationMaxDaysAhead: z.coerce.number().int().min(1).max(365),
  reservationCutoffMinutes: z.coerce.number().int().min(0).max(1440),
  reservationDepositPoisa: pricePoisa.default(0),
  requirePolicyAcceptance: z.boolean().default(true),

  allowDineIn: z.boolean(),
  allowTakeaway: z.boolean(),
  allowDelivery: z.boolean(),
  deliveryFeePoisa: pricePoisa.default(0),
  autoConfirmOrders: z.boolean().default(true),

  enablePartialPayments: z.boolean().default(true),
  /** "none" is the safe state: no gateway is contacted and the counter takes the bill. */
  paymentProvider: z.enum(["none", "simulated", "sslcommerz"]),
  paymentStoreId: z.string().trim().max(80).nullish(),

  chatbotEnabled: z.boolean(),
  chatbotFallbackOnly: z.boolean().default(false),
  emailNotificationsEnabled: z.boolean(),

  receiptFooter: z.string().trim().max(300),
  receiptHeader: z.string().trim().max(120),
});

/**
 * A provider switch is persisted whatever the environment holds: the refusal for a
 * gateway that cannot be reached happens when a guest tries to pay
 * (`resolveProvider`), and the settings screen warns before the save. Storing the
 * owner's choice and then silently rewriting it would make the audit trail of this
 * row disagree with what was on the screen.
 */
export type SettingsInput = z.infer<typeof settingsInputSchema>;
