import { route, ok, created, parseBody, clientIp } from "@/lib/api";
import { mutationUser, requireApiPermission } from "@/server/http/guards";
import { createCategory, listCategories } from "@/server/services/menu.service";
import { categoryInputSchema } from "@/server/validation/menu";
import { revalidateMenu } from "@/lib/revalidate";

/** Admin catalogue view: archived and inactive categories are included. */
export const GET = route(async (request: Request) => {
  await requireApiPermission(request, "menu:view:admin");
  return ok({ categories: await listCategories({ activeOnly: false }) });
});

export const POST = route(async (request: Request) => {
  const user = await mutationUser(request, "category:manage");
  const input = await parseBody(request, categoryInputSchema);
  const category = await createCategory(input, user.id, clientIp(request));
  revalidateMenu();
  return created(category);
});
