import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { archiveCategory, updateCategory } from "@/server/services/menu.service";
import { categoryInputSchema } from "@/server/validation/menu";
import { revalidateMenu } from "@/lib/revalidate";

export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "category:manage");
  const input = await parseBody(request, categoryInputSchema);
  const category = await updateCategory(id, input, user.id, clientIp(request));
  revalidateMenu();
  return ok(category);
});

/**
 * Archiving, never deleting: a category that has appeared on printed menus and
 * historical order lines must stay resolvable.
 */
export const DELETE = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await mutationUser(request, "category:manage");
  const category = await archiveCategory(id, user.id, clientIp(request));
  revalidateMenu();
  return ok(category);
});
