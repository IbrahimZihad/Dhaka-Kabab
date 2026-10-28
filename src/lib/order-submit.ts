"use client";

import { apiFetch, type ApiResponse } from "@/lib/client-api";

/** What the guest is told back about the order that was just made. */
export type PlacedOrder = {
  id: string;
  orderNumber: string;
  publicToken: string;
  type: string;
  status: string;
  paymentStatus: string;
  table: string | null;
  specialInstructions: string | null;
  createdAt: string;
  readyAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  items: { id: string; name: string; quantity: number; unitPrice: string; lineTotal: string; options: string[]; instructions: string | null }[];
  totals: {
    subtotal: string;
    discount: string;
    serviceCharge: string;
    vat: string;
    deliveryFee: string;
    total: string;
    poisa: { subtotalPoisa: number; discountPoisa: number; totalPoisa: number };
  };
  timeline: { status: string; at: string }[];
};

export type OrderResponse = { order: PlacedOrder; replayed: boolean; message: string };

/**
 * One door to order creation for every guest surface, so the QR page and the
 * checkout screen cannot drift into different ideas of what was sent.
 */
export function submitOrder(payload: unknown): Promise<ApiResponse<OrderResponse>> {
  return apiFetch<OrderResponse>("/api/orders", { method: "POST", body: payload });
}

export function orderStatusLabel(status: string): string {
  return (
    {
      PENDING: "Waiting for the kitchen",
      CONFIRMED: "Confirmed",
      PREPARING: "On the grill",
      READY: "Ready",
      SERVED: "Served",
      COMPLETED: "Finished",
      CANCELLED: "Cancelled",
    }[status] ?? status
  );
}
