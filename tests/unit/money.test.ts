import { describe, expect, it } from "vitest";
import {
  POISA_PER_UNIT,
  applyBps,
  assertAmount,
  bdtToPoisa,
  bpsToPercentLabel,
  clampNonNegative,
  formatPoisa,
  parseMoneyInput,
  poisaToBdt,
  poisaToInputValue,
  roundPoisa,
  roundToStep,
  sumPoisa,
} from "@/lib/money";

/**
 * `src/lib/money.ts` — every stored or transmitted amount in this system is an
 * integer number of poisa (1 BDT = 100 poisa), so these tests are mostly about
 * two promises: no float survives a call, and rounding is half-up.
 */

describe("bdtToPoisa", () => {
  it.each([
    { name: "whole taka", input: 12, expected: 1200 },
    { name: "two decimals", input: 12.5, expected: 1250 },
    { name: "float trap 0.1", input: 0.1, expected: 10 },
    { name: "float trap 1.03", input: 1.03, expected: 103 },
    { name: "zero", input: 0, expected: 0 },
    { name: "negative", input: -7.25, expected: -725 },
    { name: "sub-poisa precision is dropped half-up", input: 9.995, expected: 999 },
  ])("number: $name -> $expected poisa", ({ input, expected }) => {
    expect(bdtToPoisa(input)).toBe(expected);
  });

  it.each([
    { name: "plain decimal string", input: "12.50", expected: 1250 },
    { name: "symbol and thousands separators", input: "৳1,250.00", expected: 125000 },
    { name: "surrounding spaces", input: "  99.5 ", expected: 9950 },
    { name: "leading minus", input: "-3", expected: -300 },
  ])("string: $name -> $expected poisa", ({ input, expected }) => {
    expect(bdtToPoisa(input)).toBe(expected);
  });

  const throwing: { name: string; input: number | string }[] = [
    { name: "two decimal points", input: "1.2.3" },
    { name: "lone minus", input: "-" },
    { name: "NaN", input: Number.NaN },
    { name: "Infinity", input: Number.POSITIVE_INFINITY },
  ];
  it.each(throwing)("rejects $name instead of producing a monetary amount", ({ input }) => {
    expect(() => bdtToPoisa(input)).toThrow(/monetary amount|Cannot convert/);
  });

  it("rejects a string that carries no digits rather than reading it as free", () => {
    // An empty or garbled price must never reach the till as ৳0; the lenient
    // entry point for form text is parseMoneyInput, which returns null.
    expect(() => bdtToPoisa("")).toThrow(/monetary amount|Cannot convert/);
    expect(() => bdtToPoisa("abc")).toThrow(/monetary amount|Cannot convert/);
    expect(() => bdtToPoisa("৳")).toThrow(/monetary amount|Cannot convert/);
    expect(parseMoneyInput("abc")).toBeNull();
  });

  it("multiplies before rounding so float noise never survives", () => {
    expect(bdtToPoisa(8.2)).toBe(820);
    expect(Number.isInteger(bdtToPoisa(8.2))).toBe(true);
    expect(bdtToPoisa(0.07 * 100)).toBe(700);
  });
});

describe("poisaToBdt", () => {
  it.each([
    { poisa: 0, bdt: 0 },
    { poisa: 5, bdt: 0.05 },
    { poisa: 1250, bdt: 12.5 },
    { poisa: -725, bdt: -7.25 },
    { poisa: 125000, bdt: 1250 },
  ])("$poisa poisa is $bdt taka", ({ poisa, bdt }) => {
    expect(poisaToBdt(poisa)).toBe(bdt);
  });

  it("is the exact inverse of bdtToPoisa for every poisa value", () => {
    for (const poisa of [0, 1, 7, 50, 99, 100, 12345, 1000000, 987654321]) {
      expect(bdtToPoisa(poisaToBdt(poisa))).toBe(poisa);
    }
  });

  it("POISA_PER_UNIT is the single source of the 100:1 ratio", () => {
    expect(POISA_PER_UNIT).toBe(100);
  });
});

describe("roundPoisa", () => {
  it.each([
    { name: "already an integer", input: 1250, expected: 1250 },
    { name: "rounds down below half", input: 1250.4, expected: 1250 },
    { name: "half-up at exactly .5", input: 1250.5, expected: 1251 },
    { name: "rounds up above half", input: 1250.6, expected: 1251 },
    { name: "negative half-up (towards +infinity)", input: -1250.5, expected: -1250 },
  ])("$name", ({ input, expected }) => {
    expect(roundPoisa(input)).toBe(expected);
  });

  it.each([
    { name: "NaN", input: Number.NaN },
    { name: "Infinity", input: Number.POSITIVE_INFINITY },
  ])("throws on a non-finite result from $name", ({ input }) => {
    expect(() => roundPoisa(input)).toThrow(/non-finite/);
  });
});

describe("applyBps", () => {
  it.each([
    { name: "5% of ৳1 (the canonical case)", amount: 100, bps: 500, expected: 5 },
    { name: "5% of ৳250", amount: 25000, bps: 500, expected: 1250 },
    { name: "15% service charge", amount: 100000, bps: 1500, expected: 15000 },
    { name: "1% of one poisa rounds to zero", amount: 1, bps: 100, expected: 0 },
    { name: "half-up: 50% of 25 poisa", amount: 25, bps: 5000, expected: 13 },
    { name: "half-up: 50% of 15 poisa", amount: 15, bps: 5000, expected: 8 },
    { name: "zero amount", amount: 0, bps: 1500, expected: 0 },
    { name: "zero bps", amount: 123456, bps: 0, expected: 0 },
    { name: "bill-sized amount stays exact", amount: 1_234_567, bps: 1500, expected: 185_185 },
    { name: "large but safe amount", amount: 1_000_000_000_000, bps: 500, expected: 50_000_000_000 },
    { name: "refund keeps the sign", amount: -25000, bps: 500, expected: -1250 },
  ])("$name", ({ amount, bps, expected }) => {
    expect(applyBps(amount, bps)).toBe(expected);
  });

  it.each([
    { name: "fractional amount", amount: 100.5, bps: 500 },
    { name: "fractional basis points", amount: 100, bps: 500.25 },
  ])("refuses $name before it can leak a float into a charge", ({ amount, bps }) => {
    expect(() => applyBps(amount, bps)).toThrow(/integers/);
  });

  it("never returns a non-integer", () => {
    for (const amount of [1, 3, 7, 999, 1001, 123456]) {
      for (const bps of [1, 33, 500, 777, 1500, 9999]) {
        expect(Number.isInteger(applyBps(amount, bps))).toBe(true);
      }
    }
  });
});

describe("roundToStep", () => {
  it.each([
    { name: "step of 1 disables rounding", poisa: 1257, step: 1, expected: 1257 },
    { name: "nearest taka, down", poisa: 1249, step: 100, expected: 1200 },
    { name: "nearest taka, up", poisa: 1251, step: 100, expected: 1300 },
    { name: "nearest taka, half goes up", poisa: 1250, step: 100, expected: 1300 },
    { name: "nearest 5 taka, down", poisa: 1249, step: 500, expected: 1000 },
    { name: "nearest 5 taka, half goes up", poisa: 1250, step: 500, expected: 1500 },
    { name: "exact multiple is untouched", poisa: 1500, step: 500, expected: 1500 },
    { name: "negative rounds away from zero", poisa: -1250, step: 100, expected: -1300 },
    { name: "sub-step amount collapses to zero", poisa: 49, step: 100, expected: 0 },
  ])("$name", ({ poisa, step, expected }) => {
    expect(roundToStep(poisa, step)).toBe(expected);
  });

  it.each([
    { name: "zero step", step: 0 },
    { name: "negative step", step: -100 },
    { name: "fractional step", step: 2.5 },
    { name: "NaN step", step: Number.NaN },
  ])("an unusable step ($name) leaves the amount untouched", ({ step }) => {
    expect(roundToStep(1257, step)).toBe(1257);
  });

  it("rejects a fractional amount", () => {
    expect(() => roundToStep(1257.5, 100)).toThrow(/integers/);
  });
});

describe("sumPoisa", () => {
  it.each([
    { name: "no lines", amounts: [] as number[], expected: 0 },
    { name: "one line", amounts: [1250], expected: 1250 },
    { name: "typical bill", amounts: [1250, 4500, 300], expected: 6050 },
    { name: "mixed signs", amounts: [1250, -300, 50], expected: 1000 },
    { name: "large totals stay exact", amounts: [9_007_199_254_740_000, 0], expected: 9_007_199_254_740_000 },
  ])("$name", ({ amounts, expected }) => {
    expect(sumPoisa(...amounts)).toBe(expected);
  });

  it("rejects the first non-integer it meets", () => {
    expect(() => sumPoisa(100, 200.5, 300)).toThrow(/integers/);
  });
});

describe("clampNonNegative", () => {
  it.each([
    { poisa: -1, expected: 0 },
    { poisa: 0, expected: 0 },
    { poisa: 1, expected: 1 },
    { poisa: -125_000, expected: 0 },
  ])("$poisa clamps to $expected", ({ poisa, expected }) => {
    expect(clampNonNegative(poisa)).toBe(expected);
  });
});

describe("assertAmount", () => {
  it.each([
    { name: "zero", poisa: 0 },
    { name: "one poisa", poisa: 1 },
    { name: "negative (refunds are amounts too)", poisa: -500 },
    { name: "largest safe integer", poisa: Number.MAX_SAFE_INTEGER },
  ])("accepts $name", ({ poisa }) => {
    expect(() => assertAmount(poisa)).not.toThrow();
  });

  it.each([
    { name: "fractional poisa", poisa: 100.5 },
    { name: "NaN", poisa: Number.NaN },
    { name: "Infinity", poisa: Number.POSITIVE_INFINITY },
    { name: "beyond safe integers", poisa: 2 ** 53 },
  ])("rejects $name", ({ poisa }) => {
    expect(() => assertAmount(poisa)).toThrow();
  });

  it("NOTE: assertAmount guards integrality, not sign — negative poisa is legal by design", () => {
    // Refunds, voids and rounding adjustments are legitimately negative, so a
    // floor has to be requested explicitly with clampNonNegative.
    expect(() => assertAmount(-1)).not.toThrow();
    expect(clampNonNegative(-1)).toBe(0);
  });
});

describe("parseMoneyInput", () => {
  it.each([
    { name: "empty string", raw: "", expected: null },
    { name: "null", raw: null, expected: null },
    { name: "undefined", raw: undefined, expected: null },
    { name: "lone minus", raw: "-", expected: null },
    { name: "lone dot", raw: ".", expected: null },
    { name: "letters", raw: "abc", expected: null },
    { name: "two decimal points", raw: "1.2.3", expected: null },
    { name: "decimal string", raw: "12.5", expected: 1250 },
    { name: "grouped string", raw: "1,250.00", expected: 125000 },
    { name: "symbol prefixed", raw: "৳ 99.50", expected: 9950 },
    { name: "whole number input", raw: 7, expected: 700 },
    { name: "negative string", raw: "-12.5", expected: -1250 },
  ])("$name -> $expected", ({ raw, expected }) => {
    expect(parseMoneyInput(raw)).toBe(expected);
  });

  it("round-trips with poisaToInputValue", () => {
    for (const poisa of [0, 5, 99, 1250, 123456, -300]) {
      expect(parseMoneyInput(poisaToInputValue(poisa))).toBe(poisa);
    }
  });
});

describe("poisaToInputValue", () => {
  it.each([
    { poisa: 0, expected: "0.00" },
    { poisa: 5, expected: "0.05" },
    { poisa: 1250, expected: "12.50" },
    { poisa: 125000, expected: "1250.00" },
    { poisa: -1250, expected: "-12.50" },
  ])("$poisa poisa renders as $expected for a form field", ({ poisa, expected }) => {
    expect(poisaToInputValue(poisa)).toBe(expected);
  });
});

describe("formatPoisa", () => {
  it.each([
    { name: "one taka", poisa: 100, expected: "৳ 1" },
    { name: "poisa only", poisa: 5, expected: "৳ 0.05" },
    { name: "two decimals padded", poisa: 1257, expected: "৳ 12.57" },
    { name: "thousands grouping", poisa: 125000, expected: "৳ 1,250" },
    { name: "grouping with decimals", poisa: 123_456_789, expected: "৳ 1,234,567.89" },
    { name: "millions grouping", poisa: 1_000_000_000, expected: "৳ 10,000,000" },
    { name: "zero", poisa: 0, expected: "৳ 0" },
    { name: "negative", poisa: -123_456, expected: "-৳ 1,234.56" },
  ])("$name", ({ poisa, expected }) => {
    expect(formatPoisa(poisa)).toBe(expected);
  });

  it.each([
    { name: "no symbol", options: { withSymbol: false } as const, expected: "1,250" },
    { name: "custom symbol", options: { symbol: "$" } as const, expected: "$ 1,250" },
  ])("option $name", ({ options, expected }) => {
    expect(formatPoisa(125000, options)).toBe(expected);
  });

  it("omits the decimal part only when the poisa remainder is exactly zero", () => {
    expect(formatPoisa(125000)).toBe("৳ 1,250");
    expect(formatPoisa(125001)).toBe("৳ 1,250.01");
    expect(formatPoisa(124999)).toBe("৳ 1,249.99");
  });
});

describe("canonical invariants (exact literals)", () => {
  it("reads a two-decimal price and a float trap without drift", () => {
    expect(bdtToPoisa("19.99")).toBe(1999);
    // 0.1 * 100 would be 10.000000000000002 in float; rounding after multiply fixes it.
    expect(bdtToPoisa(0.1)).toBe(10);
    expect(Number.isInteger(bdtToPoisa(0.1))).toBe(true);
  });

  it("applies basis points half-up and short-circuits on a zero operand", () => {
    // 10% of 123456 = 12345.6 -> half-up 12346.
    expect(applyBps(123456, 1000)).toBe(12346);
    expect(applyBps(123456, 0)).toBe(0);
    expect(applyBps(0, 1000)).toBe(0);
  });

  it("rounds cash to the nearest taka half-up, no-ops at step 1, and ignores a bad step", () => {
    // 1234 / 100 = 12.34 -> 12 steps -> 1200; 1250 / 100 = 12.5 -> 13 steps -> 1300.
    expect(roundToStep(1234, 100)).toBe(1200);
    expect(roundToStep(1250, 100)).toBe(1300);
    expect(roundToStep(1234, 1)).toBe(1234);
    expect(roundToStep(1234, 0)).toBe(1234);
  });

  it("formats grouping, drops a zero remainder, and keeps the sign outside the symbol", () => {
    expect(formatPoisa(123456)).toBe("৳ 1,234.56");
    expect(formatPoisa(123400)).toBe("৳ 1,234");
    expect(formatPoisa(-123456)).toBe("-৳ 1,234.56");
  });

  it("parses a symbol-prefixed grouped input and returns null for the unusable ones", () => {
    expect(parseMoneyInput("৳ 1,250.00")).toBe(125000);
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput(null)).toBeNull();
    expect(parseMoneyInput("-")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
  });
});

describe("bpsToPercentLabel", () => {
  it.each([
    { bps: 0, expected: "0" },
    { bps: 1, expected: "0.01" },
    { bps: 500, expected: "5" },
    { bps: 275, expected: "2.75" },
    { bps: 1500, expected: "15" },
    { bps: 50, expected: "0.50" },
    { bps: 10_000, expected: "100" },
  ])("$bps bps is labelled $expected percent", ({ bps, expected }) => {
    expect(bpsToPercentLabel(bps)).toBe(expected);
  });

  it("NOTE: only a trailing .00 is trimmed, so whole percents lose decimals but halves keep them", () => {
    expect(bpsToPercentLabel(500)).toBe("5");
    expect(bpsToPercentLabel(50)).toBe("0.50");
  });
});
