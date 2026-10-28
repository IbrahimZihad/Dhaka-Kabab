import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { setItemFeatured } from "@/server/services/menu.service";
import { menuItemFeaturedSchema } from "@/server/validation/menu";
import { revalidateMenu } from "@/lib/revalidate";

export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "menu:manage");
  const { featured } = await parseBody(request, menuItemFeaturedSchema);
  const item = await setItemFeatured(id, featured, user.id, clientIp(request));
  revalidateMenu();
  return ok(item);
});
