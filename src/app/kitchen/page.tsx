import { Suspense } from "react";
import type { OrderStatus, OrderType } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { roleHasPermission } from "@/lib/auth/rbac";
import { getKitchenQueue } from "@/server/services/order.service";
import { getSettings } from "@/server/services/settings.service";
import { optionLabels } from "@/server/http/option-labels";
import { minutesBetween, todayKey } from "@/lib/time";
import { ORDER_TYPE_LABELS } from "@/lib/staff-format";
import { Panel, EmptyState } from "@/components/admin/admin-ui";
import KitchenQueue from "@/components/admin/kitchen-queue";
import { OVERDUE_AFTER_MINUTES, type KitchenTicket } from "@/components/admin/kitchen-ticket";

/**
 * Kitchen board. The initial tickets are built here, server-side, from a
 * projection that picks one field at a time — no total, no price, no contact
 * name, phone or address can slip through because they are never selected.
 * After the first paint the client component refreshes from the same safe
 * queue endpoint every 15 seconds.
 */

async function KitchenBoard() {
  const user = await getCurrentUser();
  if (!user) return null;

  if (!roleHasPermission(user.role, "kitchen:view")) {
    return (
      <Panel title="Kitchen staff only" description="This board is for the roles that cook and pass the food.">
        <EmptyState title="Nothing to cook here">Your role sees the floor and the bills, not the kitchen tickets.</EmptyState>
      </Panel>
    );
  }

  const [queue, settings] = await Promise.all([getKitchenQueue(), getSettings()]);
  const now = new Date();
  const timezone = settings.timezone;
  const nowKey = todayKey(timezone, now);

  const tickets: KitchenTicket[] = queue.map((order) => {
    const elapsedMinutes = minutesBetween(order.createdAt, now);
    const type = order.type as OrderType;
    const destination = type === "DINE_IN" ? (order.table ? `Table ${order.table.label}` : "Table") : ORDER_TYPE_LABELS[type];
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status as OrderStatus,
      type,
      destination,
      elapsedMinutes,
      overdue: order.overdue || elapsedMinutes >= OVERDUE_AFTER_MINUTES,
      specialInstructions: order.specialInstructions,
      items: order.items.map((item) => ({
        id: item.id,
        name: item.nameSnapshot,
        quantity: item.quantity,
        options: optionLabels(item.optionsSnapshot),
        instructions: item.instructions,
      })),
    };
  });

  return (
    <KitchenQueue
      tickets={tickets}
      timezone={timezone}
      restaurantDate={nowKey}
      capabilities={{
        confirm: roleHasPermission(user.role, "order:status:floor"),
        cook: roleHasPermission(user.role, "order:status:kitchen"),
        serve: roleHasPermission(user.role, "order:status:floor"),
      }}
    />
  );
}

export default function KitchenPage() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-6 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <span key={index} className="skeleton block h-96" />
          ))}
        </div>
      }
    >
      <KitchenBoard />
    </Suspense>
  );
}
