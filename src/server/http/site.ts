import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import { getSettings, moneySettings, publicSettings } from "@/server/services/settings.service";
import { describeOpeningHours, formatInZone, isOpenAt, parseOpeningHours, zonedParts } from "@/lib/time";

/**
 * The restaurant's identity for document titles and metadata. It is cached with
 * the `settings` tag because a page head cannot stream: the staff settings screen
 * retags it on save, so a renamed restaurant stops appearing in old titles.
 */
export async function siteIdentity() {
  "use cache";
  cacheLife("hours");
  cacheTag("settings");
  const settings = await getSettings();
  return {
    name: settings.name,
    city: settings.city,
    currencySymbol: settings.currencySymbol,
  };
}

/**
 * What a public page may render: the restaurant's own words and opening state,
 * read from the database on every request. Nothing here is a placeholder — an
 * unset address or phone renders as "not recorded yet", because a invented
 * address sends people to the wrong door.
 */
export async function siteContext() {
  // "Open now" and the local clock are true of the minute the guest asked, so this
  // subtree is deliberately left to request time rather than baked into a shell.
  await connection();
  const settings = await getSettings();
  const rules = parseOpeningHours(settings.openingHours);
  const now = new Date();
  const timeZone = settings.timezone;

  return {
    info: publicSettings(settings),
    money: moneySettings(settings),
    /** What a booking form must be honest about: how long a table is held, how far ahead we take bookings, whether a deposit is expected. */
    booking: {
      slotMinutes: settings.reservationSlotMinutes,
      durationMinutes: settings.reservationDurationMinutes,
      maxDaysAhead: settings.reservationMaxDaysAhead,
      cutoffMinutes: settings.reservationCutoffMinutes,
      depositPoisa: settings.reservationDepositPoisa,
      requirePolicyAcceptance: settings.requirePolicyAcceptance,
    },
    open: isOpenAt(now, rules, timeZone),
    hours: describeOpeningHours(rules),
    /** The restaurant's own clock, so "today" means their today. */
    todayKey: zonedParts(now, timeZone).dateKey,
    clock: formatInZone(now, timeZone, { hour: "2-digit", minute: "2-digit" }),
    timeZone,
  };
}

export type SiteContext = Awaited<ReturnType<typeof siteContext>>;

/** Renders a configured detail, or an honest "not recorded" when staff have not entered one. */
export function orUnset(value: string | null | undefined, label = "not recorded yet") {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : label;
}
