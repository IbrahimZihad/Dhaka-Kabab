import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { getSettings } from "@/server/services/settings.service";
import { createSimulatedProvider } from "@/server/services/providers/simulated";
import { createSslcommerzProvider } from "@/server/services/providers/sslcommerz";
import type { PaymentProvider } from "@/server/services/providers/payment-provider";

/**
 * Chooses the gateway from restaurant settings, then refuses any choice that
 * would either send real customers to an unconfigured provider or record
 * pretend money as production revenue.
 */

export type ProviderReadiness = {
  configured: string;
  available: boolean;
  realCredentials: boolean;
  label: string;
  mode: "sandbox" | "live" | null;
  missing: string[];
};

export function onlinePaymentsDisabled(): never {
  throw new AppError(
    "PROVIDER_NOT_CONFIGURED",
    "Online payment is not enabled. Please pay at the counter — staff can record your payment here.",
  );
}

export async function resolveProvider(): Promise<PaymentProvider> {
  const settings = await getSettings();
  const requested = settings.paymentProvider.trim().toLowerCase();
  const credentials = env.sslcommerz;

  if (requested === "sslcommerz") {
    if (!credentials) {
      throw new AppError(
        "PROVIDER_NOT_CONFIGURED",
        "SSLCommerz is selected in settings but SSLCOMMERZ_STORE_ID / SSLCOMMERZ_API_KEY are not set, so online payment is unavailable.",
      );
    }
    return createSslcommerzProvider(credentials);
  }

  if (requested === "simulated") {
    if (credentials && env.isProduction) {
      throw new AppError(
        "CONFLICT",
        "Real gateway credentials are present, so the simulated provider is disabled. Set the payment provider to SSLCommerz in settings.",
      );
    }
    return createSimulatedProvider();
  }

  onlinePaymentsDisabled();
}

export async function providerReadiness(): Promise<ProviderReadiness> {
  const settings = await getSettings();
  const requested = settings.paymentProvider.trim().toLowerCase();
  const credentials = env.sslcommerz;
  const missing: string[] = [];
  if (!credentials) {
    missing.push("SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_API_KEY");
  }
  if (!settings.emailPublic && requested === "sslcommerz") missing.push("SMTP_HOST (for payment receipts)");

  return {
    configured: requested,
    available: requested === "sslcommerz" ? Boolean(credentials) : requested === "simulated",
    realCredentials: Boolean(credentials),
    label:
      requested === "sslcommerz"
        ? credentials
          ? credentials.mode === "live"
            ? "SSLCommerz (live)"
            : "SSLCommerz (sandbox)"
          : "SSLCommerz — credentials missing"
        : requested === "simulated"
          ? "Simulated gateway (development)"
          : "Online payment disabled",
    mode: requested === "sslcommerz" ? (credentials?.mode ?? null) : requested === "simulated" ? "sandbox" : null,
    missing,
  };
}
