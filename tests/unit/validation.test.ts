import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  bdPhone,
  dateKeySchema,
  paginationSchema,
  publicTokenSchema,
  timeOfDaySchema,
} from "@/server/validation/common";
import { pricePoisa } from "@/server/validation/menu";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";

/**
 * Pure validators. These are the guards every route leans on, so the interesting
 * assertions are the boundary values that separate accepted from rejected input —
 * never a happy path that merely "does not throw".
 */

describe("bdPhone", () => {
  it.each([
    "01712345678",
    "+8801712345678",
    "8801712345678",
    "01712-345 678",
  ])("accepts $input", (input) => {
    expect(bdPhone.safeParse(input).success).toBe(true);
  });

  it("normalises by stripping spaces, dashes and parentheses before matching", () => {
    // Only [\s()-] are removed; the leading '+' is retained by the regex itself.
    expect(bdPhone.parse("01712-345 678")).toBe("01712345678");
    expect(bdPhone.parse("(01712) 345-678")).toBe("01712345678");
  });

  it("folds the country code onto the local trunk form", () => {
    expect(bdPhone.parse("+8801712345678")).toBe("01712345678");
    expect(bdPhone.parse("8801712345678")).toBe("01712345678");
  });

  it.each([
    { input: "12345", why: "far too short" },
    { input: "0171234567", why: "nine mobile digits (one short of ten)" },
    { input: "02123456789", why: "a landline-style number starting 02" },
    { input: "02012345678", why: "second digit not 1" },
  ])("rejects $input — $why", ({ input }) => {
    expect(bdPhone.safeParse(input).success).toBe(false);
  });

  it("rejects a non-mobile leading digit after the country code", () => {
    // 880 + a number that does not start 1[3-9]: the subscriber part fails.
    expect(bdPhone.safeParse("8802123456789").success).toBe(false);
  });
});

describe("dateKeySchema", () => {
  it("accepts a real calendar day", () => {
    expect(dateKeySchema.safeParse("2026-10-28").success).toBe(true);
  });

  it("accepts a leap day that exists but rejects the same key in a non-leap year", () => {
    expect(dateKeySchema.safeParse("2028-02-29").success).toBe(true);
    expect(dateKeySchema.safeParse("2026-02-29").success).toBe(false);
  });

  it.each([
    { input: "2026-13-45", why: "shape is right but month 13 / day 45 do not exist" },
    { input: "2026-02-30", why: "February never reaches 30" },
    { input: "2026-2-28", why: "single-digit month breaks the zero-padded shape" },
    { input: "not-a-date", why: "not digits at all" },
  ])("rejects $input — $why", ({ input }) => {
    expect(dateKeySchema.safeParse(input).success).toBe(false);
  });
});

describe("timeOfDaySchema", () => {
  it.each(["00:00", "09:05", "23:59"])("accepts $input", (input) => {
    expect(timeOfDaySchema.safeParse(input).success).toBe(true);
  });

  it.each(["24:00", "9:5", "09:5", "12:60", "25:00", "1:05"])("rejects $input", (input) => {
    expect(timeOfDaySchema.safeParse(input).success).toBe(false);
  });
});

describe("publicTokenSchema", () => {
  it("accepts an 8-to-64 character alphanumeric token", () => {
    expect(publicTokenSchema.safeParse("AbCd1234").success).toBe(true);
  });

  it.each([
    { input: "abc123", why: "shorter than eight" },
    { input: "has-dash-inside", why: "punctuation is not URL-safe by this rule" },
    { input: "a".repeat(65), why: "longer than 64" },
  ])("rejects a token $why", ({ input }) => {
    expect(publicTokenSchema.safeParse(input).success).toBe(false);
  });
});

describe("paginationSchema", () => {
  it("applies the documented defaults", () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 25, dir: "desc" });
  });

  it("coerces string inputs to integers", () => {
    expect(paginationSchema.parse({ page: "3", pageSize: "50" })).toEqual({
      page: 3,
      pageSize: 50,
      dir: "desc",
    });
  });

  it("accepts the inclusive 200 ceiling", () => {
    expect(paginationSchema.parse({ pageSize: 200 }).pageSize).toBe(200);
  });

  it("rejects a page below one", () => {
    expect(paginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: -1 }).success).toBe(false);
  });

  it("rejects a pageSize below one and a non-enum sort", () => {
    expect(paginationSchema.safeParse({ pageSize: 0 }).success).toBe(false);
    expect(paginationSchema.safeParse({ sort: "passwordHash" }).success).toBe(false);
  });

  it("refuses an over-max pageSize instead of silently clamping it", () => {
    // A caller asking for 201 rows is buggy; quietly returning 200 would let the
    // bug ride and make the client's pagination maths wrong without a signal.
    expect(paginationSchema.safeParse({ pageSize: 201 }).success).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("rejects a password shorter than ten characters", () => {
    expect(passwordProblem("short")).toBe("Use at least 10 characters.");
  });

  it("requires a mix of upper and lower case", () => {
    expect(passwordProblem("abcdefghijkl")).toBe("Mix upper and lower case letters.");
  });

  it("requires a digit once the case rule is met", () => {
    expect(passwordProblem("Abcdefghijkl")).toBe("Include at least one digit.");
  });

  it("rejects a common word at the start even when the other rules pass", () => {
    // Passes length + mixed case + digit, so only the blocklist can reject it.
    expect(passwordProblem("Password123")).toBe("Do not start with a common word.");
  });

  it("accepts a strong password (returns null)", () => {
    expect(passwordProblem("Grilled2026Platter")).toBeNull();
  });
});

describe("hashPassword / verifyPassword", () => {
  it("produces a bcrypt digest that verifies the original and rejects a mismatch", async () => {
    const hash = await hashPassword("Grilled2026Platter");
    expect(hash).not.toBe("Grilled2026Platter");
    expect(hash.startsWith("$2")).toBe(true);
    await expect(verifyPassword("Grilled2026Platter", hash)).resolves.toBe(true);
    await expect(verifyPassword("Grilled2026Platerr", hash)).resolves.toBe(false);
  });

  it("salts each hash, so the same password hashes differently every time", async () => {
    expect(await hashPassword("Grilled2026Platter")).not.toBe(await hashPassword("Grilled2026Platter"));
  });
});

describe("pricePoisa (Taka text in, integer poisa out)", () => {
  it.each([
    { input: "19.99", expected: 1999 },
    { input: "12.50", expected: 1250 },
    { input: "0", expected: 0 },
    { input: 25000, expected: 2500000 },
  ])("converts $input to $expected poisa", ({ input, expected }) => {
    expect(pricePoisa.parse(input)).toBe(expected);
  });

  it("refuses an empty field", () => {
    expect(pricePoisa.safeParse("").success).toBe(false);
  });

  it("refuses a negative amount", () => {
    expect(pricePoisa.safeParse(-5).success).toBe(false);
  });

  it("refuses an unrealistically large amount (over the 100,000,000 poisa cap)", () => {
    // 200000000 taka = 20,000,000,000 poisa, past the sanity ceiling.
    expect(pricePoisa.safeParse("200000000").success).toBe(false);
  });

  it.each(["abc", "৳", "--", "  ", "N/A", "one"])(
    "refuses %s instead of selling the item for nothing",
    (input) => {
      // A string with no digits used to strip to "" and Number("") is 0, so a
      // typo in a price field silently created a ৳0 menu item.
      expect(pricePoisa.safeParse(input).success).toBe(false);
    },
  );

  it("keeps a currency-symbol prefix readable", () => {
    expect(pricePoisa.parse("৳1,250.00")).toBe(125000);
  });
});

describe("zod wiring smoke check", () => {
  it("bdPhone composes inside an object schema", () => {
    const schema = z.object({ phone: bdPhone });
    expect(schema.safeParse({ phone: "01712345678" }).success).toBe(true);
    expect(schema.safeParse({ phone: "0" }).success).toBe(false);
  });
});
