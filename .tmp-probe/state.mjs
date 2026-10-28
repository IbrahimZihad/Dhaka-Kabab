import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const tables = await prisma.restaurantTable.findMany({
  where: { isEnabled: true },
  orderBy: { number: "asc" },
  select: { id: true, label: true, number: true, capacity: true, status: true },
});
console.log("enabled tables:", tables.map((t) => `${t.label}:${t.capacity}:${t.status}`).join(" "));

const sessions = await prisma.tableSession.findMany({
  where: { status: "ACTIVE" },
  include: { table: { select: { label: true } }, orders: { select: { orderNumber: true, status: true } } },
  orderBy: { openedAt: "asc" },
});
console.log(
  "active sessions:",
  sessions.map((s) => `${s.table?.label}/${s.code}/${s.orders.length} orders`).join(" ") || "none",
);

const reservations = await prisma.reservation.findMany({
  where: { status: { in: ["PENDING", "CONFIRMED", "SEATED"] } },
  include: { tables: { include: { table: { select: { label: true } } } } },
  orderBy: { startsAt: "asc" },
});
console.log(
  "open reservations:",
  reservations
    .map((r) => `${r.customerName}|${r.startsAt.toISOString()}|p${r.partySize}|${r.status}|${r.tables.map((t) => t.table?.label).join("+")}`)
    .join("  ") || "none",
);

const e2eOrders = await prisma.order.count({ where: { customerName: { startsWith: "E2" } } });
const e2eReservations = await prisma.reservation.count({ where: { customerName: { startsWith: "E2" } } });
console.log("rows named E2*:", { orders: e2eOrders, reservations: e2eReservations });

await prisma.$disconnect();
