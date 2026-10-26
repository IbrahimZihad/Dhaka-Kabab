/**
 * Wall-clock handling. Booking instants are stored in UTC; everything the
 * restaurant reasons about (open hours, slot grids, "today's sales") happens in
 * the configured IANA timezone, default Asia/Dhaka.
 */

export type OpeningHourRule = { days: number[]; opens: string; closes: string };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = partsFormatters.get(timeZone);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hour12: false,
    });
    partsFormatters.set(timeZone, existing);
  }
  return existing;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

export type ZonedParts = {
  dateKey: string;
  time: string;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
};

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const mapped: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) mapped[part.type] = part.value;
  return {
    dateKey: `${mapped.year}-${mapped.month}-${mapped.day}`,
    time: `${mapped.hour.padStart(2, "0")}:${mapped.minute}`,
    hour: Number(mapped.hour) % 24,
    minute: Number(mapped.minute),
    weekday: WEEKDAY_INDEX[mapped.weekday ?? "Mon"] ?? 1,
  };
}

/** Minutes elapsed since local midnight, in the restaurant timezone. */
export function zonedMinutesOfDay(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}

function offsetAt(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    Number(parts.dateKey.slice(0, 4)),
    Number(parts.dateKey.slice(5, 7)) - 1,
    Number(parts.dateKey.slice(8, 10)),
    parts.hour,
    parts.minute,
    Number(instant.getUTCSeconds()),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000) * 60_000;
}

/** Converts a restaurant-local date + time to the UTC instant it refers to. */
export function wallToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every((n) => Number.isFinite(n))) {
    throw new Error(`Invalid local date/time ${dateKey} ${time}`);
  }
  // Two passes: the offset can differ across a DST boundary between guess and result.
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(naive - offsetAt(new Date(naive), timeZone));
  instant = new Date(naive - offsetAt(instant, timeZone));
  return instant;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

export function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

/** Local date key for "today" at the restaurant. */
export function todayKey(timeZone: string, now = new Date()): string {
  return zonedParts(now, timeZone).dateKey;
}

/** Start-of-day and start-of-next-day UTC instants bounding one local calendar day. */
export function dayRange(dateKey: string, timeZone: string): { start: Date; end: Date } {
  const start = wallToUtc(dateKey, "00:00", timeZone);
  const nextDay = new Date(`${dateKey}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const end = wallToUtc(nextDay.toISOString().slice(0, 10), "00:00", timeZone);
  return { start, end };
}

export function parseOpeningHours(raw: unknown): OpeningHourRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: OpeningHourRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const days = Array.isArray(candidate.days)
      ? candidate.days.filter((d) => typeof d === "number" && d >= 0 && d <= 6)
      : [];
    const opens = typeof candidate.opens === "string" ? candidate.opens : null;
    const closes = typeof candidate.closes === "string" ? candidate.closes : null;
    if (days.length === 0 || !opens || !closes) continue;
    rules.push({ days, opens, closes });
  }
  return rules;
}

export function rulesForDay(rules: OpeningHourRule[], weekday: number): OpeningHourRule[] {
  return rules.filter((rule) => rule.days.includes(weekday));
}

export function isOpenAt(instant: Date, rules: OpeningHourRule[], timeZone: string): boolean {
  const parts = zonedParts(instant, timeZone);
  const minutes = parts.hour * 60 + parts.minute;
  for (const rule of rulesForDay(rules, parts.weekday)) {
    const [oh, om] = rule.opens.split(":").map(Number);
    const [ch, cm] = rule.closes.split(":").map(Number);
    const open = oh * 60 + om;
    const close = ch * 60 + cm;
    // Closing before opening means the range rolls past midnight.
    if (close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close) return true;
  }
  return false;
}

/**
 * Booking slot start times for one local day, honouring every rule that covers
 * that weekday. A slot is offered only when the full seating window fits inside
 * an opening range and is not in the past.
 */
export function slotStartsForDay(
  dateKey: string,
  rules: OpeningHourRule[],
  options: { slotMinutes: number; durationMinutes: number; cutoffMinutes: number; now?: Date; timeZone: string },
): string[] {
  const weekday = zonedParts(wallToUtc(dateKey, "12:00", options.timeZone), options.timeZone).weekday;
  const dayRules = rulesForDay(rules, weekday);
  if (dayRules.length === 0) return [];

  const now = options.now ?? new Date();
  const minStart = minutesBetween(now, wallToUtc(dateKey, "00:00", options.timeZone)) - options.cutoffMinutes;
  const slot = Math.max(5, options.slotMinutes);
  const starts: string[] = [];

  for (const rule of dayRules) {
    const [oh, om] = rule.opens.split(":").map(Number);
    const [ch, cm] = rule.closes.split(":").map(Number);
    const open = oh * 60 + om;
    const close = ch * 60 + cm;
    const lastStart = close - options.durationMinutes;
    for (let minutes = open; minutes <= lastStart; minutes += slot) {
      if (minutes < minStart) continue;
      const label = `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      if (!starts.includes(label)) starts.push(label);
    }
  }
  return starts.sort();
}

export function formatInZone(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  }).format(instant);
}

export function formatTimeInZone(instant: Date, timeZone: string): string {
  return formatInZone(instant, timeZone, { day: undefined, month: undefined, year: undefined });
}

export function formatDateInZone(instant: Date, timeZone: string): string {
  return formatInZone(instant, timeZone, { hour: undefined, minute: undefined });
}

export function describeOpeningHours(rules: OpeningHourRule[]): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (rules.length === 0) return "Opening hours have not been configured yet.";
  return rules
    .map((rule) => {
      const days = rule.days.map((d) => names[d]).join(", ");
      return `${days}: ${rule.opens}–${rule.closes}`;
    })
    .join("; ");
}
