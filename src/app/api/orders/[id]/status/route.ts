import { route, ok, parseBody, clientIp } from "@/lib/api";
import { mutationUser, actorOf } from "@/server/http/guards";
import { canViewKitchenFinancials, type Permission } from "@/lib/auth/rbac";
import { AppError } from "@/lib/errors";
import { orderStatusUpdateSchema } from "@/server/validation/order";
import { getOrderById, updateOrderStatus } from "@/server/services/order.service";
import { getSettings } from "@/server/services/settings.service";
import { staffOrder } from "@/server/http/order-view";
import type { OrderStatus } from "@prisma/client";

/**
 * Which steps belong to the kitchen and which to the floor. `CANCELLED` is
 * deliberately absent — cancellation is its own endpoint with its own reason
 * requirement, so a status poke cannot quietly erase an order's money.
 */
const PERMISSION_BY_STATUS: Record<string, Permission> = {
  CONFIRMED: "order:status:floor",
  PREPARING: "order:status:kitchen",
  READY: "order:status:kitchen",
  SERVED: "order:status:floor",
  COMPLETED: "order:status:floor",
};

export const PATCH = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const input = await parseBody(request, orderStatusUpdateSchema);
  const to = input.status as OrderStatus;
  const permission = PERMISSION_BY_STATUS[to];
  if (!permission) throw new AppError("INVALID_TRANSITION", `${to} is set by payment or cancellation, not by hand.`);

  const user = await mutationUser(request, permission);
  const moved = await updateOrderStatus(id, to, actorOf(user, clientIp(request)), input.note);

  // The status service returns the bare row; re-read it with its lines so the
  // kitchen display does not need a second round trip.
  const [order, settings] = await Promise.all([getOrderById(moved.id), getSettings()]);
  return ok(staffOrder(order, settings.currencySymbol, { financials: canViewKitchenFinancials(user.role) }));
});
