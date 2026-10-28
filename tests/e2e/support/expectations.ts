/**
 * What the screens are *expected* to show, worked out from the database's own
 * settings rather than from a string typed into a spec.
 *
 * The money arithmetic lives in `src/lib/billing-math.ts` and is deliberately
 * borrowed from there: an end-to-end test that re-invents a restaurant's rounding
 * will fail for the wrong reason the first time the owner changes a setting. The
 * opening-hours check is written out again below instead, on purpose — a guest's
 * "open now" badge has to be provable without trusting the code that renders it.
 */

import { formatPoisa } from "../../../src/lib/money";

/**
 * The money string a screen must show. Taken from the app's own `formatPoisa`, so
 * a spec predicts `৳ 1,380` rather than a re-typed approximation of it — and fails
 * the day the rendering itself drifts.
 */
export function money(poisa: number, symbol: string): string {
  return formatPoisa(poisa, { symbol });
}

export { formatPoisa };

export type OpeningRule = { days: number[]; opens: string; closes: string };

const MINUTES_PER_DAY = 1_440;
/** `en-GB` gives the weekday name as `Sunday`..`Saturday`, index 0..6. */
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function toMinutes(label: string): number {
  const [hours = "0", minutes = "0"] = label.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Local weekday index (0 = Sunday) and minutes since local midnight, in the restaurant's zone. */
export function zonedClock(instant: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_NAMES.indexOf((values.get("weekday") ?? "Monday") as (typeof WEEKDAY_NAMES)[number]);
  const hour = Number(values.get("hour") ?? "0") % 24;
  const minute = Number(values.get("minute") ?? "0");
  return { weekday: weekday < 0 ? 1 : weekday, minutes: hour * 60 + minute };
}

/**
 * True when `instant` falls inside an opening range. A rule whose close is at or
 * before its open runs past midnight, so it is still holding the early hours of
 * the following day.
 */
export function isOpenNow(rules: OpeningRule[], timeZone: string, instant: Date): boolean {
  const { weekday, minutes } = zonedClock(instant, timeZone);
  for (const rule of rules) {
    if (!rule.days.includes(weekday)) continue;
    const open = toMinutes(rule.opens);
    const close = toMinutes(rule.closes);
    if (close > open ? minutes >= open && minutes < close : minutes >= open) return true;
  }
  for (const rule of rules) {
    if (!rule.days.includes((weekday + 6) % 7)) continue;
    if (toMinutes(rule.closes) > toMinutes(rule.opens)) continue;
    if (minutes < toMinutes(rule.closes)) return true;
  }
  return false;
}

/** `describeOpeningHours` in the app's words, built straight from the settings JSON. */
export function describeHours(rules: OpeningRule[]): string {
  if (rules.length === 0) return "Opening hours have not been configured yet.";
  return rules
    .map((rule) => `${rule.days.map((day) => WEEKDAY_NAMES[day] ?? "?").join(", ")}: ${rule.opens}–${rule.closes}`)
    .join("; ");
}

/** `YYYY-MM-DD` for the calendar day the restaurant is living through right now. */
export function zonedDateKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/**
 * A date key moved by whole calendar days. `T12:00:00Z` keeps the arithmetic in the
 * middle of the day, so no offset can push the result onto another date.
 */
export function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Weekday of a calendar date (0 = Sunday). The weekday of a date is pure calendar
 * arithmetic, so this deliberately takes no timezone — the same number the booking
 * service derives from its own wall-clock round trip.
 */
export function weekdayOfDateKey(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

/** Every slot the app may offer on a date, from the settings' own grid. */
export function offeredSlotTimes(
  rules: OpeningRule[],
  weekday: number,
  options: { slotMinutes: number; durationMinutes: number },
): string[] {
  const slot = Math.max(5, options.slotMinutes);
  const times: string[] = [];
  for (const rule of rules) {
    if (!rule.days.includes(weekday)) continue;
    const open = toMinutes(rule.opens);
    const close = toMinutes(rule.closes) > open ? toMinutes(rule.closes) : toMinutes(rule.closes) + MINUTES_PER_DAY;
    const lastStart = close - options.durationMinutes;
    for (let minutes = open; minutes <= lastStart && minutes < MINUTES_PER_DAY; minutes += slot) {
      const label = `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      if (!times.includes(label)) times.push(label);
    }
  }
  return times.sort();
}

export type ChargeSettings = {
  serviceChargeBps: number;
  vatBps: number;
  vatOnServiceCharge: boolean;
  roundingStepPoisa: number;
  deliveryFeePoisa: number;
  currencySymbol: string;
};

/**
 * The bill a guest should see for a set of priced lines. Mirrors
 * `computeTotals`: charges on the discounted net, VAT optionally on top of the
 * service charge, then a cash rounding step.
 */
export function expectedTotals(
  lineTotalsPoisa: number[],
  settings: ChargeSettings,
  options: { discountPoisa?: number; withDeliveryFee?: boolean } = {},
) {
  const subtotal = lineTotalsPoisa.reduce((total, line) => total + line, 0);
  const discount = options.discountPoisa ?? 0;
  const net = subtotal - discount;
  const serviceCharge = Math.round((net * settings.serviceChargeBps) / 10_000);
  const vatBase = settings.vatOnServiceCharge ? net + serviceCharge : net;
  const vat = Math.round((Math.max(0, vatBase) * settings.vatBps) / 10_000);
  const deliveryFee = options.withDeliveryFee ? settings.deliveryFeePoisa : 0;
  const beforeRounding = net + serviceCharge + vat + deliveryFee;
  const step = settings.roundingStepPoisa;
  const total = step > 1 ? Math.round(beforeRounding / step) * step : beforeRounding;
  return {
    subtotalPoisa: subtotal,
    serviceChargePoisa: serviceCharge,
    vatPoisa: vat,
    deliveryFeePoisa: deliveryFee,
    totalPoisa: total,
    totalLabel: formatPoisa(total, { symbol: settings.currencySymbol }),
  };
}

/** Percent label the admin screens use: two decimals, trailing `.00` dropped. */
export function percentLabel(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2).replace(/\.00$/, "");
}
