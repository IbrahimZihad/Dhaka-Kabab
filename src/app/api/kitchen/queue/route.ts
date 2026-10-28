import { route, ok } from "@/lib/api";
import { mutationUser } from "@/server/http/guards";
import { optionLabels } from "@/server/http/option-labels";
import { getKitchenQueue, getOrderCounters } from "@/server/services/order.service";

/**
 * Kitchen display polling. The projection comes from `getKitchenQueue`, which
 * never selects a price, a contact or a customer id, so a cook cannot read the
 * restaurant's margins off the screen while they plate.
 */
export const GET = route(async (request: Request) => {
  await mutationUser(request, "kitchen:view");
  const [queue, counters] = await Promise.all([getKitchenQueue(), getOrderCounters()]);
  return ok({
    counters,
    orders: queue.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      type: order.type,
      table: order.table?.label ?? null,
      sessionCode: order.session?.code ?? null,
      elapsedMinutes: order.elapsedMinutes,
      expectedMinutes: order.expectedMinutes,
      overdue: order.overdue,
      specialInstructions: order.specialInstructions,
      items: order.items.map((item) => ({
        id: item.id,
        name: item.nameSnapshot,
        quantity: item.quantity,
        instructions: item.instructions,
        options: optionLabels(item.optionsSnapshot),
      })),
    })),
  });
});
