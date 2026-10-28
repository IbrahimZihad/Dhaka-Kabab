import { route, ok, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { rotateTableToken } from "@/server/services/table.service";

/**
 * Replacing a table's QR token. Printed stickers for that table stop working,
 * which is the point: a lost or shared code must be revocable.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "table:manage");
  return ok(await rotateTableToken(id, user.id, clientIp(request)));
});
