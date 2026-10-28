import { route, created, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { refundSchema } from "@/server/validation/billing";
import { refundPayment } from "@/server/services/payment.service";

/**
 * Refunds reduce what the restaurant is holding, not what it earned. The service
 * records the refund against the original verified payment and refuses to
 * over-refund; a live gateway refund stays PENDING until that gateway confirms.
 */
export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "payment:refund");
  const input = await parseBody(request, refundSchema);
  const refund = await refundPayment({
    paymentId: input.paymentId,
    amountPoisa: input.amountPoisa,
    reason: input.reason,
    actor: { userId: user.id, role: user.role, ip: clientIp(request) },
  });
  return created(refund);
});
