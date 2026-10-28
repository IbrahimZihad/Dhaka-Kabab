import { z } from "zod";
import { route, ok, parseQuery } from "@/lib/api";
import { apiCustomer } from "@/server/http/guards";
import { myOrderHistory } from "@/server/services/customer.service";
import { getSettings } from "@/server/services/settings.service";
import { formatPoisa } from "@/lib/money";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

/**
 * Signed-in customer's own history. The user id comes from the session cookie
 * only, so this endpoint cannot be pointed at somebody else's orders.
 */
export const GET = route(async (request: Request) => {
  const user = await apiCustomer(request);
  const { limit } = parseQuery(new URL(request.url).searchParams, querySchema);
  const [orders, settings] = await Promise.all([myOrderHistory(user.id, limit), getSettings()]);
  return ok({
    orders: orders.map((order) => ({
      ...order,
      totalLabel: formatPoisa(order.totalPoisa, { symbol: settings.currencySymbol }),
      trackUrl: `/track/${order.publicToken}`,
    })),
    currencySymbol: settings.currencySymbol,
  });
});
