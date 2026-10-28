import { route, ok, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { deleteCustomizationGroup } from "@/server/services/menu.service";
import { revalidateMenu } from "@/lib/revalidate";

/**
 * Options are safe to delete outright: order lines keep their own price and name
 * snapshot, so historical bills and receipts are unaffected.
 */
export const DELETE = route(async (request: Request, ctx: { params: Promise<{ groupId: string }> }) => {
  const { groupId } = await ctx.params;
  const user = await mutationUser(request, "menu:manage");
  const group = await deleteCustomizationGroup(groupId, user.id, clientIp(request));
  revalidateMenu();
  return ok(group);
});
