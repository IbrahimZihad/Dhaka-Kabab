import { route, ok, clientIp } from "@/lib/api";
import { actorOf, mutationUser } from "@/server/http/guards";
import { openBillForOrder } from "@/server/services/billing.service";

/**
 * One click from an order to the money. The permission is the bill's, not the
 * order's: this can raise a financial document, and a role that may read an order
 * is not necessarily one that may put it on the till.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "bill:manage");
  const { bill } = await openBillForOrder(id, actorOf(user, clientIp(request)));
  return ok({ billId: bill.id, number: bill.number, status: bill.status });
});
