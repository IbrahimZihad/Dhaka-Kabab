import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { setItemAvailability } from "@/server/services/menu.service";
import { menuItemStatusSchema } from "@/server/validation/menu";
import { revalidateMenu } from "@/lib/revalidate";

/** Sold out for the day. Existing carts re-price but reject the line at order. */
export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "menu:manage");
  const { available } = await parseBody(request, menuItemStatusSchema);
  const item = await setItemAvailability(id, available, user.id, clientIp(request));
  revalidateMenu();
  return ok(item);
});
