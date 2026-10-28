import { z } from "zod";
import { route, ok, parseBody, clientIp, assertSameOrigin } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/auth/rate-limit";
import { publicTokenSchema, bdPhone } from "@/server/validation/common";
import { initiateGuestGatewayPayment, publicHandoff } from "@/server/services/payment.service";
import { providerReadiness } from "@/server/services/providers";

const bodySchema = z
  .object({
    participantToken: publicTokenSchema,
    /** Omitted means "the whole outstanding balance", which is the safe default. */
    amountPoisa: z.number().int().positive().optional(),
    customer: z.object({
      name: z.string().trim().min(2, "Enter your name.").max(80),
      email: z.string().trim().toLowerCase().email("Enter an email for the payment receipt."),
      phone: bdPhone,
    }),
  })
  .strict();

/**
 * Guest self-serve hand-off from a table. Authorised by possession of the
 * participant token issued when the table was joined, and only against a
 * finalized bill — an open bill can still grow, so charging it would let a
 * guest pay a total that was never really theirs.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, bodySchema);
  const ip = clientIp(request);
  rateLimit("guest-pay-ip", ip, 10, 600);
  rateLimit("guest-pay-table", input.participantToken, 5, 600);

  const readiness = await providerReadiness();
  if (!readiness.available) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      readiness.missing.length > 0
        ? `Online payment is not open yet. Still needed: ${readiness.missing.join(", ")}. Please pay at the counter.`
        : `Online payment is not open yet (${readiness.label}). Please pay at the counter.`,
    );
  }

  const result = await initiateGuestGatewayPayment({
    participantToken: input.participantToken,
    amountPoisa: input.amountPoisa,
    customer: input.customer,
    ip,
  });
  return ok(publicHandoff(result));
});
