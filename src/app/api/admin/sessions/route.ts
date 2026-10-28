import { route, created, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { openSession } from "@/server/services/table.service";
import { sessionOpenSchema } from "@/server/validation/table";

/**
 * Seats a party: the session is what later orders and the bill attach to. The
 * table list itself comes from /api/admin/tables, which carries the floor state.
 */
export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "table:session:manage");
  const input = await parseBody(request, sessionOpenSchema);
  return created(await openSession(input, { userId: user.id, ip: clientIp(request) }));
});
