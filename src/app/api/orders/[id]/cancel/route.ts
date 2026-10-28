import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser, actorOf } from "@/server/http/guards";
import { orderCancelSchema } from "@/server/validation/order";
import { cancelOrder } from "@/server/services/order.service";

/** Cancellation keeps the row and its history; it is never a delete. */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "order:cancel");
  const input = await parseBody(request, orderCancelSchema);
  const order = await cancelOrder(id, input.reason, actorOf(user, clientIp(request)));
  return ok({ orderNumber: order.orderNumber, status: order.status, message: `Order ${order.orderNumber} was cancelled and recorded.` });
});
