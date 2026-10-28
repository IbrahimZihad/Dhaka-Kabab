import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { transferSession } from "@/server/services/table.service";
import { sessionTransferSchema } from "@/server/validation/table";

/** Moving a party between tables; open orders and the bill follow the guests. */
export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "table:session:manage");
  const input = await parseBody(request, sessionTransferSchema);
  return ok(await transferSession(input, { userId: user.id, ip: clientIp(request) }));
});
