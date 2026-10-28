import { describe, expect, it } from "vitest";
import {
  computeTotals,
  derivePaymentStatus,
  lineTotal,
  outstandingPoisa,
  type Totals,
  type TotalsInput,
} from "@/lib/billing-math";

/**
 * `src/lib/billing-math.ts` — integer poisa in, integer poisa out.
 *
 * The invariant under test is the one the till and the receipt both depend on:
 *   total = subtotal - discount + service + vat + delivery + roundingAdjustment
 * and every returned field is a whole number of poisa.
 */

function lines(...poisa: number[]): TotalsInput["lines"] {
  return poisa.map((lineTotalPoisa) => ({ lineTotalPoisa }));
}

/** Recomputes the total from its parts and fails loudly if any part is not an integer. */
function expectBillInvariant(result: Totals, input: TotalsInput): void {
  const fields: (keyof Totals)[] = [
    "subtotalPoisa",
    "discountPoisa",
    "serviceChargePoisa",
    "vatPoisa",
    "deliveryFeePoisa",
    "roundingAdjustmentPoisa",
    "totalPoisa",
  ];
  for (const field of fields) {
    expect(Number.isInteger(result[field]), `${field} = ${result[field]} is not whole poisa`).toBe(true);
  }
  // The subtotal is only ever the sum of the lines the caller supplied.
  expect(result.subtotalPoisa).toBe(
    input.lines.reduce((total, line) => total + line.lineTotalPoisa, 0),
  );
  const delivery = result.deliveryFeePoisa;
  const rebuilt =
    result.subtotalPoisa -
    result.discountPoisa +
    result.serviceChargePoisa +
    result.vatPoisa +
    delivery +
    result.roundingAdjustmentPoisa;
  expect(result.totalPoisa).toBe(rebuilt);
  // Charges never run on the gross amount.
  expect(result.discountPoisa).toBeGreaterThanOrEqual(0);
  expect(result.discountPoisa).toBeLessThanOrEqual(result.subtotalPoisa);
}

describe("computeTotals", () => {
  it("passes the subtotal straight through when nothing else applies", () => {
    const input: TotalsInput = { lines: lines(25000) };
    const result = computeTotals(input);
    expect(result).toEqual({
      subtotalPoisa: 25000,
      discountPoisa: 0,
      serviceChargePoisa: 0,
      vatPoisa: 0,
      deliveryFeePoisa: 0,
      roundingAdjustmentPoisa: 0,
      totalPoisa: 25000,
    });
    expectBillInvariant(result, input);
  });

  it("sums every line into the subtotal", () => {
    const input: TotalsInput = { lines: lines(12500, 45000, 300) };
    expect(computeTotals(input).subtotalPoisa).toBe(57800);
  });

  it("handles an empty basket", () => {
    const input: TotalsInput = { lines: [] };
    const result = computeTotals(input);
    expect(result.totalPoisa).toBe(0);
    expectBillInvariant(result, input);
  });

  describe("worked restaurant examples (BDT, poisa)", () => {
    const cases: {
      name: string;
      input: TotalsInput;
      expected: {
        subtotalPoisa: number;
        discountPoisa: number;
        serviceChargePoisa: number;
        vatPoisa: number;
        deliveryFeePoisa: number;
        roundingAdjustmentPoisa: number;
        totalPoisa: number;
      };
    }[] = [
      {
        name: "৳250 with 10% service and 5% VAT",
        input: { lines: lines(25000), serviceChargeBps: 1000, vatBps: 500 },
        expected: {
          subtotalPoisa: 25000,
          discountPoisa: 0,
          serviceChargePoisa: 2500,
          vatPoisa: 1250,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: 0,
          totalPoisa: 28750,
        },
      },
      {
        name: "VAT on top of the service charge as well",
        input: {
          lines: lines(25000),
          serviceChargeBps: 1000,
          vatBps: 500,
          vatOnServiceCharge: true,
        },
        expected: {
          subtotalPoisa: 25000,
          discountPoisa: 0,
          serviceChargePoisa: 2500,
          vatPoisa: 1375,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: 0,
          totalPoisa: 28875,
        },
      },
      {
        name: "charges run on the discounted net, never the gross",
        input: {
          lines: lines(25000),
          discountPoisa: 5000,
          serviceChargeBps: 1000,
          vatBps: 500,
        },
        expected: {
          subtotalPoisa: 25000,
          discountPoisa: 5000,
          serviceChargePoisa: 2000,
          vatPoisa: 1000,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: 0,
          totalPoisa: 23000,
        },
      },
      {
        name: "a 100% voucher zeroes the bill and every charge",
        input: { lines: lines(10000), discountPoisa: 25000, serviceChargeBps: 1000, vatBps: 500 },
        expected: {
          subtotalPoisa: 10000,
          discountPoisa: 10000,
          serviceChargePoisa: 0,
          vatPoisa: 0,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: 0,
          totalPoisa: 0,
        },
      },
      {
        name: "a negative voucher is read as no discount",
        input: { lines: lines(10000), discountPoisa: -500, serviceChargeBps: 1000 },
        expected: {
          subtotalPoisa: 10000,
          discountPoisa: 0,
          serviceChargePoisa: 1000,
          vatPoisa: 0,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: 0,
          totalPoisa: 11000,
        },
      },
      {
        name: "৳287.50 cash bill rounds up to the next taka",
        input: { lines: lines(25000), serviceChargeBps: 1000, vatBps: 500, roundingStepPoisa: 100 },
        expected: {
          subtotalPoisa: 25000,
          discountPoisa: 0,
          serviceChargePoisa: 2500,
          vatPoisa: 1250,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: 50,
          totalPoisa: 28800,
        },
      },
      {
        name: "odd change rounded to the nearest taka (up)",
        input: { lines: lines(1249), roundingStepPoisa: 100 },
        expected: {
          subtotalPoisa: 1249,
          discountPoisa: 0,
          serviceChargePoisa: 0,
          vatPoisa: 0,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: -49,
          totalPoisa: 1200,
        },
      },
      {
        name: "rounded to the nearest 5 taka, half goes up",
        input: { lines: lines(1250), roundingStepPoisa: 500 },
        expected: {
          subtotalPoisa: 1250,
          discountPoisa: 0,
          serviceChargePoisa: 0,
          vatPoisa: 0,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: 250,
          totalPoisa: 1500,
        },
      },
      {
        name: "rounding is applied last, to the whole bill",
        input: {
          lines: lines(3333),
          serviceChargeBps: 1500,
          vatBps: 550,
          roundingStepPoisa: 100,
        },
        expected: {
          subtotalPoisa: 3333,
          discountPoisa: 0,
          serviceChargePoisa: 500,
          vatPoisa: 183,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: -16,
          totalPoisa: 4000,
        },
      },
      {
        name: "delivery fee joins the total but not the VAT base",
        input: { lines: lines(20000), vatBps: 500, deliveryFeePoisa: 6000 },
        expected: {
          subtotalPoisa: 20000,
          discountPoisa: 0,
          serviceChargePoisa: 0,
          vatPoisa: 1000,
          deliveryFeePoisa: 6000,
          roundingAdjustmentPoisa: 0,
          totalPoisa: 27000,
        },
      },
      {
        name: "half-up on a derived charge",
        input: { lines: lines(25), serviceChargeBps: 5000 },
        expected: {
          subtotalPoisa: 25,
          discountPoisa: 0,
          serviceChargePoisa: 13,
          vatPoisa: 0,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: 0,
          totalPoisa: 38,
        },
      },
      {
        name: "one poisa at 5% is half of one poisa and rounds up",
        input: { lines: lines(1), vatBps: 5000 },
        expected: {
          subtotalPoisa: 1,
          discountPoisa: 0,
          serviceChargePoisa: 0,
          vatPoisa: 1,
          deliveryFeePoisa: 0,
          roundingAdjustmentPoisa: 0,
          totalPoisa: 2,
        },
      },
    ];

    it.each(cases)("$name", ({ input, expected }) => {
      const result = computeTotals(input);
      expect(result).toEqual(expected);
      expectBillInvariant(result, input);
    });

    it("refuses a negative subtotal instead of turning the bill into a discount", () => {
      // A refund-shaped line total used to make clamp(value, 0, negativeMax)
      // return the negative bound, so the receipt claimed a discount below zero.
      expect(() => computeTotals({ lines: lines(5000, -6000) })).toThrow(/Subtotal cannot be negative/);
      expect(() => lineTotal(-100, 1)).toThrow(/Unit price cannot be negative/);
    });
  });

  it("rejects a fractional discount before it can poison a total", () => {
    expect(() => computeTotals({ lines: lines(10000), discountPoisa: 100.5 })).toThrow(
      /integer number of poisa/,
    );
  });

  it("rejects a fractional line total", () => {
    expect(() => computeTotals({ lines: [{ lineTotalPoisa: 100.5 }] })).toThrow(/integers/);
  });

  it("a step of 1 leaves the odd change alone", () => {
    const input: TotalsInput = { lines: lines(1237), roundingStepPoisa: 1 };
    const result = computeTotals(input);
    expect(result.totalPoisa).toBe(1237);
    expect(result.roundingAdjustmentPoisa).toBe(0);
  });

  it("the task invariant holds without a delivery fee", () => {
    const input: TotalsInput = {
      lines: lines(45000, 32000, 9500),
      discountPoisa: 10000,
      serviceChargeBps: 1000,
      vatBps: 500,
      roundingStepPoisa: 100,
    };
    const result = computeTotals(input);
    expect(result.totalPoisa).toBe(
      result.subtotalPoisa -
        result.discountPoisa +
        result.serviceChargePoisa +
        result.vatPoisa +
        result.roundingAdjustmentPoisa,
    );
    expect(result.totalPoisa).toBe(88_000);
    expect(result.roundingAdjustmentPoisa).toBe(25);
  });

  it("no float leaks out of any combination", () => {
    const stepValues = [1, 100, 500];
    const bpsValues = [0, 1, 500, 777, 1000, 1500, 5500];
    for (const line of [1, 33, 999, 12500, 250003]) {
      for (const service of bpsValues) {
        for (const vat of bpsValues) {
          for (const step of stepValues) {
            const result = computeTotals({
              lines: lines(line),
              discountPoisa: Math.floor(line / 3),
              serviceChargeBps: service,
              vatBps: vat,
              vatOnServiceCharge: step === 500,
              roundingStepPoisa: step,
            });
            expectBillInvariant(result, {
              lines: lines(line),
              serviceChargeBps: service,
              vatBps: vat,
              roundingStepPoisa: step,
            });
          }
        }
      }
    }
  });
});

describe("lineTotal", () => {
  it.each([
    { unit: 25000, quantity: 1, expected: 25000 },
    { unit: 25000, quantity: 3, expected: 75000 },
    { unit: 1, quantity: 999, expected: 999 },
    { unit: 0, quantity: 5, expected: 0 },
  ])("$unit x $quantity = $expected", ({ unit, quantity, expected }) => {
    expect(lineTotal(unit, quantity)).toBe(expected);
  });

  it.each([
    { name: "no quantity", quantity: 0 },
    { name: "above the 999 cap", quantity: 1000 },
    { name: "fractional quantity", quantity: 1.5 },
    { name: "negative quantity", quantity: -1 },
    { name: "NaN quantity", quantity: Number.NaN },
  ])("refuses $name", ({ quantity }) => {
    expect(() => lineTotal(25000, quantity)).toThrow(/Quantity/);
  });

  it("refuses a unit price that is not whole poisa", () => {
    expect(() => lineTotal(250.5, 2)).toThrow(/whole poisa/);
  });
});

describe("outstandingPoisa", () => {
  it.each([
    { name: "nothing paid", total: 10000, paid: 0, refunded: 0, expected: 10000 },
    { name: "part paid", total: 10000, paid: 4000, refunded: 0, expected: 6000 },
    { name: "settled", total: 10000, paid: 10000, refunded: 0, expected: 0 },
    { name: "overpaid stays at zero", total: 10000, paid: 12000, refunded: 0, expected: 0 },
    { name: "a refund reopens the balance", total: 10000, paid: 10000, refunded: 2500, expected: 2500 },
    { name: "default refund", total: 10000, paid: 3000, refunded: undefined, expected: 7000 },
  ])("$name", ({ total, paid, refunded, expected }) => {
    expect(outstandingPoisa(total, paid, refunded)).toBe(expected);
  });

  it("never returns a negative balance", () => {
    expect(outstandingPoisa(1000, 5000, 0)).toBe(0);
    expect(outstandingPoisa(0, 0, 0)).toBe(0);
  });
});

describe("derivePaymentStatus", () => {
  it.each([
    { name: "nothing owed or paid", total: 10000, paid: 0, refunded: 0, expected: "UNPAID" },
    { name: "part paid", total: 10000, paid: 4000, refunded: 0, expected: "PARTIAL" },
    { name: "settled", total: 10000, paid: 10000, refunded: 0, expected: "PAID" },
    { name: "overpaid", total: 10000, paid: 12000, refunded: 0, expected: "PAID" },
    { name: "fully refunded", total: 10000, paid: 10000, refunded: 10000, expected: "REFUNDED" },
    { name: "refund larger than the payment", total: 10000, paid: 5000, refunded: 5000, expected: "REFUNDED" },
    { name: "partial refund leaves the original status", total: 10000, paid: 10000, refunded: 2000, expected: "PAID" },
    { name: "a refund against an unpaid bill still reads REFUNDED", total: 10000, paid: 0, refunded: 100, expected: "REFUNDED" },
  ])("$name", ({ total, paid, refunded, expected }) => {
    expect(derivePaymentStatus({ totalPoisa: total, paidPoisa: paid, refundedPoisa: refunded })).toBe(expected);
  });

  it("defaults the refund amount to zero", () => {
    expect(derivePaymentStatus({ totalPoisa: 5000, paidPoisa: 5000 })).toBe("PAID");
  });

  it("calls a zero-value bill PAID because nothing is owed", () => {
    // A 100%-discounted or complimentary bill has nothing to collect; leaving it
    // UNPAID would keep a settled table on the outstanding list.
    expect(derivePaymentStatus({ totalPoisa: 0, paidPoisa: 0 })).toBe("PAID");
    expect(derivePaymentStatus({ totalPoisa: 0, paidPoisa: 0, refundedPoisa: 0 })).toBe("PAID");
  });
});
