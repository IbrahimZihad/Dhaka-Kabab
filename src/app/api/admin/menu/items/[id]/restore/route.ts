import { route, ok, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { restoreMenuItem } from "@/server/services/menu.service";
import { revalidateMenu } from "@/lib/revalidate";

export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "menu:manage");
  const item = await restoreMenuItem(id, user.id, clientIp(request));
  revalidateMenu();
  return ok(item);
});
