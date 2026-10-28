import { route, ok } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { getBillById } from "@/server/services/billing.service";

export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireApiPermission(request, "bill:view");
  return ok({ bill: await getBillById(id) });
});
