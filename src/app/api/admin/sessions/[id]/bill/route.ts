import { route, ok, clientIp } from "@/lib/api";
import { actorOf, mutationUser } from "@/server/http/guards";
import { openBillForSession } from "@/server/services/billing.service";

/**
 * Starts (or returns) the running bill for a table session and re-derives its
 * lines from the orders currently attached to that table.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "bill:manage");
  return ok(await openBillForSession(id, actorOf(user, clientIp(request))));
});
