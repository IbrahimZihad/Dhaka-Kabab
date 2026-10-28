import { z } from "zod";
import { pricePoisa } from "@/server/validation/menu";

/** Bills, counter payments, gateway hand-off and refunds. */

export const billCreateSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
    discountPoisa: pricePoisa.optional(),
  })
  .refine((value) => Boolean(value.sessionId) !== Boolean(value.orderId), {
    message: "Provide either a table session or a single order.",
  });

export const billUpdateSchema = z.object({
  discountPoisa: pricePoisa.optional(),
  note: z.string().trim().max(300).optional(),
});

export const billVoidSchema = z.object({
  reason: z.string().trim().min(5, "Explain why this bill is voided.").max(300),
});

export const paymentRecordSchema = z
  .object({
    billId: z.string().min(1).optional(),
    orderId: z.string().min(1).optional(),
    method: z.enum(["CASH", "CARD", "MOBILE_BANKING", "ONLINE_GATEWAY", "OTHER"]),
    amountPoisa: pricePoisa,
    reference: z.string().trim().max(80).optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((value) => Boolean(value.billId) !== Boolean(value.orderId), {
    message: "Record a payment against a bill or an order.",
  });

export const paymentInitSchema = z.object({
  billId: z.string().min(1),
  method: z.literal("ONLINE_GATEWAY"),
  /** Optional return hooks; the verified callback, not the redirect, settles the bill. */
  returnUrl: z.string().url().max(500).optional(),
});

export const refundSchema = z.object({
  paymentId: z.string().min(1),
  amountPoisa: pricePoisa,
  reason: z.string().trim().min(5, "Explain the refund.").max(300),
});

/**
 * SSLCommerz returns form-encoded server-to-server notifications. Amounts stay
 * strings here; the service compares them against the pending record instead of
 * trusting the gateway's arithmetic.
 */
export const gatewayCallbackSchema = z.object({
  val_tran_id: z.string().min(1).max(128),
  tran_id: z.string().min(1).max(128),
  store_amount: z.string().min(1).max(20),
  currency: z.string().min(1).max(8),
  status: z.string().min(1).max(40),
  verify_sign: z.string().min(1).max(128),
  verify_key: z.string().min(1).max(128),
  verify_payload: z.string().min(1).max(128),
  risk_level: z.string().max(40).optional(),
});

export type PaymentRecordInput = z.infer<typeof paymentRecordSchema>;
