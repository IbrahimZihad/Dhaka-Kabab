import { route, ok } from "@/lib/api";
import { getOrderByPublicToken } from "@/server/services/order.service";
import { getSettings } from "@/server/services/settings.service";
import { guestOrder } from "@/server/http/guest-view";

/**
 * Public status lookup by the order's own unguessable token. This is the only
 * way a guest can see an order they did not sign in for, and it returns the
 * guest projection — never contact details, staff notes or payment records.
 */
export const GET = route(async (_request: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const [order, settings] = await Promise.all([getOrderByPublicToken(token), getSettings()]);
  return ok({ order: guestOrder(order, settings.currencySymbol, settings.timezone), currencySymbol: settings.currencySymbol });
});
