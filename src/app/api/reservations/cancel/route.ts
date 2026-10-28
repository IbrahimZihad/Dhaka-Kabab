import { z } from "zod";
import { route, ok, parseBody, clientIp, assertSameOrigin } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { publicTokenSchema } from "@/server/validation/common";
import { cancelReservation, getReservationByToken } from "@/server/services/reservation.service";

const bodySchema = z.object({
  token: publicTokenSchema,
  reason: z.string().trim().min(3, "Tell us briefly why.").max(200).default("Cancelled by the guest"),
});

/**
 * Guest-side cancellation. The booking's own token is the credential, and the
 * service re-checks it, so an id alone is not enough to cancel someone's table.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, bodySchema);
  rateLimit("reservation-cancel", clientIp(request), 10, 600);

  const reservation = await getReservationByToken(input.token);
  const cancelled = await cancelReservation(reservation.id, input.reason, {
    userId: null,
    guestToken: input.token,
    ip: clientIp(request),
  });
  return ok({ code: cancelled.code, status: cancelled.status, message: `Booking ${cancelled.code} is cancelled.` });
});
