import { z } from "zod";
import { route, ok, parseBody, clientIp, assertSameOrigin } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { completeSimulatedPayment } from "@/server/services/payment.service";

const bodySchema = z
  .object({
    reference: z.string().trim().min(6).max(64),
    outcome: z.enum(["APPROVED", "DECLINED", "ABANDONED"]),
  })
  .strict();

/**
 * The "pay" button on the development gateway page. The browser names an
 * outcome; it is never trusted with the proof that authenticates one — that is
 * computed here and fed through the same verification path a real gateway
 * notification takes. Production refuses it outright.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, bodySchema);
  rateLimit("simulated-complete", clientIp(request), 20, 300);
  const result = await completeSimulatedPayment({ reference: input.reference, outcome: input.outcome });
  return ok({
    status: result.status,
    duplicate: result.duplicate,
    message:
      result.status === "SUCCEEDED"
        ? "Simulated payment recorded as succeeded. No real money moved."
        : result.status === "CANCELLED"
          ? "The guest abandoned the simulated payment. The bill is unchanged."
          : "The simulated payment was declined. The bill is unchanged.",
  });
});
