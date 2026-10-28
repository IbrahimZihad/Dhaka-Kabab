import { AppError } from "@/lib/errors";

/**
 * A payment provider is a two-step contract: `init` produces a hand-off the
 * browser can follow, `verify` turns a gateway notification into a decision we
 * are allowed to act on. Nothing upstream may mark a payment successful from a
 * redirect alone — only the return value of `verify` can.
 */

export type ProviderMode = "sandbox" | "live";

export type InitPaymentInput = {
  /** Our own unique reference; becomes the gateway transaction id. */
  reference: string;
  amountPoisa: number;
  currency: string;
  description: string;
  customer: { name: string; email: string; phone: string };
  /** Page the customer returns to. Informational only; never trusted. */
  returnUrl: string;
  failUrl: string;
  cancelUrl: string;
  /** Server-to-server notification endpoint. */
  callbackUrl: string;
};

export type InitPaymentResult = {
  /**
   * `redirect` means post the customer to the gateway.
   * `simulated` means our own dev-mode page stands in for the gateway.
   */
  kind: "redirect" | "simulated";
  /** Where the browser goes next. */
  actionUrl: string;
  httpMethod: "POST" | "GET";
  /** Form fields to submit for a hosted redirect; never contains credentials. */
  form?: Record<string, string>;
  /** Shown verbatim on the checkout screen so nobody mistakes demo money for real money. */
  notice: string;
  mode: ProviderMode;
  isDemo: boolean;
  /**
   * Opaque value the completion step must echo back. For `simulated` hand-offs
   * it is the only thing standing between a stranger and a fake "paid" record;
   * for a real gateway it is correlation only — the gateway's own validation
   * decides the outcome.
   */
  completionProof: string;
};

export type GatewayVerification = {
  status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "PENDING";
  gatewayTxnId: string | null;
  amountPoisa: number;
  currency: string;
  reason: string | null;
  /** Whitelisted gateway fields, safe to persist. */
  raw: Record<string, string>;
  isDemo: boolean;
};

export type ExpectedPayment = {
  reference: string;
  amountPoisa: number;
  currency: string;
};

export interface PaymentProvider {
  readonly id: string;
  readonly label: string;
  readonly mode: ProviderMode;
  /** True whenever the money is not real: sandbox credentials or simulation. */
  readonly isDemo: boolean;
  init(input: InitPaymentInput): Promise<InitPaymentResult>;
  /** Read the notification body — form-encoded POST or query string. */
  readNotification(request: Request): Promise<Record<string, string>>;
  verify(notification: Record<string, string>, expected: ExpectedPayment): Promise<GatewayVerification>;
}

export function missingProvider(name: string): never {
  throw new AppError(
    "PROVIDER_NOT_CONFIGURED",
    `Online payment provider "${name}" is not configured. A staff member can still take payment at the counter.`,
  );
}

/** Amount the gateway reports, in Taka with up to two decimals, as integer poisa. */
export function gatewayAmountToPoisa(raw: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const units = Number(match[1]);
  const poisa = Number((match[2] ?? "").padEnd(2, "0"));
  return units * 100 + poisa;
}
