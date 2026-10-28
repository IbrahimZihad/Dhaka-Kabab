import { route, ok, parseBody, clientIp } from "@/lib/api";
import { actorOf, mutationUser } from "@/server/http/guards";
import { closeSession } from "@/server/services/table.service";
import { sessionCloseSchema } from "@/server/validation/table";

/**
 * Clears a table. The service refuses to close while an unfinalised, unpaid bill
 * is open, so this endpoint can never be used to lose track of money owed.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "table:session:manage");
  const input = await parseBody(request, sessionCloseSchema);
  return ok(await closeSession(id, input, actorOf(user, clientIp(request))));
});
