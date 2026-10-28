import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { tableStatusSchema } from "@/server/validation/table";
import { setTableStatus } from "@/server/services/table.service";

/**
 * Manual floor state. A table with a live session cannot be flipped to AVAILABLE
 * by dropping money — the service refuses until the session is settled or moved.
 */
export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "table:manage");
  const input = await parseBody(request, tableStatusSchema);
  return ok(await setTableStatus(id, input.status, user.id, { reason: input.reason, ip: clientIp(request) }));
});
