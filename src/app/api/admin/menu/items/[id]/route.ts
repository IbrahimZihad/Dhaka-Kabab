import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser, requireApiPermission } from "@/server/http/guards";
import { archiveMenuItem, getMenuItemForAdmin, updateMenuItem } from "@/server/services/menu.service";
import { menuItemInputSchema } from "@/server/validation/menu";
import { revalidateMenu } from "@/lib/revalidate";

export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireApiPermission(request, "menu:view:admin");
  return ok({ item: await getMenuItemForAdmin(id) });
});

export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "menu:manage");
  const input = await parseBody(request, menuItemInputSchema);
  const item = await updateMenuItem(id, input, user.id, clientIp(request));
  revalidateMenu();
  return ok(item);
});

export const DELETE = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "menu:manage");
  const item = await archiveMenuItem(id, user.id, clientIp(request));
  revalidateMenu();
  return ok(item);
});
