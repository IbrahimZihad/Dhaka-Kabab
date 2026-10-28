import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser, actorOf } from "@/server/http/guards";
import { reservationAssignTablesSchema } from "@/server/validation/reservation";
import { assignTables } from "@/server/services/reservation.service";

/** Manual table assignment. Overlaps and too few seats are refused by the service. */
export const PUT = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "reservation:manage");
  const input = await parseBody(request, reservationAssignTablesSchema);
  return ok(await assignTables(id, input.tableIds, actorOf(user, clientIp(request))));
});
