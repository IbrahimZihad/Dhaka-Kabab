import { z } from "zod";
import { route, ok, parseBody, clientIp } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { mutationUser } from "@/server/http/guards";
import { bdPhone } from "@/server/validation/common";
import { initiateGatewayPayment, publicHandoff } from "@/server/services/payment.service";
import { providerReadiness } from "@/server/services/providers";

const bodySchema = z.object({
  billId: z.string().min(1),
  method: z.literal("ONLINE_GATEWAY"),
  returnUrl: z.string().url().max(500).optional(),
  /**
   * Gateway forms insist on a name, a number and an address. They are collected
   * at the counter and never invented, so a bill with no payer details cannot be
   * pushed online.
   */
  customer: z.object({
    name: z.string().trim().min(2, "Enter the payer's name.").max(80),
    email: z.string().trim().toLowerCase().email("Enter the payer's email for the gateway receipt."),
    phone: bdPhone,
  }),
});

/**
 * Hand-off to the online gateway. This records a PENDING payment and returns the
 * form the browser must post; it does not, and cannot, mark anything paid. The
 * verified server-to-server callback is the only thing that moves money.
 */
export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "payment:record");
  const input = await parseBody(request, bodySchema);

  const readiness = await providerReadiness();
  if (!readiness.available) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      readiness.missing.length > 0
        ? `Online payment is unavailable. Still needed: ${readiness.missing.join(", ")}.`
        : `Online payment is unavailable (${readiness.label}).`,
    );
  }

  const result = await initiateGatewayPayment({
    billId: input.billId,
    customer: input.customer,
    returnUrl: input.returnUrl ?? `${env.appUrl}/admin/payments`,
    actor: { userId: user.id, ip: clientIp(request) },
  });
  return ok(publicHandoff(result));
});
