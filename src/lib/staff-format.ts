/**
 * Labels for the staff screens. Kept in one file so the floor, the kitchen and
 * the reports all call a bill the same thing, and so a status can never be
 * rendered with a label that contradicts what the database stores.
 */

import type {
  BillStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
  ReservationStatus,
  TableSessionStatus,
  TableStatus,
} from "@prisma/client";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Received",
  CONFIRMED: "Confirmed",
  PREPARING: "Cooking",
  READY: "Ready",
  SERVED: "Served",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** The steps a cook can move an order through, in the order they appear. */
export const ORDER_STATUS_FLOW: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED"];

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  DINE_IN: "Table",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  OPEN: "Open",
  FINALIZED: "Finalized",
  SETTLED: "Settled",
  VOIDED: "Voided",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: "Not paid",
  PARTIAL: "Part paid",
  PAID: "Paid",
  REFUNDED: "Refunded",
};

export const PAYMENT_RECORD_LABELS: Record<PaymentRecordStatus, string> = {
  PENDING: "Waiting on the bank",
  SUCCEEDED: "Received",
  FAILED: "Failed",
  CANCELLED: "Abandoned",
  REFUNDED: "Refunded",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  MOBILE_BANKING: "Mobile banking",
  ONLINE_GATEWAY: "Online",
  OTHER: "Other",
};

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  AVAILABLE: "Free",
  RESERVED: "Booked",
  OCCUPIED: "Occupied",
  CLEANING: "Needs clearing",
  DISABLED: "Out of service",
};

export const SESSION_STATUS_LABELS: Record<TableSessionStatus, string> = {
  ACTIVE: "Dining",
  CLOSED: "Closed",
};

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: "Awaiting confirmation",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Arrived",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "Did not arrive",
};

/**
 * Badge colour by meaning, not by enum: green means nothing needs doing, amber
 * means a member of staff has something to do, red means it went wrong. The
 * checks run in that order, so "Not paid" is amber and never reads as done.
 */
export function statusTone(label: string): "ok" | "wait" | "bad" | "neutral" {
  const text = label.toLowerCase();
  if (/cancel|void|fail|refund|no show|did not|abandon|out of service/.test(text)) return "bad";
  if (/unpaid|not paid|partial|awaiting|waiting|pending|open|cooking|preparing|cleaning|reserved|dining/.test(text)) return "wait";
  if (/paid|settled|completed|confirmed|received|ready|served|free|arrived|success/.test(text)) return "ok";
  return "neutral";
}
