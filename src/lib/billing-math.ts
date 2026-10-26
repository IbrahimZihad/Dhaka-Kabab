import { applyBps, roundToStep, sumPoisa, type Poisa } from "@/lib/money";

/**
 * Pure billing maths. No database, no Next.js — this is what the money unit
 * tests exercise, and every writer of an order/bill total calls it.
 */

export type TotalsInput = {
  /** Line totals are unit price x quantity, already validated server-side. */
  lines: { lineTotalPoisa: Poisa }[];
  discountPoisa?: Poisa;
  serviceChargeBps?: number;
  vatBps?: number;
  /** When true, VAT is charged on the discounted subtotal plus the service charge. */
  vatOnServiceCharge?: boolean;
  deliveryFeePoisa?: Poisa;
  /** Smallest coin the till can hand back; 1 disables cash rounding. */
  roundingStepPoisa?: number;
};

export type Totals = {
  subtotalPoisa: Poisa;
  discountPoisa: Poisa;
  serviceChargePoisa: Poisa;
  vatPoisa: Poisa;
  deliveryFeePoisa: Poisa;
  roundingAdjustmentPoisa: Poisa;
  totalPoisa: Poisa;
};

export function computeTotals(input: TotalsInput): Totals {
  const subtotal = sumPoisa(...input.lines.map((line) => line.lineTotalPoisa));
  const discount = clamp(input.discountPoisa ?? 0, 0, subtotal);

  // Charges are computed on the discounted net, never on the gross.
  const net = subtotal - discount;
  const serviceCharge = applyBps(net, input.serviceChargeBps ?? 0);
  const vatBase = input.vatOnServiceCharge ? net + serviceCharge : net;
  const vat = applyBps(Math.max(0, vatBase), input.vatBps ?? 0);
  const deliveryFee = Math.max(0, input.deliveryFeePoisa ?? 0);

  const beforeRounding = sumPoisa(net, serviceCharge, vat, deliveryFee);
  const rounded = roundToStep(beforeRounding, input.roundingStepPoisa ?? 1);

  return {
    subtotalPoisa: subtotal,
    discountPoisa: discount,
    serviceChargePoisa: serviceCharge,
    vatPoisa: vat,
    deliveryFeePoisa: deliveryFee,
    roundingAdjustmentPoisa: rounded - beforeRounding,
    totalPoisa: rounded,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) throw new Error(`Discount must be an integer number of poisa; got ${value}`);
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function lineTotal(unitPricePoisa: Poisa, quantity: number): Poisa {
  if (!Number.isInteger(unitPricePoisa)) throw new Error("Unit price must be in whole poisa.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new Error("Quantity must be a whole number between 1 and 999.");
  }
  return unitPricePoisa * quantity;
}

/** Balance still owed on a document. Never negative — overpayment is a separate concern. */
export function outstandingPoisa(totalPoisa: Poisa, paidPoisa: Poisa, refundedPoisa = 0): Poisa {
  const remaining = totalPoisa - paidPoisa + refundedPoisa;
  return remaining < 0 ? 0 : remaining;
}

export type PaymentStatusInput = { totalPoisa: Poisa; paidPoisa: Poisa; refundedPoisa?: number };

export function derivePaymentStatus({ totalPoisa, paidPoisa, refundedPoisa = 0 }: PaymentStatusInput):
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "REFUNDED" {
  if (refundedPoisa > 0 && refundedPoisa >= paidPoisa) return "REFUNDED";
  if (paidPoisa <= 0) return "UNPAID";
  if (paidPoisa + 0 >= totalPoisa) return "PAID";
  return "PARTIAL";
}
