import { route, created, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { upsertCustomizationGroup } from "@/server/services/menu.service";
import { customizationGroupSchema } from "@/server/validation/menu";
import { revalidateMenu } from "@/lib/revalidate";

/**
 * Add or replace one option group ("Choose your spice") on a menu item. Options
 * price deltas are stored in poisa; the order engine adds them at line level.
 */
export const POST = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "menu:manage");
  const input = await parseBody(request, customizationGroupSchema);
  const group = await upsertCustomizationGroup(id, input, user.id, clientIp(request));
  revalidateMenu();
  return created(group);
});
