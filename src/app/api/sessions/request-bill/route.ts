import { route, ok, parseBody, clientIp, assertSameOrigin } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { z } from "zod";
import { publicTokenSchema } from "@/server/validation/common";
import { requestBillForSession } from "@/server/services/billing.service";

const bodySchema = z.object({ participantToken: publicTokenSchema });

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, bodySchema);
  rateLimit("bill-request", clientIp(request), 5, 120);
  const result = await requestBillForSession(input.participantToken);
  return ok({
    ...result,
    message: result.duplicate
      ? "Staff already have your request for this table. Please wait a moment before asking again."
      : "Your request was sent to the floor staff. They will bring the bill shortly.",
  });
});
