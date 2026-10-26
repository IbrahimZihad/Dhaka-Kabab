import { prisma, type Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { RestaurantSettings } from "@prisma/client";

/**
 * Restaurant configuration. A singleton row; secrets deliberately live in the
 * environment instead, so this object is safe to hand to a settings screen.
 */

export const SETTINGS_ID = "default";

export const DEFAULT_SETTINGS: Omit<RestaurantSettings, "id" | "createdAt" | "updatedAt" | "updatedByUserId"> = {
  name: "Dhaka Kabab",
  logoUrl: null,
  addressLine1: "",
  addressLine2: null,
  city: "",
  country: "Bangladesh",
  phonePrimary: "",
  phoneSecondary: null,
  emailPublic: "",
  mapsUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  timezone: "Asia/Dhaka",
  currencyCode: "BDT",
  currencySymbol: "৳",
  openingHours: [],
  contactNote: null,
  serviceChargeBps: 0,
  vatBps: 0,
  vatOnServiceCharge: false,
  roundingStepPoisa: 1,
  reservationSlotMinutes: 30,
  reservationDurationMinutes: 90,
  reservationBufferMinutes: 15,
  reservationMaxDaysAhead: 60,
  reservationCutoffMinutes: 60,
  reservationDepositPoisa: 0,
  requirePolicyAcceptance: true,
  allowDineIn: true,
  allowTakeaway: true,
  allowDelivery: false,
  deliveryFeePoisa: 0,
  autoConfirmOrders: true,
  enablePartialPayments: true,
  paymentProvider: "simulated",
  paymentStoreId: null,
  chatbotEnabled: true,
  chatbotFallbackOnly: false,
  emailNotificationsEnabled: false,
  receiptFooter: "Thank you for dining with us.",
  receiptHeader: "Dhaka Kabab",
};

// Read once per render tree would be dozens of round trips on a dashboard page.
// Values change on the order of times-per-day, so a short TTL is enough.
let cache: { value: RestaurantSettings; expiresAt: number } | null = null;
const CACHE_MS = 10_000;

export function invalidateSettingsCache(): void {
  cache = null;
}

export async function ensureSettings(client: Db = prisma): Promise<RestaurantSettings> {
  const existing = await client.restaurantSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  const created = await client.restaurantSettings.create({
    data: { id: SETTINGS_ID, ...DEFAULT_SETTINGS },
  });
  cache = { value: created, expiresAt: Date.now() + CACHE_MS };
  return created;
}

export async function getSettings(client: Db = prisma): Promise<RestaurantSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const settings = await ensureSettings(client);
  cache = { value: settings, expiresAt: Date.now() + CACHE_MS };
  return settings;
}

export type SettingsPatch = Partial<typeof DEFAULT_SETTINGS>;

export async function updateSettings(
  patch: SettingsPatch,
  actor: { userId: string; role: string } | null,
  meta?: { ip?: string },
): Promise<RestaurantSettings> {
  const before = await ensureSettings();
  const settings = await prisma.restaurantSettings.update({
    where: { id: SETTINGS_ID },
    data: { ...patch, updatedByUserId: actor?.userId ?? null },
  });
  invalidateSettingsCache();
  await writeAudit({
    actorUserId: actor?.userId ?? null,
    action: "settings.update",
    entityType: "RestaurantSettings",
    entityId: SETTINGS_ID,
    before,
    after: settings,
    meta: { changedKeys: Object.keys(patch), role: actor?.role },
    ip: meta?.ip,
  });
  return settings;
}

/** Fields the browser may see. Never add anything credential-shaped here. */
export function publicSettings(settings: RestaurantSettings) {
  return {
    name: settings.name,
    logoUrl: settings.logoUrl,
    addressLine1: settings.addressLine1,
    addressLine2: settings.addressLine2,
    city: settings.city,
    country: settings.country,
    phonePrimary: settings.phonePrimary,
    phoneSecondary: settings.phoneSecondary,
    emailPublic: settings.emailPublic,
    mapsUrl: settings.mapsUrl,
    facebookUrl: settings.facebookUrl,
    instagramUrl: settings.instagramUrl,
    timezone: settings.timezone,
    currencyCode: settings.currencyCode,
    currencySymbol: settings.currencySymbol,
    openingHours: settings.openingHours,
    contactNote: settings.contactNote,
    allowDineIn: settings.allowDineIn,
    allowTakeaway: settings.allowTakeaway,
    allowDelivery: settings.allowDelivery,
    chatbotEnabled: settings.chatbotEnabled,
  };
}

export function moneySettings(settings: RestaurantSettings) {
  return {
    currencyCode: settings.currencyCode,
    currencySymbol: settings.currencySymbol,
    serviceChargeBps: settings.serviceChargeBps,
    vatBps: settings.vatBps,
    vatOnServiceCharge: settings.vatOnServiceCharge,
    roundingStepPoisa: settings.roundingStepPoisa,
  };
}
