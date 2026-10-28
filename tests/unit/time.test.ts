import { describe, expect, it } from "vitest";
import {
  addMinutes,
  dayRange,
  isOpenAt,
  minutesBetween,
  parseOpeningHours,
  rulesForDay,
  slotStartsForDay,
  todayKey,
  wallToUtc,
  zonedParts,
  type OpeningHourRule,
} from "@/lib/time";

/**
 * `src/lib/time.ts`. Everything here is anchored to fixed UTC instants plus an
 * explicit `now`, so no test can drift with the wall clock. Asia/Dhaka is UTC+6
 * with no DST, so `2026-10-28T00:00 local` is always `2026-10-27T18:00Z`.
 *
 * Calendar anchors for October 2026: Sun 25, Mon 26, Tue 27, Wed 28, Thu 29,
 * Fri 30, Sat 31.
 */

const DHAKA = "Asia/Dhaka";

/** 2026-10-28 00:00 Asia/Dhaka. */
const WED_MIDNIGHT_UTC = "2026-10-27T18:00:00Z";
/** 2026-10-28 09:20 Asia/Dhaka. */
const WED_0920_UTC = "2026-10-28T03:20:00Z";
/** 2026-10-28 09:30 Asia/Dhaka. */
const WED_0930_UTC = "2026-10-28T03:30:00Z";

function at(iso: string): Date {
  return new Date(iso);
}

/** Local wall-clock instant in Dhaka, built from hours and minutes of 2026-10-28. */
function dhakaWednesday(hhmm: string): Date {
  return wallToUtc("2026-10-28", hhmm, DHAKA);
}

/** Local wall-clock instant in Dhaka on 2026-10-29, the day after. */
function dhakaThursday(hhmm: string): Date {
  return wallToUtc("2026-10-29", hhmm, DHAKA);
}

describe("zonedParts", () => {
  it.each([
    { name: "local midnight", iso: WED_MIDNIGHT_UTC, dateKey: "2026-10-28", time: "00:00", hour: 0, minute: 0, weekday: 3 },
    { name: "local noon", iso: "2026-10-28T06:00:00Z", dateKey: "2026-10-28", time: "12:00", hour: 12, minute: 0, weekday: 3 },
    { name: "last minute of the day", iso: "2026-10-28T17:59:00Z", dateKey: "2026-10-28", time: "23:59", hour: 23, minute: 59, weekday: 3 },
    { name: "Sunday", iso: "2026-10-24T18:00:00Z", dateKey: "2026-10-25", time: "00:00", hour: 0, minute: 0, weekday: 0 },
    { name: "Saturday", iso: "2026-10-30T18:00:00Z", dateKey: "2026-10-31", time: "00:00", hour: 0, minute: 0, weekday: 6 },
  ])(
    "$name: $dateKey $time (weekday $weekday)",
    ({ iso, dateKey, time, hour, minute, weekday }) => {
      const parts = zonedParts(at(iso), DHAKA);
      expect(parts).toEqual({ dateKey, time, hour, minute, weekday });
    },
  );

  it("names the local day, not the UTC day", () => {
    const instant = at("2026-10-27T18:30:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-10-27");
    expect(zonedParts(instant, DHAKA).dateKey).toBe("2026-10-28");
    expect(zonedParts(instant, "UTC").dateKey).toBe("2026-10-27");
  });

  it("agrees with Intl on an unrelated zone", () => {
    const instant = at("2026-10-28T00:30:00Z");
    expect(zonedParts(instant, "UTC")).toEqual({
      dateKey: "2026-10-28",
      time: "00:30",
      hour: 0,
      minute: 30,
      weekday: 3,
    });
  });

  it("rejects an unknown IANA zone rather than guessing", () => {
    expect(() => zonedParts(at(WED_MIDNIGHT_UTC), "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("wallToUtc", () => {
  const cases: { name: string; dateKey: string; time: string; iso: string; zone?: string }[] = [
    { name: "midnight", dateKey: "2026-10-28", time: "00:00", iso: WED_MIDNIGHT_UTC },
    { name: "dinner service", dateKey: "2026-10-28", time: "20:15", iso: "2026-10-28T14:15:00Z" },
    { name: "last minute", dateKey: "2026-10-28", time: "23:59", iso: "2026-10-28T17:59:00Z" },
    { name: "same instant in UTC", dateKey: "2026-10-28", time: "00:00", iso: "2026-10-28T00:00:00Z", zone: "UTC" },
  ];
  it.each(cases)("$name", ({ dateKey, time, iso, zone }) => {
    expect(wallToUtc(dateKey, time, zone ?? DHAKA).toISOString()).toBe(`${iso.slice(0, 19)}.000Z`);
  });

  it("is the inverse of zonedParts", () => {
    const instant = wallToUtc("2026-10-28", "18:05", DHAKA);
    const parts = zonedParts(instant, DHAKA);
    expect({ dateKey: parts.dateKey, time: parts.time }).toEqual({ dateKey: "2026-10-28", time: "18:05" });
  });

  it.each([
    { name: "missing time parts", dateKey: "2026-10-28", time: "18" },
    { name: "letters in the date", dateKey: "not-a-date", time: "18:00" },
    { name: "empty date", dateKey: "", time: "18:00" },
  ])("throws on $name", ({ dateKey, time }) => {
    expect(() => wallToUtc(dateKey, time, DHAKA)).toThrow(/Invalid local date\/time/);
  });
});

describe("dayRange", () => {
  it("bounds exactly one Dhaka day with real UTC instants", () => {
    const { start, end } = dayRange("2026-10-28", DHAKA);
    expect(start.toISOString()).toBe("2026-10-27T18:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-28T18:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("starts on the local day and hands the next day to `end`", () => {
    const { start, end } = dayRange("2026-10-28", DHAKA);
    expect(zonedParts(start, DHAKA).dateKey).toBe("2026-10-28");
    expect(zonedParts(end, DHAKA).dateKey).toBe("2026-10-29");
  });

  it.each([
    { name: "month end", dateKey: "2026-10-31", nextKey: "2026-11-01" },
    { name: "year end", dateKey: "2026-12-31", nextKey: "2027-01-01" },
    { name: "non-leap 28 February", dateKey: "2026-02-28", nextKey: "2026-03-01" },
    { name: "leap 28 February", dateKey: "2028-02-28", nextKey: "2028-02-29" },
  ])("rolls over at $name", ({ dateKey, nextKey }) => {
    const { start, end } = dayRange(dateKey, DHAKA);
    expect(zonedParts(start, DHAKA).dateKey).toBe(dateKey);
    expect(zonedParts(end, DHAKA).dateKey).toBe(nextKey);
  });

  it("is the same pair of instants wallToUtc would produce", () => {
    const { start, end } = dayRange("2026-10-28", DHAKA);
    expect(start.getTime()).toBe(wallToUtc("2026-10-28", "00:00", DHAKA).getTime());
    expect(end.getTime()).toBe(wallToUtc("2026-10-29", "00:00", DHAKA).getTime());
  });
});

describe("addMinutes", () => {
  it("adds exactly the requested minutes", () => {
    const base = at("2026-10-28T06:00:00Z");
    expect(addMinutes(base, 0).toISOString()).toBe("2026-10-28T06:00:00.000Z");
    expect(addMinutes(base, 90).toISOString()).toBe("2026-10-28T07:30:00.000Z");
    expect(addMinutes(base, -30).toISOString()).toBe("2026-10-28T05:30:00.000Z");
  });

  it("never mutates the input date", () => {
    const base = at("2026-10-28T06:00:00Z");
    addMinutes(base, 120);
    expect(base.toISOString()).toBe("2026-10-28T06:00:00.000Z");
  });
});

describe("minutesBetween", () => {
  it.each([
    { name: "forward", from: "2026-10-28T06:00:00Z", to: "2026-10-28T07:30:00Z", expected: 90 },
    { name: "backwards", from: "2026-10-28T07:30:00Z", to: "2026-10-28T06:00:00Z", expected: -90 },
    { name: "same instant", from: "2026-10-28T06:00:00Z", to: "2026-10-28T06:00:00Z", expected: 0 },
    { name: "half a minute rounds up", from: "2026-10-28T06:00:00Z", to: "2026-10-28T06:00:30Z", expected: 1 },
    { name: "across a UTC day boundary", from: "2026-10-28T06:00:00Z", to: "2026-10-29T06:00:00Z", expected: 1440 },
  ])("$name", ({ from, to, expected }) => {
    expect(minutesBetween(at(from), at(to))).toBe(expected);
  });

  it("counts one Dhaka day as 1440 minutes", () => {
    const { start, end } = dayRange("2026-10-28", DHAKA);
    expect(minutesBetween(start, end)).toBe(1440);
  });
});

describe("todayKey", () => {
  it.each([
    { name: "one second before local midnight", iso: "2026-10-27T17:59:59Z", expected: "2026-10-27" },
    { name: "exactly local midnight", iso: WED_MIDNIGHT_UTC, expected: "2026-10-28" },
    { name: "last minute of the local day", iso: "2026-10-28T17:59:59Z", expected: "2026-10-28" },
    { name: "the local day rolls over", iso: "2026-10-28T18:00:00Z", expected: "2026-10-29" },
  ])("$name -> $expected", ({ iso, expected }) => {
    expect(todayKey(DHAKA, at(iso))).toBe(expected);
  });

  it("is zone dependent for the same instant", () => {
    const instant = at("2026-10-27T19:00:00Z");
    expect(todayKey("UTC", instant)).toBe("2026-10-27");
    expect(todayKey(DHAKA, instant)).toBe("2026-10-28");
  });
});

describe("parseOpeningHours", () => {
  it("keeps well-formed rules verbatim", () => {
    const raw = [
      { days: [1, 2, 3], opens: "12:00", closes: "23:00" },
      { days: [5, 6], opens: "18:00", closes: "02:00" },
    ];
    expect(parseOpeningHours(raw)).toEqual(raw);
  });

  it.each([
    { name: "null", raw: null },
    { name: "undefined", raw: undefined },
    { name: "a bare object", raw: {} },
    { name: "a string", raw: "12:00-23:00" },
    { name: "a number", raw: 7 },
  ])("returns [] for non-array input ($name)", ({ raw }) => {
    expect(parseOpeningHours(raw)).toEqual([]);
  });

  it.each([
    { name: "null entry", raw: [null] },
    { name: "string entry", raw: ["12:00"] },
    { name: "numeric entry", raw: [42] },
    { name: "no days", raw: [{ opens: "12:00", closes: "23:00" }] },
    { name: "empty days", raw: [{ days: [], opens: "12:00", closes: "23:00" }] },
    { name: "days not an array", raw: [{ days: "1234", opens: "12:00", closes: "23:00" }] },
    { name: "days out of weekday range", raw: [{ days: [7, -1, 99], opens: "12:00", closes: "23:00" }] },
    { name: "non-numeric days", raw: [{ days: ["Mon", null, undefined], opens: "12:00", closes: "23:00" }] },
    { name: "missing opens", raw: [{ days: [1], closes: "23:00" }] },
    { name: "missing closes", raw: [{ days: [1], opens: "12:00" }] },
    { name: "opens not a string", raw: [{ days: [1], opens: 720, closes: "23:00" }] },
    { name: "extra keys only", raw: [{ id: "x", label: "y" }] },
  ])("drops junk entry: $name", ({ raw }) => {
    expect(parseOpeningHours(raw)).toEqual([]);
  });

  it("keeps an in-range fractional day and an unparsable clock", () => {
    // Only the shape is validated; `1.5` can never match a weekday and "25:00"
    // becomes minute 1500, so both are inert rather than dangerous.
    expect(parseOpeningHours([{ days: [1.5], opens: "12:00", closes: "23:00" }])).toEqual([
      { days: [1.5], opens: "12:00", closes: "23:00" },
    ]);
    expect(parseOpeningHours([{ days: [1], opens: "25:00", closes: "99:99" }])).toEqual([
      { days: [1], opens: "25:00", closes: "99:99" },
    ]);
  });

  it("drops the junk rows but keeps the good ones", () => {
    const raw = [null, { days: [3], opens: "12:00", closes: "23:00" }, { days: [3] }];
    expect(parseOpeningHours(raw)).toEqual([{ days: [3], opens: "12:00", closes: "23:00" }]);
  });
});

describe("rulesForDay", () => {
  const rules: OpeningHourRule[] = [
    { days: [1, 2, 3, 4, 5], opens: "12:00", closes: "23:00" },
    { days: [6, 0], opens: "13:00", closes: "22:00" },
  ];

  it.each([
    { weekday: 0, count: 1 },
    { weekday: 3, count: 1 },
    { weekday: 6, count: 1 },
  ])("weekday $weekday matches $count rule", ({ weekday, count }) => {
    expect(rulesForDay(rules, weekday)).toHaveLength(count);
  });

  it("returns [] for a weekday nothing covers", () => {
    expect(rulesForDay(rules, 9)).toEqual([]);
    expect(rulesForDay([], 3)).toEqual([]);
  });
});

describe("isOpenAt", () => {
  const lunchAndDinner: OpeningHourRule[] = [
    { days: [3], opens: "12:00", closes: "15:00" },
    { days: [3], opens: "18:00", closes: "23:00" },
  ];

  it.each([
    { name: "one minute before opening", hhmm: "11:59", expected: false },
    { name: "opening minute is inclusive", hhmm: "12:00", expected: true },
    { name: "mid-afternoon", hhmm: "13:30", expected: true },
    { name: "closing minute is exclusive", hhmm: "15:00", expected: false },
    { name: "the dead gap between services", hhmm: "16:00", expected: false },
    { name: "dinner service", hhmm: "18:00", expected: true },
    { name: "one minute before close", hhmm: "22:59", expected: true },
    { name: "midnight", hhmm: "00:00", expected: false },
  ])("Wednesday 12:00-15:00 + 18:00-23:00: $name", ({ hhmm, expected }) => {
    expect(isOpenAt(dhakaWednesday(hhmm), lunchAndDinner, DHAKA)).toBe(expected);
  });

  it("ignores rules for other weekdays", () => {
    const thursday = wallToUtc("2026-10-29", "13:00", DHAKA);
    expect(isOpenAt(thursday, lunchAndDinner, DHAKA)).toBe(false);
  });

  it("treats a 00:00-00:00 rule as open around the clock", () => {
    const always: OpeningHourRule[] = [{ days: [3], opens: "00:00", closes: "00:00" }];
    for (const hhmm of ["00:00", "03:00", "12:00", "23:59"]) {
      expect(isOpenAt(dhakaWednesday(hhmm), always, DHAKA)).toBe(true);
    }
  });

  describe("a range that rolls past midnight (Wednesday 18:00-02:00)", () => {
    const lateNight: OpeningHourRule[] = [{ days: [3], opens: "18:00", closes: "02:00" }];

    it("is open in the early part of the range", () => {
      expect(isOpenAt(dhakaWednesday("18:00"), lateNight, DHAKA)).toBe(true);
      expect(isOpenAt(dhakaWednesday("23:59"), lateNight, DHAKA)).toBe(true);
    });

    it("keeps serving after midnight, under the day the service started", () => {
      // Thursday 01:00 is still inside the Wednesday 18:00-02:00 range.
      const thursdayOneAm = wallToUtc("2026-10-29", "01:00", DHAKA);
      expect(isOpenAt(thursdayOneAm, lateNight, DHAKA)).toBe(true);
      expect(isOpenAt(wallToUtc("2026-10-29", "02:00", DHAKA), lateNight, DHAKA)).toBe(false);
    });

    it("does not credit today's early hours to tonight's rule", () => {
      // Wednesday 01:00 would belong to a Tuesday-night range; there is none, so
      // the restaurant is shut even though the Wednesday rule lists 02:00.
      expect(isOpenAt(dhakaWednesday("01:00"), lateNight, DHAKA)).toBe(false);
      expect(isOpenAt(dhakaWednesday("17:59"), lateNight, DHAKA)).toBe(false);
    });
  });
});

describe("slotStartsForDay", () => {
  const wednesdayLunch: OpeningHourRule[] = [{ days: [3], opens: "12:00", closes: "14:00" }];

  it("offers a slot only when the whole seating still fits", () => {
    const starts = slotStartsForDay("2026-10-28", wednesdayLunch, {
      slotMinutes: 30,
      durationMinutes: 60,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    expect(starts).toEqual(["12:00", "12:30", "13:00"]);
  });

  it("drops every slot when the seating window is longer than the range", () => {
    const starts = slotStartsForDay("2026-10-28", [{ days: [3], opens: "12:00", closes: "12:30" }], {
      slotMinutes: 15,
      durationMinutes: 60,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    expect(starts).toEqual([]);
  });

  it("keeps the last start that ends exactly at closing time", () => {
    const starts = slotStartsForDay("2026-10-28", wednesdayLunch, {
      slotMinutes: 60,
      durationMinutes: 120,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    expect(starts).toEqual(["12:00"]);
  });

  it.each([
    { name: "20 minutes past 09:20", now: WED_0920_UTC, cutoff: 30, expected: ["10:00", "10:30", "11:00"] },
    { name: "exactly at the cutoff (09:30 + 30 = 10:00)", now: WED_0930_UTC, cutoff: 30, expected: ["10:00", "10:30", "11:00"] },
    { name: "cutoff pushed to 60 minutes", now: WED_0930_UTC, cutoff: 60, expected: ["10:30", "11:00"] },
    { name: "cutoff longer than the service", now: WED_0930_UTC, cutoff: 240, expected: [] },
  ])("cutoff rule, 09:00-12:00 service, $name", ({ now, cutoff, expected }) => {
    const starts = slotStartsForDay("2026-10-28", [{ days: [3], opens: "09:00", closes: "12:00" }], {
      slotMinutes: 30,
      durationMinutes: 60,
      cutoffMinutes: cutoff,
      now: at(now),
      timeZone: DHAKA,
    });
    expect(starts).toEqual(expected);
  });

  it("keeps every slot for a future date", () => {
    const mondayTenAm = wallToUtc("2026-10-26", "10:00", DHAKA);
    const starts = slotStartsForDay("2026-10-28", wednesdayLunch, {
      slotMinutes: 30,
      durationMinutes: 60,
      cutoffMinutes: 120,
      now: mondayTenAm,
      timeZone: DHAKA,
    });
    expect(starts).toEqual(["12:00", "12:30", "13:00"]);
  });

  it("offers nothing for a date that has already passed", () => {
    const starts = slotStartsForDay("2026-10-26", [{ days: [1], opens: "12:00", closes: "23:00" }], {
      slotMinutes: 30,
      durationMinutes: 60,
      cutoffMinutes: 0,
      now: dhakaWednesday("09:00"),
      timeZone: DHAKA,
    });
    expect(starts).toEqual([]);
  });

  it("picks the weekday from local noon, not from UTC", () => {
    // 2026-10-27T18:30Z is Tuesday in UTC but Wednesday in Dhaka.
    const starts = slotStartsForDay("2026-10-28", wednesdayLunch, {
      slotMinutes: 60,
      durationMinutes: 60,
      cutoffMinutes: 0,
      now: at("2026-10-27T18:30:00Z"),
      timeZone: DHAKA,
    });
    expect(starts).toEqual(["12:00", "13:00"]);
  });

  it("returns [] when no rule covers the weekday", () => {
    const starts = slotStartsForDay("2026-10-26", wednesdayLunch, {
      slotMinutes: 30,
      durationMinutes: 60,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    expect(starts).toEqual([]);
  });

  it("never builds a grid finer than five minutes", () => {
    const starts = slotStartsForDay("2026-10-28", [{ days: [3], opens: "12:00", closes: "12:20" }], {
      slotMinutes: 1,
      durationMinutes: 0,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    expect(starts).toEqual(["12:00", "12:05", "12:10", "12:15", "12:20"]);
  });

  it("de-duplicates overlapping rules and returns the grid sorted", () => {
    const rules: OpeningHourRule[] = [
      { days: [3], opens: "18:00", closes: "20:00" },
      { days: [3], opens: "12:00", closes: "14:00" },
      { days: [3], opens: "12:00", closes: "13:00" },
    ];
    const starts = slotStartsForDay("2026-10-28", rules, {
      slotMinutes: 60,
      durationMinutes: 60,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    expect(starts).toEqual(["12:00", "13:00", "18:00", "19:00"]);
  });

  it("returns wall-clock labels that round-trip back through wallToUtc", () => {
    const starts = slotStartsForDay("2026-10-28", wednesdayLunch, {
      slotMinutes: 30,
      durationMinutes: 60,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    for (const label of starts) {
      expect(zonedParts(wallToUtc("2026-10-28", label, DHAKA), DHAKA).time).toBe(label);
    }
  });

  it("offers a rolling range up to midnight on its own date", () => {
    // 18:00-02:00 with a 90-minute seating: the last Wednesday start is 23:00,
    // because 00:00 belongs to the next calendar day's grid.
    const rolling = [{ days: [3], opens: "18:00", closes: "02:00" }];
    const starts = slotStartsForDay("2026-10-28", rolling, {
      slotMinutes: 60,
      durationMinutes: 90,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    expect(starts).toEqual(["18:00", "19:00", "20:00", "21:00", "22:00", "23:00"]);
  });

  it("offers the early-morning tail of last night's shift on the next date", () => {
    // Thursday has no rule of its own, but Wednesday's 18:00-02:00 service is
    // still open until 02:00, so 00:00 is bookable (the seating ends at 01:30).
    const rolling = [{ days: [3], opens: "18:00", closes: "02:00" }];
    const starts = slotStartsForDay("2026-10-29", rolling, {
      slotMinutes: 60,
      durationMinutes: 90,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    expect(starts).toEqual(["00:00"]);
  });

  it("drops a tail slot whose seating window would run past the close", () => {
    // A 150-minute seating starting 00:00 ends 02:30, past the 02:00 close, so
    // the overnight tail of Wednesday's shift books nothing on Thursday.
    const rolling = [{ days: [3], opens: "18:00", closes: "02:00" }];
    const starts = slotStartsForDay("2026-10-29", rolling, {
      slotMinutes: 60,
      durationMinutes: 150,
      cutoffMinutes: 0,
      now: at(WED_MIDNIGHT_UTC),
      timeZone: DHAKA,
    });
    expect(starts).toEqual([]);
  });
});

describe("canonical invariants (exact literals)", () => {
  it("maps a dinner wall-clock to UTC and reads it straight back on the same date", () => {
    // Asia/Dhaka is UTC+6, so 20:00 local is 14:00Z.
    const instant = wallToUtc("2026-10-28", "20:00", DHAKA);
    expect(instant.toISOString()).toBe("2026-10-28T14:00:00.000Z");
    expect(zonedParts(instant, DHAKA)).toMatchObject({ dateKey: "2026-10-28", time: "20:00" });
  });

  it("keeps a midnight-rolling shift open late and just after midnight, shut past close", () => {
    // A 20:00-01:00 rule tagged to Wednesday serves 20:00-23:59 on Wednesday and
    // 00:00-00:59 on Thursday — the early hours belong to the service that
    // started the night before, which is how staff wrote it and how the booking
    // guard reads it.
    const rolling: OpeningHourRule[] = [{ days: [3], opens: "20:00", closes: "01:00" }];
    expect(isOpenAt(dhakaWednesday("23:30"), rolling, DHAKA)).toBe(true);
    expect(isOpenAt(dhakaWednesday("00:30"), rolling, DHAKA)).toBe(false);
    expect(isOpenAt(dhakaThursday("00:30"), rolling, DHAKA)).toBe(true);
    expect(isOpenAt(dhakaThursday("01:30"), rolling, DHAKA)).toBe(false);
    expect(isOpenAt(dhakaThursday("20:30"), rolling, DHAKA)).toBe(false);
  });

  it("bounds one local day exactly 1440 minutes apart", () => {
    const { start, end } = dayRange("2026-10-28", DHAKA);
    expect(minutesBetween(start, end)).toBe(1440);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
