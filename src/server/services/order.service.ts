import { prisma, type Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { randomToken } from "@/lib/ids";
import { computeTotals, derivePaymentStatus, lineTotal } from "@/lib/billing-math";
import { getSettings } from "@/server/services/settings.service";
import { nextDocumentNumber } from "@/server/services/counters";
import { resolveTableToken, joinSessionByTableToken } from "@/server/services/table.service";
import { refreshBillLines } from "@/server/services/billing.service";
import { queueNotification } from "@/server/services/notification.service";
import { phoneSearchDigits } from "@/server/validation/common";
import type { OrderCreateInput } from "@/server/validation/order";
import type { OrderStatus, PaymentStatus } from "@prisma/client";

/**
 * Orders. Every price, charge and total is derived here from database rows; the
 * browser only ever sends ids and quantities.
 */

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "SERVED", "CANCELLED"],
  PREPARING: ["READY", "SERVED", "CANCELLED"],
  READY: ["SERVED", "COMPLETED", "CANCELLED"],
  SERVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Which statuses each staff role may move an order into. Least privilege. */
const ROLE_TARGETS: Record<string, OrderStatus[]> = {
  OWNER: ["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"],
  MANAGER: ["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"],
  CASHIER: ["CONFIRMED", "SERVED", "COMPLETED", "CANCELLED"],
  KITCHEN: ["PREPARING", "READY"],
  CUSTOMER: [],
};

export function isTransitionAllowed(from: OrderStatus, to: OrderStatus, role: string): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  return (ROLE_TARGETS[role] ?? []).includes(to);
}

const STATUS_TIMESTAMPS: Partial<Record<OrderStatus, "confirmedAt" | "preparingAt" | "readyAt" | "servedAt" | "completedAt" | "cancelledAt">> = {
  CONFIRMED: "confirmedAt",
  PREPARING: "preparingAt",
  READY: "readyAt",
  SERVED: "servedAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};

type PricedLine = {
  menuItemId: string;
  nameSnapshot: string;
  unitPricePoisa: number;
  quantity: number;
  lineTotalPoisa: number;
  optionsSnapshot: { groupName: string; optionName: string; priceDeltaPoisa: number }[];
  instructions: string | null;
};

/**
 * Server-side re-pricing. Checks existence, availability, category activity,
 * required option groups, select limits and option availability; returns the
 * authoritative lines.
 */
export async function priceOrderLines(
  items: OrderCreateInput["items"],
  client: Db = prisma,
): Promise<PricedLine[]> {
  const ids = [...new Set(items.map((item) => item.menuItemId))];
  const menuItems = await client.menuItem.findMany({
    where: { id: { in: ids } },
    include: {
      category: { select: { isActive: true, archivedAt: true, name: true } },
      customizationGroups: {
        include: { options: { select: { id: true, name: true, priceDeltaPoisa: true, available: true } } },
      },
    },
  });
  const byId = new Map(menuItems.map((item) => [item.id, item]));
  const unavailable: string[] = [];
  const lines: PricedLine[] = [];

  for (const item of items) {
    const menu = byId.get(item.menuItemId);
    if (!menu) {
      unavailable.push(`Item ${item.menuItemId} is no longer on the menu.`);
      continue;
    }
    if (menu.archivedAt || !menu.available || !menu.category.isActive || menu.category.archivedAt) {
      unavailable.push(`${menu.name} is not available right now.`);
      continue;
    }

    const chosenOptions = item.options ?? [];
    const optionIds = new Set(chosenOptions.map((choice) => choice.optionId));
    const selectedByGroup = new Map<string, number>();
    for (const choice of chosenOptions) {
      selectedByGroup.set(choice.groupId, (selectedByGroup.get(choice.groupId) ?? 0) + 1);
    }

    const optionsSnapshot: PricedLine["optionsSnapshot"] = [];
    let optionDeltaPoisa = 0;

    for (const group of menu.customizationGroups) {
      const chosenCount = selectedByGroup.get(group.id) ?? 0;
      if (group.required && chosenCount < Math.max(1, group.minSelect)) {
        throw new AppError("VALIDATION", `Choose ${group.name} for ${menu.name}.`, {
          items: [`Choose ${group.name} for ${menu.name}.`],
        });
      }
      if (chosenCount > group.maxSelect) {
        throw new AppError("VALIDATION", `${menu.name}: choose up to ${group.maxSelect} ${group.name}.`, {
          items: [`${menu.name}: choose up to ${group.maxSelect} ${group.name}.`],
        });
      }
      const validOptionIds = new Set(group.options.filter((option) => option.available).map((option) => option.id));
      for (const choice of chosenOptions) {
        if (choice.groupId !== group.id) continue;
        const option = group.options.find((candidate) => candidate.id === choice.optionId);
        if (!option || !validOptionIds.has(option.id)) {
          throw new AppError("ITEM_UNAVAILABLE", `The option “${choice.optionId}” for ${menu.name} is no longer available.`);
        }
        if (!optionIds.has(option.id)) continue;
        optionsSnapshot.push({ groupName: group.name, optionName: option.name, priceDeltaPoisa: option.priceDeltaPoisa });
        optionDeltaPoisa += option.priceDeltaPoisa;
      }
    }

    // Unknown group ids are rejected rather than silently ignored.
    const knownGroups = new Set(menu.customizationGroups.map((group) => group.id));
    for (const choice of chosenOptions) {
      if (!knownGroups.has(choice.groupId)) {
        throw new AppError("VALIDATION", `${menu.name} does not have the option group “${choice.groupId}”.`);
      }
    }

    const unitPricePoisa = menu.pricePoisa + optionDeltaPoisa;
    lines.push({
      menuItemId: menu.id,
      nameSnapshot: menu.name,
      unitPricePoisa,
      quantity: item.quantity,
      lineTotalPoisa: lineTotal(unitPricePoisa, item.quantity),
      optionsSnapshot,
      instructions: item.instructions?.trim() ? item.instructions.trim() : null,
    });
  }

  if (unavailable.length > 0) {
    throw new AppError("ITEM_UNAVAILABLE", unavailable.join(" "), { items: unavailable });
  }
  return lines;
}

export type CreateOrderContext = {
  actor?: { userId: string; role: string } | null;
  customerId?: string | null;
  ip?: string;
};

export async function createOrder(input: OrderCreateInput, context: CreateOrderContext = {}) {
  const settings = await getSettings();

  if (input.type === "TAKEAWAY" && !settings.allowTakeaway) {
    throw new AppError("VALIDATION", "Takeaway orders are not enabled. Please order for dine-in.");
  }
  if (input.type === "DELIVERY" && !settings.allowDelivery) {
    throw new AppError("VALIDATION", "Delivery is not available yet. You can order for dine-in or takeaway.");
  }

  // Retried submissions (double tap, flaky network) return the first order.
  if (input.idempotencyKey) {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      return { order: existing, replayed: true as const };
    }
  }

  const lines = await priceOrderLines(input.items);
  const totals = computeTotals({
    lines,
    serviceChargeBps: settings.serviceChargeBps,
    vatBps: settings.vatBps,
    vatOnServiceCharge: settings.vatOnServiceCharge,
    roundingStepPoisa: settings.roundingStepPoisa,
    deliveryFeePoisa: input.type === "DELIVERY" ? settings.deliveryFeePoisa : 0,
  });

  // The cart only ever sees menu prices, so it is checked against the food
  // subtotal — never the grand total, which carries charges the guest cannot know.
  // A mismatch means something moved under them (price edit, item pulled, option
  // sold out) and the order is refused rather than silently re-priced.
  if (input.cartTotalPoisa !== undefined && input.cartTotalPoisa !== totals.subtotalPoisa) {
    throw new AppError(
      "CONFLICT",
      "Prices or availability changed while you were browsing. Please review your cart before ordering.",
    );
  }

  const order = await prisma.$transaction(
    async (tx) => {
      let table = null;
      let session = null;
      let participant = null;

      if (input.type === "DINE_IN") {
        if (!input.tableToken) throw new AppError("VALIDATION", "Scan the table QR code to place a dine-in order.");
        const resolved = await resolveTableToken(input.tableToken, tx);
        if (input.participantToken) {
          const guest = await tx.tableSessionGuest.findUnique({
            where: { participantToken: input.participantToken },
            include: { session: true },
          });
          if (guest && guest.session.status === "ACTIVE" && guest.session.tableId === resolved.id) {
            participant = guest;
            session = guest.session;
          }
        }
        if (!session) {
          // The guest's link expired or was never joined; re-join the same table.
          const joined = await joinSessionByTableToken(input.tableToken, { participantToken: input.participantToken });
          participant = await tx.tableSessionGuest.findUniqueOrThrow({ where: { participantToken: joined.participantToken }, include: { session: true } });
          session = participant.session;
          table = await tx.restaurantTable.findUniqueOrThrow({ where: { id: session.tableId } });
        } else {
          table = resolved;
        }
        if (session.status !== "ACTIVE") throw new AppError("SESSION_CLOSED", "This table's visit has been closed. Please ask staff for help.");
      }

      const orderNumber = await nextDocumentNumber("order", { timeZone: settings.timezone, client: tx });

      const created = await tx.order.create({
        data: {
          orderNumber,
          type: input.type,
          status: settings.autoConfirmOrders ? "CONFIRMED" : "PENDING",
          paymentStatus: "UNPAID",
          publicToken: randomToken(12),
          idempotencyKey: input.idempotencyKey,
          tableId: table?.id ?? null,
          sessionId: session?.id ?? null,
          participantId: participant?.id ?? null,
          customerId: context.customerId ?? context.actor?.userId ?? null,
          staffUserId: context.actor?.role !== "CUSTOMER" ? (context.actor?.userId ?? null) : null,
          contactName: input.contact?.name ?? null,
          contactPhone: input.contact?.phone ?? null,
          deliveryAddress: input.contact?.address ?? null,
          subtotalPoisa: totals.subtotalPoisa,
          discountPoisa: totals.discountPoisa,
          serviceChargePoisa: totals.serviceChargePoisa,
          vatPoisa: totals.vatPoisa,
          deliveryFeePoisa: totals.deliveryFeePoisa,
          totalPoisa: totals.totalPoisa,
          specialInstructions: input.specialInstructions?.trim() || null,
          confirmedAt: settings.autoConfirmOrders ? new Date() : null,
          items: {
            create: lines.map((line) => ({
              menuItemId: line.menuItemId,
              nameSnapshot: line.nameSnapshot,
              unitPricePoisa: line.unitPricePoisa,
              quantity: line.quantity,
              lineTotalPoisa: line.lineTotalPoisa,
              optionsSnapshot: line.optionsSnapshot,
              instructions: line.instructions,
            })),
          },
          statusEvents: {
            create: [
              {
                fromStatus: null,
                toStatus: settings.autoConfirmOrders ? "CONFIRMED" : "PENDING",
                actorUserId: context.actor?.userId ?? null,
                note: session ? `Table ${table?.label}` : input.type,
              },
            ],
          },
        },
        include: { items: true, table: { select: { label: true } }, session: { select: { id: true, code: true } } },
      });

      if (session) {
        await tx.restaurantTable.update({ where: { id: session.tableId }, data: { status: "OCCUPIED" } });
      }
      return created;
    },
    { isolationLevel: "ReadCommitted" },
  );

  await writeAudit({
    actorUserId: context.actor?.userId ?? null,
    actorType: context.actor ? "USER" : "GUEST",
    actorLabel: input.contact?.name,
    action: "order.create",
    entityType: "Order",
    entityId: order.id,
    after: { orderNumber: order.orderNumber, totalPoisa: order.totalPoisa, itemCount: lines.length },
    ip: context.ip,
  });

  await queueNotification({
    type: "ORDER_CREATED",
    subject: `New ${input.type.toLowerCase().replace("_", "-")} order ${order.orderNumber}`,
    bodyText: `Order ${order.orderNumber} for ${order.table?.label ?? input.contact?.name ?? "a guest"} totals ${order.totalPoisa / 100} ${settings.currencyCode}.`,
    relatedKind: "Order",
    relatedId: order.id,
    staffAudience: true,
  });

  return { order, replayed: false as const };
}

const ORDER_DETAIL_INCLUDE = {
  items: { orderBy: { createdAt: "asc" as const } },
  table: { select: { id: true, label: true, number: true, publicToken: true } },
  session: { select: { id: true, code: true, status: true, openedAt: true, closedAt: true } },
  statusEvents: { orderBy: { createdAt: "asc" as const }, take: 20 },
  customer: { select: { id: true, name: true, email: true } },
  payments: { select: { id: true, status: true, amountPoisa: true, method: true, verifiedAt: true } },
} satisfies NonNullable<Parameters<typeof prisma.order.findFirst>[0]>["include"];

export async function getOrderById(id: string, client: Db = prisma) {
  const order = await client.order.findUnique({ where: { id }, include: ORDER_DETAIL_INCLUDE });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  return order;
}

/** Guest-facing status lookup by unguessable public token only. */
export async function getOrderByPublicToken(publicToken: string, client: Db = prisma) {
  const order = await client.order.findUnique({
    where: { publicToken },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      table: { select: { label: true } },
      session: { select: { code: true, status: true } },
      statusEvents: { orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } },
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "We could not find that order.");
  return order;
}

/**
 * Session view for a table. Returns only this visit's orders — a guest holding a
 * table token never sees another visit's history or bill.
 */
export async function getSessionOrdersForGuest(participantToken: string, client: Db = prisma) {
  const participant = await client.tableSessionGuest.findUnique({
    where: { participantToken },
    include: {
      session: {
        include: {
          table: { select: { label: true, number: true } },
          orders: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              orderNumber: true,
              publicToken: true,
              status: true,
              paymentStatus: true,
              totalPoisa: true,
              createdAt: true,
              items: { select: { nameSnapshot: true, quantity: true, lineTotalPoisa: true } },
            },
          },
        },
      },
    },
  });
  if (!participant) throw new AppError("NOT_FOUND", "This ordering link is no longer valid.");
  if (participant.session.status !== "ACTIVE") {
    throw new AppError("SESSION_CLOSED", "This table's session has been closed. Please ask staff for help.");
  }
  return participant;
}

export type OrderListFilters = {
  status?: OrderStatus;
  type?: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  tableId?: string;
  sessionId?: string;
  customerId?: string;
  search?: string;
  from?: Date;
  to?: Date;
  kitchenView?: boolean;
};

export async function listOrders(filters: OrderListFilters, pagination: { skip: number; take: number }) {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.tableId) where.tableId = filters.tableId;
  if (filters.sessionId) where.sessionId = filters.sessionId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.from || filters.to) {
    where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) };
  }
  if (filters.kitchenView) where.status = filters.status ?? { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] };
  if (filters.search) {
    const digits = phoneSearchDigits(filters.search);
    where.OR = [
      { orderNumber: { contains: filters.search, mode: "insensitive" as const } },
      { contactName: { contains: filters.search, mode: "insensitive" as const } },
      // Only search the phone once there are actual digits: an empty "contains"
      // matches every stored number and would return the whole list.
      ...(digits.length >= 3 ? [{ contactPhone: { contains: digits, mode: "insensitive" as const } }] : []),
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        items: { select: { id: true, nameSnapshot: true, quantity: true, instructions: true, optionsSnapshot: true } },
        table: { select: { label: true } },
        statusEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, toStatus: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  return { orders, total };
}

export async function updateOrderStatus(
  orderId: string,
  to: OrderStatus,
  actor: { userId: string; role: string; ip?: string },
  note?: string,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");

  if (order.status === to) return order;
  if (!isTransitionAllowed(order.status, to, actor.role)) {
    throw new AppError(
      "INVALID_TRANSITION",
      `An order in "${order.status}" cannot move to "${to}"${actor.role === "KITCHEN" ? " for kitchen staff" : ""}.`,
    );
  }

  const timestampField = STATUS_TIMESTAMPS[to];
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.order.update({
      where: { id: orderId },
      data: {
        status: to,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
        ...(to === "CANCELLED" ? { cancelledReason: note ?? "Cancelled by staff" } : {}),
      },
    });
    await tx.orderStatusEvent.create({
      data: { orderId, fromStatus: order.status, toStatus: to, actorUserId: actor.userId, note: note ?? null },
    });

    // A cancelled order must not keep a table session "owing" money.
    if (to === "CANCELLED" && order.sessionId) {
      const bill = await tx.bill.findFirst({ where: { sessionId: order.sessionId, status: "OPEN" } });
      if (bill) await recalculateBillTotals(bill.id, tx);
    }
    return changed;
  });

  await writeAudit({
    actorUserId: actor.userId,
    action: "order.status",
    entityType: "Order",
    entityId: orderId,
    before: { status: order.status },
    after: { status: to },
    meta: { note, role: actor.role },
    ip: actor.ip,
  });

  if (to === "READY") {
    await queueNotification({
      type: "ORDER_READY",
      subject: `Order ${order.orderNumber} is ready`,
      bodyText: `Order ${order.orderNumber} is ready for pickup or the table.`,
      relatedKind: "Order",
      relatedId: order.id,
      staffAudience: true,
    });
  } else if (to === "CANCELLED" || to === "COMPLETED") {
    await queueNotification({
      type: "ORDER_STATUS_CHANGED",
      subject: `Order ${order.orderNumber} is ${to.toLowerCase()}`,
      bodyText: `Order ${order.orderNumber} moved to ${to}.`,
      relatedKind: "Order",
      relatedId: order.id,
    });
  }

  return updated;
}

/** A cancelled order must leave the open bill immediately, inside the same transaction. */
async function recalculateBillTotals(billId: string, tx: Db): Promise<void> {
  await refreshBillLines(billId, tx, { preserveFinalized: true });
}

export async function cancelOrder(
  orderId: string,
  reason: string,
  actor: { userId: string; role: string; ip?: string },
) {
  if (!["OWNER", "MANAGER", "CASHIER"].includes(actor.role)) {
    throw new AppError("FORBIDDEN", "Only counter or management staff can cancel an order.");
  }
  return updateOrderStatus(orderId, "CANCELLED", actor, reason);
}

/** Kitchen queue: oldest first, with the elapsed time the display highlights. */
export async function getKitchenQueue(client: Db = prisma) {
  const orders = await client.order.findMany({
    where: { status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] } },
    orderBy: { createdAt: "asc" },
    include: {
      table: { select: { label: true } },
      items: {
        select: {
          id: true,
          nameSnapshot: true,
          quantity: true,
          instructions: true,
          optionsSnapshot: true,
          menuItem: { select: { prepMinutes: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      session: { select: { code: true } },
    },
  });
  const now = Date.now();
  return orders.map((order) => {
    const elapsedMinutes = Math.max(0, Math.round((now - order.createdAt.getTime()) / 60_000));
    const expectedMinutes = order.items.reduce(
      (slowest, item) => Math.max(slowest, item.menuItem?.prepMinutes ?? 15),
      10,
    );
    return {
      ...order,
      elapsedMinutes,
      expectedMinutes,
      overdue: elapsedMinutes > expectedMinutes && order.status !== "READY",
    };
  });
}

/** Counters for the dashboard header and the polling badge. */
export async function getOrderCounters() {
  const grouped = await prisma.order.groupBy({ by: ["status"], where: { createdAt: { gte: startOfToday() } }, _count: { _all: true } });
  const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all])) as Partial<Record<OrderStatus, number>>;
  return {
    pending: counts.PENDING ?? 0,
    preparing: counts.PREPARING ?? 0,
    ready: counts.READY ?? 0,
    served: counts.SERVED ?? 0,
    completed: counts.COMPLETED ?? 0,
    cancelled: counts.CANCELLED ?? 0,
  };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function paymentStatusFor(totalPoisa: number, paidPoisa: number): PaymentStatus {
  return derivePaymentStatus({ totalPoisa, paidPoisa });
}
