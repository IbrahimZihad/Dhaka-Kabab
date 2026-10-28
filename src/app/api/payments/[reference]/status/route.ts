import { route, ok } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { getPaymentStatus } from "@/server/services/payment.service";

/**
 * Poll one payment by its reference. The reference is treated as a capability,
 * but the endpoint is still staff-gated: a guest's browser never learns whether
 * a gateway notification has landed, only what the counter tells them.
 */
export const GET = route(async (request: Request, ctx: { params: Promise<{ reference: string }> }) => {
  const { reference } = await ctx.params;
  await requireApiPermission(request, "payment:view");
  return ok(await getPaymentStatus(reference));
});
