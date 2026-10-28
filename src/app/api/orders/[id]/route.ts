import { route, ok } from "@/lib/api";
import { requireApiPermission } from "@/server/http/guards";
import { canViewKitchenFinancials } from "@/lib/auth/rbac";
import { getOrderById } from "@/server/services/order.service";
import { getSettings } from "@/server/services/settings.service";
import { staffOrder } from "@/server/http/order-view";

export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await requireApiPermission(request, "order:view:any");
  const [order, settings] = await Promise.all([getOrderById(id), getSettings()]);
  return ok({
    order: staffOrder(order, settings.currencySymbol, { financials: canViewKitchenFinancials(user.role) }),
  });
});
