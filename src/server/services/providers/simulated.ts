import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import {
  gatewayAmountToPoisa,
  type ExpectedPayment,
  type GatewayVerification,
  type InitPaymentInput,
  type InitPaymentResult,
  type PaymentProvider,
} from "@/server/services/providers/payment-provider";

/**
 * Stand-in gateway for development, tests and demos. It produces no real money
 * movement and marks every record it touches `isDemo`, so a simulated payment
 * can never be mistaken for revenue.
 *
 * The proof below is deliberately derived from AUTH_SECRET: it stops anyone who
 * merely guesses a transaction reference from writing "paid" into the database.
 * It is not a payment guarantee, which is why the registry refuses to enable
 * this provider once real gateway credentials exist.
 */

const OUTCOMES = { APPROVED: "SUCCEEDED", DECLINED: "FAILED", ABANDONED: "CANCELLED" } as const;

/**
 * Server-side only. It is never returned by an API: a browser holding this could
 * post its own "approved" notification, which is the difference between a
 * development payment page and free food.
 */
export function simulatedProof(reference: string): string {
  return createHmac("sha256", env.authSecret).update(`simulated:${reference}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSimulatedProvider(): PaymentProvider {
  return {
    id: "simulated",
    label: "Simulated gateway (development)",
    mode: "sandbox",
    isDemo: true,

    async init(input: InitPaymentInput): Promise<InitPaymentResult> {
      const actionUrl = new URL("/pay/simulated", env.appUrl);
      actionUrl.searchParams.set("ref", input.reference);
      actionUrl.searchParams.set("amount", (input.amountPoisa / 100).toFixed(2));
      actionUrl.searchParams.set("desc", input.description.slice(0, 120));
      actionUrl.searchParams.set("next", input.returnUrl);
      return {
        kind: "simulated",
        actionUrl: actionUrl.toString(),
        httpMethod: "GET",
        notice: "SIMULATED PAYMENT — no card is charged and no money moves. Configure SSLCOMMERZ_STORE_ID and SSLCOMMERZ_API_KEY for real online payments.",
        mode: "sandbox",
        isDemo: true,
        completionProof: simulatedProof(input.reference),
      };
    },

    async readNotification(request: Request): Promise<Record<string, string>> {
      const url = new URL(request.url);
      const collected: Record<string, string> = {};
      for (const [key, value] of url.searchParams.entries()) collected[key] = value;
      if (request.method === "POST") {
        const body = await request.formData().catch(() => {
          throw new AppError("VALIDATION", "Simulated payment notification was not form-encoded.");
        });
        for (const [key, value] of body.entries()) if (typeof value === "string") collected[key] = value;
      }
      return collected;
    },

    async verify(notification: Record<string, string>, expected: ExpectedPayment): Promise<GatewayVerification> {
      const suppliedProof = notification.dk_proof ?? "";
      if (!safeEqual(suppliedProof, simulatedProof(expected.reference))) {
        throw new AppError("PAYMENT_UNVERIFIED", "This simulated payment could not be authenticated.");
      }
      if (notification.dk_ref && notification.dk_ref !== expected.reference) {
        throw new AppError("PAYMENT_UNVERIFIED", "Simulated payment references a different transaction.");
      }
      const claimedAmount = notification.dk_amount ? gatewayAmountToPoisa(notification.dk_amount) : null;
      if (claimedAmount !== expected.amountPoisa) {
        throw new AppError("PAYMENT_UNVERIFIED", "Simulated payment amount does not match the invoice.");
      }
      const outcome = (notification.dk_outcome ?? "").toUpperCase() as keyof typeof OUTCOMES;
      if (!OUTCOMES[outcome]) {
        throw new AppError("VALIDATION", "Unknown simulated payment outcome.");
      }
      return {
        status: OUTCOMES[outcome],
        gatewayTxnId: outcome === "APPROVED" ? `SIM-${expected.reference.slice(-12)}` : null,
        amountPoisa: expected.amountPoisa,
        currency: expected.currency,
        reason: outcome === "APPROVED" ? null : `simulated ${outcome.toLowerCase()}`,
        raw: {
          dk_ref: expected.reference,
          dk_outcome: outcome,
          dk_amount: notification.dk_amount ?? "",
          provider: "simulated",
        },
        isDemo: true,
      };
    },
  };
}
