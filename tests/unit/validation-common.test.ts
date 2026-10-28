import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { bdPhone, dateKeySchema, phoneSearchDigits, timeOfDaySchema } from "@/server/validation/common";

/**
 * `src/server/validation/common.ts` — the validators that stand between a form
 * value and a database write. A date key that passes the shape but is not a real
 * calendar day would otherwise surface as a 500 inside the day-window helper.
 */

function failureMessage(parse: { success: boolean; error?: ZodError }, valid: boolean): string {
  expect(valid, "this helper is only for refusals").toBe(false);
  const [issue] = parse.error?.issues ?? [];
  return issue?.message ?? "<no issue>";
}

describe("dateKeySchema", () => {
  const accepted: { name: string; value: string }[] = [
    { name: "an ordinary day", value: "2026-10-28" },
    { name: "first of the year", value: "2026-01-01" },
    { name: "last of the year", value: "2026-12-31" },
    { name: "end of a 31-day month", value: "2026-01-31" },
    { name: "end of a 30-day month", value: "2026-06-30" },
    { name: "February in a common year", value: "2026-02-28" },
    { name: "February 29 in a leap year", value: "2028-02-29" },
    { name: "the century leap year", value: "2000-02-29" },
  ];

  it.each(accepted)("accepts $name", ({ value }) => {
    expect(dateKeySchema.safeParse(value).success).toBe(true);
    expect(dateKeySchema.safeParse(value).data).toBe(value);
  });

  const malformed: { name: string; value: string }[] = [
    { name: "empty string", value: "" },
    { name: "single digit parts", value: "2026-1-1" },
    { name: "slashes", value: "2026/10/28" },
    { name: "no separators", value: "20261028" },
    { name: "two digit year", value: "26-10-28" },
    { name: "trailing time", value: "2026-10-28T00:00:00Z" },
    { name: "trailing space", value: "2026-10-28 " },
    { name: "not a date at all", value: "today" },
  ];

  it.each(malformed)("refuses $name with the shape message", ({ value }) => {
    const result = dateKeySchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(failureMessage(result, false)).toBe("Choose a date.");
  });

  const impossible: { name: string; value: string }[] = [
    { name: "month 13 day 45", value: "2026-13-45" },
    { name: "February 30", value: "2026-02-30" },
    { name: "month 00", value: "2026-00-01" },
    { name: "day 00", value: "2026-10-00" },
    { name: "month 99", value: "2026-99-99" },
    { name: "February 29 in a common year", value: "2026-02-29" },
    { name: "April 31", value: "2026-04-31" },
    { name: "day 32", value: "2026-01-32" },
    { name: "a year below 100 that Date.UTC would remap", value: "0050-01-01" },
  ];

  it.each(impossible)("refuses $name with the calendar message", ({ value }) => {
    const result = dateKeySchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(failureMessage(result, false)).toBe("That date does not exist.");
  });

  it("rejects a non-string input", () => {
    expect(dateKeySchema.safeParse(new Date("2026-10-28T00:00:00Z")).success).toBe(false);
    expect(dateKeySchema.safeParse(20_261_028).success).toBe(false);
  });
});

describe("bdPhone", () => {
  const accepted: { name: string; value: string; normalised: string }[] = [
    { name: "local trunk form", value: "01712345678", normalised: "01712345678" },
    { name: "international with plus", value: "+8801712345678", normalised: "01712345678" },
    { name: "international without plus", value: "8801712345678", normalised: "01712345678" },
    { name: "bare subscriber number", value: "1712345678", normalised: "01712345678" },
    { name: "spaces", value: "01712 345 678", normalised: "01712345678" },
    { name: "dashes", value: "01712-345-678", normalised: "01712345678" },
    { name: "parentheses", value: "(01712) 345678", normalised: "01712345678" },
    { name: "international with separators", value: "+880 17-1234 5678", normalised: "01712345678" },
    { name: "surrounding whitespace", value: "  01812345678  ", normalised: "01812345678" },
    { name: "every mobile prefix 13-19", value: "+8801912345678", normalised: "01912345678" },
  ];

  it.each(accepted)("accepts $name and normalises to $normalised", ({ value, normalised }) => {
    const result = bdPhone.safeParse(value);
    expect(result.success, `${value} should pass`).toBe(true);
    expect(result.data).toBe(normalised);
  });

  it.each(["13", "14", "15", "16", "17", "18", "19"])(
    "accepts the 0$s mobile prefix",
    (prefix) => {
      expect(bdPhone.safeParse(`0${prefix}12345678`).success).toBe(true);
    },
  );

  const refused: { name: string; value: string }[] = [
    { name: "empty string", value: "" },
    { name: "a Dhaka landline", value: "0255001234" },
    { name: "a landline with the country code", value: "+880255001234" },
    { name: "one digit short", value: "0171234567" },
    { name: "one digit too many", value: "017123456789" },
    { name: "prefix 12 is not a mobile range", value: "01212345678" },
    { name: "prefix 10 is not a mobile range", value: "01012345678" },
    { name: "letters", value: "017abcdefgh" },
    { name: "a short code", value: "999" },
    { name: "an old-style number without the 1", value: "880171234567" },
    { name: "only a country code", value: "+880" },
  ];

  it.each(refused)("refuses $name", ({ value }) => {
    const result = bdPhone.safeParse(value);
    expect(result.success, `${value} should fail`).toBe(false);
    expect(failureMessage(result, false)).toBe(
      "Use a Bangladeshi mobile number, e.g. 01712345678 or +8801712345678.",
    );
  });

  it("refuses a non-string", () => {
    expect(bdPhone.safeParse(1_712_345_678).success).toBe(false);
    expect(bdPhone.safeParse(null).success).toBe(false);
  });

  it("collapses every spelling of the same subscriber to one stored value", () => {
    // The trunk prefix, the country code and the separators are all decoration.
    // If they survived into the row, the same guest would be stored twice
    // depending on how the number was typed and the customer search would find
    // only one of the two.
    const spellings = ["01712345678", "1712345678", "8801712345678", "+880 17-1234 5678", "(01712) 345 678"];
    const normalised = spellings.map((value) => bdPhone.parse(value));
    expect(new Set(normalised).size).toBe(1);
    expect(normalised[0]).toBe("01712345678");
  });

  it("refuses a number that is not a mobile range instead of normalising it", () => {
    expect(bdPhone.safeParse("0255001234").success).toBe(false);
    expect(bdPhone.safeParse("017abcdefgh").success).toBe(false);
  });
});

describe("phoneSearchDigits", () => {
  const cases: { name: string; raw: string; digits: string }[] = [
    { name: "trunk form", raw: "01712345678", digits: "01712345678" },
    { name: "bare subscriber", raw: "1712345678", digits: "1712345678" },
    { name: "country code with plus", raw: "+8801712345678", digits: "1712345678" },
    { name: "country code with separators", raw: "+880 17-1234 5678", digits: "1712345678" },
    { name: "a paste that is mostly country code", raw: "+880", digits: "880" },
    { name: "punctuation only", raw: "---", digits: "" },
    { name: "an ordinary partial", raw: "3456", digits: "3456" },
  ];

  it.each(cases)("$name → $digits", ({ raw, digits }) => {
    expect(phoneSearchDigits(raw)).toBe(digits);
  });

  it("finds the stored trunk form from every spelling a search box receives", () => {
    // The column is written by bdPhone, so the query has to arrive in the same
    // alphabet or a pasted international number matches nothing.
    const stored = bdPhone.parse("+880 17-1234 5678");
    for (const query of ["01712345678", "1712345678", "8801712345678", "+880 17-1234 5678"]) {
      expect(stored).toContain(phoneSearchDigits(query));
    }
  });
});

describe("timeOfDaySchema", () => {
  const accepted: string[] = ["00:00", "00:01", "09:05", "10:30", "12:00", "23:59"];

  it.each(accepted)("accepts %s", (value) => {
    expect(timeOfDaySchema.safeParse(value).success).toBe(true);
  });

  const refused: { name: string; value: string }[] = [
    { name: "the 24th hour", value: "24:00" },
    { name: "unpadded hour and minute", value: "9:5" },
    { name: "unpadded minute", value: "9:05" },
    { name: "unpadded hour", value: "09:5" },
    { name: "minute 60", value: "12:60" },
    { name: "hour 25", value: "25:00" },
    { name: "a three digit hour", value: "108:00" },
    { name: "seconds", value: "12:00:00" },
    { name: "no minutes", value: "12" },
    { name: "empty string", value: "" },
    { name: "a space instead of a colon", value: "12 00" },
    { name: "a range", value: "12:00-14:00" },
    { name: "letters", value: "noon" },
  ];

  it.each(refused)("refuses $name", ({ value }) => {
    const result = timeOfDaySchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(failureMessage(result, false)).toBe("Choose a valid time.");
  });
});
