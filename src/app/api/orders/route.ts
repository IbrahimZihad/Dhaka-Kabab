import { route, ok, created, parseBody, parseQuery, clientIp, assertSameOrigin, paginate } from "@/lib/api";
import { rateLimit, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { getCurrentUserFromRequest, type AuthenticatedUser } from "@/lib/auth/session";
import { assertPermission, canViewKitchenFinancials } from "@/lib/auth/rbac";
import { orderCreateSchema, orderListQuerySchema } from "@/server/validation/order";
import { createOrder, getOrderByPublicToken, getOrderCounters, listOrders } from "@/server/services/order.service";
import { getSettings } from "@/server/services/settings.service";
import { dayRange, todayKey } from "@/lib/time";
import { guestOrder } from "@/server/http/guest-view";
import { staffOrder } from "@/server/http/order-view";

/**
 * Order creation is reachable by guests — that is the whole point of QR ordering
 * — so the caller is resolved rather than required: staff placing an order for a
 * table need a permission, an anonymous guest needs only a valid table token.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = await parseBody(request, orderCreateSchema);
  const ip = clientIp(request);
  const user = await getCurrentUserFromRequest(request);

  if (user) {
    assertPermission(user, "order:create:for-customer");
  } else {
    rateLimit("order-create", ip, RATE_LIMITS.order.limit, RATE_LIMITS.order.windowSeconds);
  }

  const result = await createOrder(input, {
    actor: user ? { userId: user.id, role: user.role } : null,
    customerId: user?.role === "CUSTOMER" ? user.id : null,
    ip,
  });

  // Always re-read through the token so a replayed submission returns the same
  // shape as the original, including its line items.
  const order = await getOrderByPublicToken(result.order.publicToken);
  const settings = await getSettings();
  return created(
    {
      order: guestOrder(order, settings.currencySymbol),
      replayed: result.replayed,
      message: result.replayed
        ? "This order was already placed. Nothing new was created."
        : `Order ${order.orderNumber} is in.`,
    },
    { orderToken: order.publicToken, idempotent: result.replayed },
  );
});

/** Order list for the admin panel and the kitchen display. */
export const GET = route(async (request: Request) => {
  const user: AuthenticatedUser | null = await getCurrentUserFromRequest(request);
  const kitchen = user ? !canViewKitchenFinancials(user.role) : false;
  assertPermission(user, kitchen ? "kitchen:view" : "order:view:any");

  const query = parseQuery(new URL(request.url).searchParams, orderListQuerySchema);
  const settings = await getSettings();
  const { page, pageSize, skip, take } = paginate({
    page: Number(new URL(request.url).searchParams.get("page") ?? 1),
    pageSize: Number(new URL(request.url).searchParams.get("pageSize") ?? 25),
  });

  const window = query.dateKey ? dayRange(query.dateKey, settings.timezone) : dayRange(todayKey(settings.timezone), settings.timezone);

  const [{ orders, total }, counters] = await Promise.all([
    listOrders(
      {
        status: query.status,
        type: query.type,
        tableId: query.tableId,
        sessionId: query.sessionId,
        search: query.search,
        from: window.start,
        to: window.end,
        kitchenView: kitchen || undefined,
      },
      { skip, take },
    ),
    getOrderCounters(),
  ]);

  return ok(
    {
      orders: orders.map((order) => staffOrder(order, settings.currencySymbol, { financials: !kitchen })),
      counters,
      kitchenView: kitchen,
      dateKey: query.dateKey ?? todayKey(settings.timezone),
    },
    { meta: { page, pageSize, total } },
  );
});
