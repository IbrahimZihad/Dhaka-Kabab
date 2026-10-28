import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { tableInputSchema } from "@/server/validation/table";
import { updateTable } from "@/server/services/table.service";

export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "table:manage");
  const input = await parseBody(request, tableInputSchema);
  return ok(await updateTable(id, input, user.id, clientIp(request)));
});
