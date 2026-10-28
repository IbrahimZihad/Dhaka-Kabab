import { formatPoisa } from "@/lib/money";
import { optionLabels } from "@/server/http/option-labels";

/**
 * Guest-facing projections. An order row carries staff-only columns
 * (`internalNote`, `staffUserId`, `customerId`, the idempotency key) and other
 * diners' details; a guest response is built from an explicit allow-list rather
 * than by deleting fields from a full record.
 */

type Priced = {
  subtotalPoisa: number;
  discountPoisa: number;
  serviceChargePoisa: number;
  vatPoisa: number;
  deliveryFeePoisa: number;
  totalPoisa: number;
};

export function guestTotals(order: Priced, symbol: string) {
  return {
    subtotal: formatPoisa(order.subtotalPoisa, { symbol }),
    discount: formatPoisa(order.discountPoisa, { symbol }),
    serviceCharge: formatPoisa(order.serviceChargePoisa, { symbol }),
    vat: formatPoisa(order.vatPoisa, { symbol }),
    deliveryFee: formatPoisa(order.deliveryFeePoisa, { symbol }),
    total: formatPoisa(order.totalPoisa, { symbol }),
    poisa: {
      subtotalPoisa: order.subtotalPoisa,
      discountPoisa: order.discountPoisa,
      totalPoisa: order.totalPoisa,
    },
  };
}

type GuestItem = {
  id: string;
  nameSnapshot: string;
  quantity: number;
  unitPricePoisa: number;
  lineTotalPoisa: number;
  optionsSnapshot: unknown;
  instructions: string | null;
};

function guestItem(item: GuestItem, symbol: string) {
  const options = optionLabels(item.optionsSnapshot);
  return {
    id: item.id,
    name: item.nameSnapshot,
    quantity: item.quantity,
    unitPrice: formatPoisa(item.unitPricePoisa, { symbol }),
    lineTotal: formatPoisa(item.lineTotalPoisa, { symbol }),
    options,
    instructions: item.instructions,
  };
}

export function guestOrder(
  order: Priced & {
    id: string;
    orderNumber: string;
    publicToken: string;
    type: string;
    status: string;
    paymentStatus: string;
    specialInstructions: string | null;
    createdAt: Date;
    readyAt: Date | null;
    cancelledAt: Date | null;
    cancelledReason: string | null;
    items: GuestItem[];
    statusEvents?: { toStatus: string; createdAt: Date }[];
    table?: { label: string } | null;
  },
  symbol: string,
) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    publicToken: order.publicToken,
    type: order.type,
    status: order.status,
    paymentStatus: order.paymentStatus,
    table: order.table?.label ?? null,
    specialInstructions: order.specialInstructions,
    createdAt: order.createdAt.toISOString(),
    readyAt: order.readyAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancelledReason: order.cancelledReason,
    items: order.items.map((item) => guestItem(item, symbol)),
    timeline: (order.statusEvents ?? []).map((event) => ({
      status: event.toStatus,
      at: event.createdAt.toISOString(),
    })),
    totals: guestTotals(order, symbol),
  };
}

export function guestBill(
  bill: { number: string; status: string; totalPoisa: number; paidPoisa: number; discountPoisa: number } | undefined,
  symbol: string,
) {
  if (!bill) return null;
  const outstanding = Math.max(0, bill.totalPoisa - bill.paidPoisa);
  return {
    number: bill.number,
    status: bill.status,
    total: formatPoisa(bill.totalPoisa, { symbol }),
    paid: formatPoisa(bill.paidPoisa, { symbol }),
    outstanding: formatPoisa(outstanding, { symbol }),
    outstandingPoisa: outstanding,
    /**
     * A guest may settle a finalized bill from their own phone; an open bill can
     * still grow, so charging it would take money against a total nobody agreed.
     */
    payableOnline: bill.status === "FINALIZED" && outstanding > 0,
  };
}
