import { z } from "zod";
import { route, ok, created, parseBody, parseQuery, clientIp } from "@/lib/api";
import { mutationUser, requireApiPermission } from "@/server/http/guards";
import { createMenuItem, listMenuItems } from "@/server/services/menu.service";
import { menuItemInputSchema } from "@/server/validation/menu";
import { revalidateMenu } from "@/lib/revalidate";

const querySchema = z.object({
  category: z.string().trim().max(60).optional(),
  search: z.string().trim().max(80).optional(),
  includeArchived: z.enum(["1", "true"]).optional(),
  includeUnavailable: z.enum(["1", "true"]).optional(),
});

export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "menu:view:admin");
  const query = parseQuery(new URL(request.url).searchParams, querySchema);
  const items = await listMenuItems({
    categorySlug: query.category,
    search: query.search,
    includeArchived: query.includeArchived !== undefined,
    includeUnavailable: true,
  });
  return ok({ items });
});

export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "menu:manage");
  const input = await parseBody(request, menuItemInputSchema);
  const item = await createMenuItem(input, user.id, clientIp(request));
  revalidateMenu();
  return created(item);
});
