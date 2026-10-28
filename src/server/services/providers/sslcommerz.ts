import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import { poisaToBdt } from "@/lib/money";
import {
  gatewayAmountToPoisa,
  type ExpectedPayment,
  type GatewayVerification,
  type InitPaymentInput,
  type InitPaymentResult,
  type PaymentProvider,
  type ProviderMode,
} from "@/server/services/providers/payment-provider";

/**
 * SSLCommerz hosted-checkout integration (v4 redirect + server-to-server IPN).
 *
 * Two rules drive the shape of this file:
 *   1. Credentials only ever travel from this server to the gateway. They are
 *      never placed in a form the browser submits and never persisted.
 *   2. A payment is successful when the gateway's validation endpoint says so.
 *      The customer's return URL, the browser's query string and the IPN body
 *      are all treated as claims that must be validated, not as proof.
 */

const REQUEST_TIMEOUT_MS = 12_000;

/** Fields we keep for the audit trail. Anything outside this list is dropped. */
const STORED_FIELDS = [
  "val_tran_id",
  "tran_id",
  "store_amount",
  "currency",
  "status",
  "risk_level",
  "card_type",
  "bank_status",
  "gateway",
  "err_code",
  "err_desc",
];

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

async function postForm(url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AppError("UNAVAILABLE", `Payment gateway replied ${response.status}. Try again or pay at the counter.`);
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new AppError("UNAVAILABLE", "Payment gateway returned an unreadable response. No payment was recorded.");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("UNAVAILABLE", "Payment gateway is unreachable right now. No payment was recorded.");
  } finally {
    clearTimeout(timer);
  }
}

export function createSslcommerzProvider(credentials: {
  storeId: string;
  apiKey: string;
  mode: ProviderMode;
  baseUrl: string;
}): PaymentProvider {
  const { storeId, apiKey, mode, baseUrl } = credentials;

  return {
    id: "sslcommerz",
    label: mode === "live" ? "SSLCommerz" : "SSLCommerz sandbox",
    mode,
    isDemo: mode === "sandbox",

    async init(input: InitPaymentInput): Promise<InitPaymentResult> {
      // Step 1 — open the session server-side and receive a hosted gateway URL.
      const session = await postForm(`${baseUrl}/gwprocess/v4/api.php`, {
        store_id: storeId,
        secret_key: apiKey,
        currency: input.currency,
        total_amount: poisaToBdt(input.amountPoisa).toFixed(2),
        tran_id: input.reference,
        success_url: input.returnUrl,
        fail_url: input.failUrl,
        cancel_url: input.cancelUrl,
        ipn_url: input.callbackUrl,
        shipping_name: input.customer.name,
        shipping_phone: input.customer.phone,
        shipping_email: input.customer.email,
        shipping_country: "BD",
        productname: input.description.slice(0, 200),
        productcategory: "Food",
        productprofile: "0",
        num_of_item: "1",
      });

      const gatewayUrl = typeof session.GatewayURL === "string" ? session.GatewayURL : null;
      const sessionStatus = typeof session.status === "string" ? session.status : "FAILED";
      if (sessionStatus.toUpperCase() !== "SUCCESS" || !gatewayUrl) {
        throw new AppError(
          "UNAVAILABLE",
          "The payment gateway could not start this transaction. Please try again or pay at the counter.",
        );
      }
      if (new URL(gatewayUrl).protocol !== "https:") {
        throw new AppError("UNAVAILABLE", "The payment gateway returned an insecure redirect. No payment was recorded.");
      }

      return {
        kind: "redirect",
        actionUrl: gatewayUrl,
        httpMethod: "POST",
        // Only the transaction id travels through the browser.
        form: { SessionInfo: session.SessionInfo ? String(session.SessionInfo) : "", sessid: input.reference },
        notice:
          mode === "sandbox"
            ? "Sandbox payment: no real money moves. Use a test card from your SSLCommerz dashboard."
            : "You will be taken to SSLCommerz to complete this payment.",
        mode,
        isDemo: mode === "sandbox",
        completionProof: md5(`${input.reference}:${apiKey}`).slice(0, 32),
      };
    },

    async readNotification(request: Request): Promise<Record<string, string>> {
      const collected: Record<string, string> = {};
      if (request.method === "POST") {
        const body = await request.formData().catch(() => {
          throw new AppError("VALIDATION", "The gateway notification was not form-encoded.");
        });
        for (const [key, value] of body.entries()) {
          if (typeof value === "string") collected[key] = value;
        }
      }
      const url = new URL(request.url);
      for (const [key, value] of url.searchParams.entries()) collected[key] = value;
      return collected;
    },

    async verify(notification: Record<string, string>, expected: ExpectedPayment): Promise<GatewayVerification> {
      const raw = Object.fromEntries(STORED_FIELDS.filter((key) => notification[key]).map((key) => [key, notification[key]]));
      const valTranId = notification.val_tran_id ?? notification.tran_id ?? null;
      const claimedStatus = (notification.status ?? "").toUpperCase();

      // The notification must describe the transaction we started, at the amount we asked for.
      if (notification.tran_id && notification.tran_id !== expected.reference) {
        throw new AppError("PAYMENT_UNVERIFIED", "Gateway notification references a different transaction.");
      }
      const claimedAmount = notification.store_amount ? gatewayAmountToPoisa(notification.store_amount) : null;
      if (claimedAmount === null || claimedAmount !== expected.amountPoisa) {
        throw new AppError("PAYMENT_UNVERIFIED", "Gateway notification amount does not match the invoice.");
      }
      const claimedCurrency = (notification.currency ?? expected.currency).toUpperCase();
      if (claimedCurrency !== expected.currency.toUpperCase()) {
        throw new AppError("PAYMENT_UNVERIFIED", "Gateway notification currency does not match the invoice.");
      }
      if (!valTranId) {
        throw new AppError("PAYMENT_UNVERIFIED", "Gateway notification carries no transaction id.");
      }

      // Local signature check first: cheap and rejects forged notifications outright.
      const expectedSign = md5(
        `${storeId}${valTranId}${notification.store_amount}${notification.currency}${apiKey}`,
      );
      const signaturePresent = Boolean(notification.verify_sign);
      if (signaturePresent && notification.verify_sign !== expectedSign) {
        throw new AppError("PAYMENT_UNVERIFIED", "Gateway notification signature did not match.");
      }

      // Authoritative check: ask the gateway whether it recognises this payment.
      let validated = false;
      let gatewayStatus: GatewayVerification["status"] = "PENDING";
      try {
        const result = await postForm(`${baseUrl}/validate/validate-payment`, {
          store_id: storeId,
          verify_key: notification.verify_key ?? "",
          val_id: valTranId,
          sig: notification.verify_sign ?? expectedSign,
        });
        validated = String(result.status ?? "").toUpperCase() === "VALID";
      } catch (error) {
        if (claimedStatus !== "SUCCESSFUL") {
          // A failure notification still needs recording, and validation cannot refute it.
          validated = false;
        } else {
          throw error;
        }
      }

      if (claimedStatus === "CANCELED" || claimedStatus === "CANCELLED") gatewayStatus = "CANCELLED";
      else if (claimedStatus === "FAILED" || claimedStatus === "FAILURE" || claimedStatus === "INVALID") gatewayStatus = "FAILED";
      else if (claimedStatus === "PROCESSING" || claimedStatus === "PENDING") gatewayStatus = "PENDING";
      else if (claimedStatus === "VALID" || claimedStatus === "COMPLETED" || claimedStatus === "LIMITED") gatewayStatus = "SUCCEEDED";
      else if (claimedStatus === "SUCCESSFUL" || claimedStatus === "SUCCESS") gatewayStatus = "SUCCEEDED";

      if (gatewayStatus === "SUCCEEDED" && !validated) {
        throw new AppError("PAYMENT_UNVERIFIED", "The gateway has not confirmed this payment yet.");
      }

      return {
        status: gatewayStatus,
        gatewayTxnId: valTranId,
        amountPoisa: expected.amountPoisa,
        currency: expected.currency,
        reason: notification.err_desc ?? (validated ? null : "gateway did not return VALID"),
        raw,
        isDemo: mode === "sandbox",
      };
    },
  };
}
