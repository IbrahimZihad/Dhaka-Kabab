import { route, ok, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { restoreCategory } from "@/server/services/menu.service";
import { revalidateMenu } from "@/lib/revalidate";

/** Undo an archive. The category and its slug go back on the menu. */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "category:manage");
  const category = await restoreCategory(id, user.id, clientIp(request));
  revalidateMenu();
  return ok(category);
});
