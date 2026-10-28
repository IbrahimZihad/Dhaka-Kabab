import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatPoisa } from "@/lib/money";
import { bpsToPercentLabel } from "@/lib/money";
import { getSettings } from "@/server/services/settings.service";
import { dayRange, zonedParts } from "@/lib/time";

/**
 * Reporting. Money is summed from stored integer poisa, and "sales" (order
 * totals raised) is always kept separate from "collected" (verified payments),
 * because those two legitimately differ while a table is still dining.
 */

export type DateWindow = { from: Date; to: Date };

const REVENUE_STATES = ["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED"] as const;

function shiftDateKey(dateKey: string, days: number): string {
  const shifted = new Date(`${dateKey}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function windowFor(range: "today" | "yesterday" | "7d" | "30d" | "month" | "custom", timeZone: string, custom?: DateWindow): DateWindow {
  const todayKey = zonedParts(new Date(), timeZone).dateKey;
  if (range === "custom") {
    if (!custom) throw new AppError("VALIDATION", "Choose a start and end date.");
    return custom;
  }
  if (range === "yesterday") return asWindow(dayRange(shiftDateKey(todayKey, -1), timeZone));
  if (range === "month") {
    // Month to date: the first of the month through the end of today. One
    // `dayRange` would stop at the first day and report an empty month.
    const first = asWindow(dayRange(`${todayKey.slice(0, 8)}01`, timeZone));
    return { from: first.from, to: asWindow(dayRange(todayKey, timeZone)).to };
  }
  if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    // A trailing-N-day report starts N-1 days back and runs through tomorrow's
    // local midnight, so today is included without spilling into the next day.
    const first = asWindow(dayRange(shiftDateKey(todayKey, -(days - 1)), timeZone));
    return { from: first.from, to: asWindow(dayRange(shiftDateKey(todayKey, 1), timeZone)).from };
  }
  return asWindow(dayRange(todayKey, timeZone));
}

function asWindow(range: { start: Date; end: Date }): DateWindow {
  return { from: range.start, to: range.end };
}

/** Revenue by local day, computed in the restaurant's own timezone. */
export async function dailySales(window: DateWindow) {
  const settings = await getSettings();
  const rows = await prisma.$queryRaw<{ day: string; orders: bigint; revenuePoisa: bigint; discountPoisa: bigint }[]>(
    Prisma.sql`
      SELECT to_char(o."createdAt" AT TIME ZONE ${settings.timezone}, 'YYYY-MM-DD') AS day,
             count(*)::bigint AS orders,
             coalesce(sum(o."totalPoisa"), 0)::bigint AS "revenuePoisa",
             coalesce(sum(o."discountPoisa"), 0)::bigint AS "discountPoisa"
      FROM orders o
      WHERE o."createdAt" >= ${window.from} AND o."createdAt" < ${window.to} AND o.status <> 'CANCELLED'
      GROUP BY day ORDER BY day ASC`,
  );
  return rows.map((row) => ({
    day: row.day,
    orders: Number(row.orders),
    revenuePoisa: Number(row.revenuePoisa),
    discountPoisa: Number(row.discountPoisa),
    revenueLabel: formatPoisa(Number(row.revenuePoisa), { symbol: settings.currencySymbol }),
  }));
}

export async function paymentCollection(window: DateWindow) {
  const settings = await getSettings();
  const [rows, demo] = await Promise.all([
    prisma.payment.groupBy({
      by: ["method"],
      where: { status: "SUCCEEDED", createdAt: { gte: window.from, lt: window.to } },
      _sum: { amountPoisa: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: { status: "SUCCEEDED", isDemo: true, createdAt: { gte: window.from, lt: window.to } },
      _sum: { amountPoisa: true },
    }),
  ]);
  return {
    byMethod: rows.map((row) => ({
      method: row.method,
      payments: row._count._all,
      amountPoisa: row._sum.amountPoisa ?? 0,
      amountLabel: formatPoisa(row._sum.amountPoisa ?? 0, { symbol: settings.currencySymbol }),
    })),
    /** Seed or sandbox money is reported separately so it can never inflate takings. */
    demoCollectedPoisa: demo._sum.amountPoisa ?? 0,
  };
}

export async function topItems(window: DateWindow, limit = 10) {
  const settings = await getSettings();
  const rows = await prisma.orderItem.groupBy({
    by: ["nameSnapshot"],
    where: { order: { status: { in: [...REVENUE_STATES] }, createdAt: { gte: window.from, lt: window.to } } },
    _sum: { quantity: true, lineTotalPoisa: true },
    _count: { _all: true },
    orderBy: { _sum: { lineTotalPoisa: "desc" } },
    take: limit,
  });
  return rows.map((row) => ({
    name: row.nameSnapshot,
    sold: row._sum.quantity ?? 0,
    revenuePoisa: row._sum.lineTotalPoisa ?? 0,
    revenueLabel: formatPoisa(row._sum.lineTotalPoisa ?? 0, { symbol: settings.currencySymbol }),
  }));
}

export async function categorySales(window: DateWindow) {
  const settings = await getSettings();
  // LEFT JOIN: a line stays in the report even after its menu item is deleted,
  // under its own snapshot name, rather than silently vanishing from takings.
  const rows = await prisma.$queryRaw<{ category: string; product: string; revenuePoisa: bigint; units: bigint }[]>(
    Prisma.sql`
      SELECT coalesce(c.name, '(no category)') AS category,
             coalesce(m.name, oi."nameSnapshot") AS product,
             coalesce(sum(oi."lineTotalPoisa"), 0)::bigint AS "revenuePoisa",
             coalesce(sum(oi.quantity), 0)::bigint AS units
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      LEFT JOIN menu_items m ON m.id = oi."menuItemId"
      LEFT JOIN menu_categories c ON c.id = m."categoryId"
      WHERE o."createdAt" >= ${window.from} AND o."createdAt" < ${window.to} AND o.status <> 'CANCELLED'
      GROUP BY category, product
      ORDER BY "revenuePoisa" DESC`,
  );
  const byCategory = new Map<string, { units: number; revenuePoisa: number }>();
  for (const row of rows) {
    const entry = byCategory.get(row.category) ?? { units: 0, revenuePoisa: 0 };
    entry.units += Number(row.units);
    entry.revenuePoisa += Number(row.revenuePoisa);
    byCategory.set(row.category, entry);
  }
  return [...byCategory.entries()]
    .sort((a, b) => b[1].revenuePoisa - a[1].revenuePoisa)
    .map(([category, agg]) => ({
      category,
      units: agg.units,
      revenuePoisa: agg.revenuePoisa,
      revenueLabel: formatPoisa(agg.revenuePoisa, { symbol: settings.currencySymbol }),
    }));
}

/** Day-of-week × hour heat map of order volume, for staffing decisions. */
export async function demandHeatmap(window: DateWindow) {
  const settings = await getSettings();
  const rows = await prisma.$queryRaw<{ dow: number; hour: number; orders: bigint }[]>(
    Prisma.sql`
      SELECT extract(dow FROM o."createdAt" AT TIME ZONE ${settings.timezone})::int AS dow,
             extract(hour FROM o."createdAt" AT TIME ZONE ${settings.timezone})::int AS hour,
             count(*)::bigint AS orders
      FROM orders o
      WHERE o."createdAt" >= ${window.from} AND o."createdAt" < ${window.to} AND o.status <> 'CANCELLED'
      GROUP BY dow, hour ORDER BY dow, hour`,
  );
  return rows.map((row) => ({ weekday: Number(row.dow), hour: Number(row.hour), orders: Number(row.orders) }));
}

export async function kitchenPerformance(window: DateWindow) {
  const rows = await prisma.order.findMany({
    where: { createdAt: { gte: window.from, lt: window.to }, status: { not: "CANCELLED" }, readyAt: { not: null } },
    select: { createdAt: true, readyAt: true, orderNumber: true },
  });
  if (rows.length === 0) return { ordersMeasured: 0, averageMinutes: null, slowest: [] as { orderNumber: string; minutes: number }[] };
  const durations = rows
    .map((row) => ({ orderNumber: row.orderNumber, minutes: (row.readyAt!.getTime() - row.createdAt.getTime()) / 60_000 }))
    .sort((a, b) => b.minutes - a.minutes);
  const average = durations.reduce((total, entry) => total + entry.minutes, 0) / durations.length;
  return {
    ordersMeasured: durations.length,
    averageMinutes: Math.round(average * 10) / 10,
    slowest: durations.slice(0, 5).map((entry) => ({ orderNumber: entry.orderNumber, minutes: Math.round(entry.minutes) })),
  };
}

export async function reservationStats(window: DateWindow) {
  const [total, byStatus, noShow, seatedGuests] = await Promise.all([
    prisma.reservation.count({ where: { startsAt: { gte: window.from, lt: window.to } } }),
    prisma.reservation.groupBy({
      by: ["status"],
      where: { startsAt: { gte: window.from, lt: window.to } },
      _count: { _all: true },
    }),
    prisma.reservation.count({ where: { startsAt: { gte: window.from, lt: window.to }, status: "NO_SHOW" } }),
    prisma.reservation.aggregate({
      where: { startsAt: { gte: window.from, lt: window.to }, status: { in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"] } },
      _sum: { partySize: true },
    }),
  ]);
  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    noShowRate: total === 0 ? null : Math.round((noShow / total) * 1000) / 10,
    /** Covers expected from confirmed bookings, not a booking count. */
    confirmedCovers: seatedGuests._sum.partySize ?? 0,
  };
}

export async function tableUtilisation(window: DateWindow) {
  const settings = await getSettings();
  const rows = await prisma.$queryRaw<{ label: string; sessions: bigint; covers: bigint; revenuePoisa: bigint }[]>(
    Prisma.sql`
      SELECT t.label,
             count(s.id)::bigint AS sessions,
             coalesce(sum(s."guestCount"), 0)::bigint AS covers,
             coalesce(sum(s.revenue), 0)::bigint AS "revenuePoisa"
      FROM restaurant_tables t
      LEFT JOIN (
        SELECT se."tableId", se.id, se."guestCount",
               (SELECT coalesce(sum(o."totalPoisa"), 0)
                FROM orders o
                WHERE o."sessionId" = se.id AND o.status <> 'CANCELLED'
                  AND o."createdAt" >= ${window.from} AND o."createdAt" < ${window.to}) AS revenue
        FROM table_sessions se
        WHERE se."openedAt" >= ${window.from} AND se."openedAt" < ${window.to}
      ) s ON s."tableId" = t.id
      GROUP BY t.id, t.label
      ORDER BY "revenuePoisa" DESC`,
  );
  return rows.map((row) => ({
    table: row.label,
    sessions: Number(row.sessions),
    covers: Number(row.covers),
    revenuePoisa: Number(row.revenuePoisa),
    revenueLabel: formatPoisa(Number(row.revenuePoisa), { symbol: settings.currencySymbol }),
  }));
}

/** Everything the overview screen needs, in one round of queries. */
export async function dashboardSnapshot() {
  const settings = await getSettings();
  const today = windowFor("today", settings.timezone);
  const [salesToday, ordersToday, openOrders, kitchenQueue, tables, reservationsToday, pendingPayments, collectedToday, demoToday] =
    await Promise.all([
      prisma.order.aggregate({
        where: { createdAt: { gte: today.from, lt: today.to }, status: { not: "CANCELLED" } },
        _sum: { totalPoisa: true },
        _count: { _all: true },
      }),
      prisma.order.count({ where: { createdAt: { gte: today.from, lt: today.to } } }),
      prisma.order.count({ where: { status: { in: ["PENDING", "CONFIRMED", "PREPARING"] } } }),
      prisma.order.count({ where: { status: "READY" } }),
      prisma.restaurantTable.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.reservation.count({ where: { startsAt: { gte: today.from, lt: today.to }, status: { in: ["PENDING", "CONFIRMED"] } } }),
      prisma.payment.count({ where: { status: "PENDING" } }),
      prisma.payment.aggregate({ where: { status: "SUCCEEDED", createdAt: { gte: today.from, lt: today.to } }, _sum: { amountPoisa: true } }),
      prisma.payment.aggregate({
        where: { status: "SUCCEEDED", isDemo: true, createdAt: { gte: today.from, lt: today.to } },
        _sum: { amountPoisa: true },
      }),
    ]);

  const revenuePoisa = salesToday._sum.totalPoisa ?? 0;
  const collectedPoisa = collectedToday._sum.amountPoisa ?? 0;
  const demoPoisa = demoToday._sum.amountPoisa ?? 0;

  return {
    dateKey: zonedParts(new Date(), settings.timezone).dateKey,
    revenueTodayPoisa: revenuePoisa,
    revenueTodayLabel: formatPoisa(revenuePoisa, { symbol: settings.currencySymbol }),
    collectedTodayPoisa: collectedPoisa,
    collectedTodayLabel: formatPoisa(collectedPoisa, { symbol: settings.currencySymbol }),
    /** Subtracted from "real takings" wherever money is reported as banked. */
    demoCollectedTodayPoisa: demoPoisa,
    ordersToday,
    averageOrderPoisa: salesToday._count._all > 0 ? Math.round(revenuePoisa / salesToday._count._all) : 0,
    openOrders,
    readyForPickup: kitchenQueue,
    reservationsToday,
    pendingGatewayPayments: pendingPayments,
    tables: Object.fromEntries(tables.map((row) => [row.status, row._count._all])),
    charges: {
      serviceChargePercent: bpsToPercentLabel(settings.serviceChargeBps),
      vatPercent: bpsToPercentLabel(settings.vatBps),
    },
    currencySymbol: settings.currencySymbol,
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export type ReportKind = "sales" | "orders" | "items" | "payments" | "reservations" | "tables" | "customers";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Only text can smuggle a formula in — a real negative amount must stay a
  // number so the spreadsheet can still total the column. Leading space is
  // skipped because Excel ignores it when it decides whether a cell is a formula.
  const guarded = typeof value === "string" && /^[=+\-@\t]/.test(text.trimStart()) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

const CSV_BOM = "﻿";

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const columns = headers ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
  // Headers go through the same guard as data: a report built from user-named
  // columns must not become an attack surface either.
  const lines = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))];
  // BOM so Excel opens Bangla or accented text correctly, even for an empty report.
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

export async function buildReport(kind: ReportKind, window: DateWindow) {
  const settings = await getSettings();
  const symbol = settings.currencySymbol;

  switch (kind) {
    case "sales": {
      const rows = await dailySales(window);
      return {
        filename: `dhaka-kabab-sales-${window.from.toISOString().slice(0, 10)}-to-${window.to.toISOString().slice(0, 10)}.csv`,
        rows: rows.map((row) => ({ date: row.day, orders: row.orders, revenuePoisa: row.revenuePoisa, revenue: row.revenueLabel, discountPoisa: row.discountPoisa, currency: settings.currencyCode })),
        headers: ["date", "orders", "revenuePoisa", "revenue", "discountPoisa", "currency"],
      };
    }
    case "orders": {
      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: window.from, lt: window.to } },
        orderBy: { createdAt: "asc" },
        include: { items: true, table: { select: { label: true } } },
      });
      return {
        filename: `dhaka-kabab-orders-${window.from.toISOString().slice(0, 10)}.csv`,
        rows: orders.map((order) => ({
          orderNumber: order.orderNumber,
          createdAt: order.createdAt.toISOString(),
          type: order.type,
          status: order.status,
          paymentStatus: order.paymentStatus,
          table: order.table?.label ?? "",
          items: order.items.reduce((total, item) => total + item.quantity, 0),
          subtotalPoisa: order.subtotalPoisa,
          serviceChargePoisa: order.serviceChargePoisa,
          vatPoisa: order.vatPoisa,
          discountPoisa: order.discountPoisa,
          totalPoisa: order.totalPoisa,
          total: formatPoisa(order.totalPoisa, { symbol }),
          isDemo: order.isDemo,
        })),
        headers: [
          "orderNumber", "createdAt", "type", "status", "paymentStatus", "table", "items",
          "subtotalPoisa", "serviceChargePoisa", "vatPoisa", "discountPoisa", "totalPoisa", "total", "isDemo",
        ],
      };
    }
    case "items": {
      const rows = await topItems(window, 500);
      return {
        filename: `dhaka-kabab-items-${window.from.toISOString().slice(0, 10)}.csv`,
        rows: rows.map((row) => ({ name: row.name, unitsSold: row.sold, revenuePoisa: row.revenuePoisa, revenue: row.revenueLabel })),
        headers: ["name", "unitsSold", "revenuePoisa", "revenue"],
      };
    }
    case "payments": {
      const payments = await prisma.payment.findMany({
        where: { createdAt: { gte: window.from, lt: window.to } },
        orderBy: { createdAt: "asc" },
        include: { bill: { select: { number: true } }, takenBy: { select: { name: true, email: true } } },
      });
      return {
        filename: `dhaka-kabab-payments-${window.from.toISOString().slice(0, 10)}.csv`,
        rows: payments.map((payment) => ({
          reference: payment.reference,
          createdAt: payment.createdAt.toISOString(),
          bill: payment.bill?.number ?? "",
          method: payment.method,
          provider: payment.provider,
          status: payment.status,
          amountPoisa: payment.amountPoisa,
          amount: formatPoisa(payment.amountPoisa, { symbol }),
          gatewayTxnId: payment.gatewayTxnId ?? "",
          takenBy: payment.takenBy?.name ?? payment.takenBy?.email ?? "",
          verifiedAt: payment.verifiedAt?.toISOString() ?? "",
          isDemo: payment.isDemo,
        })),
        headers: ["reference", "createdAt", "bill", "method", "provider", "status", "amountPoisa", "amount", "gatewayTxnId", "takenBy", "verifiedAt", "isDemo"],
      };
    }
    case "reservations": {
      const reservations = await prisma.reservation.findMany({
        where: { startsAt: { gte: window.from, lt: window.to } },
        orderBy: { startsAt: "asc" },
        include: { tables: { include: { table: { select: { label: true } } } } },
      });
      return {
        filename: `dhaka-kabab-reservations-${window.from.toISOString().slice(0, 10)}.csv`,
        rows: reservations.map((reservation) => ({
          code: reservation.code,
          startsAt: reservation.startsAt.toISOString(),
          customerName: reservation.customerName,
          phone: reservation.phone,
          email: reservation.email ?? "",
          partySize: reservation.partySize,
          status: reservation.status,
          tables: reservation.tables.map((assignment) => assignment.table.label).join(" "),
          createdAt: reservation.createdAt.toISOString(),
        })),
        headers: ["code", "startsAt", "customerName", "phone", "email", "partySize", "status", "tables", "createdAt"],
      };
    }
    case "tables": {
      const rows = await tableUtilisation(window);
      return {
        filename: `dhaka-kabab-tables-${window.from.toISOString().slice(0, 10)}.csv`,
        rows: rows.map((row) => ({ table: row.table, sessions: row.sessions, covers: row.covers, revenuePoisa: row.revenuePoisa, revenue: row.revenueLabel })),
        headers: ["table", "sessions", "covers", "revenuePoisa", "revenue"],
      };
    }
    case "customers": {
      const customers = await prisma.user.findMany({
        where: { role: "CUSTOMER", createdAt: { lt: window.to } },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { ordersCreated: true } } },
      });
      const spend = await prisma.order.groupBy({
        by: ["customerId"],
        where: { customerId: { in: customers.map((customer) => customer.id) }, status: { not: "CANCELLED" } },
        _sum: { totalPoisa: true },
      });
      const spendMap = new Map(spend.map((row) => [row.customerId, row._sum.totalPoisa ?? 0]));
      return {
        filename: `dhaka-kabab-customers-${window.from.toISOString().slice(0, 10)}.csv`,
        rows: customers.map((customer) => ({
          name: customer.name,
          email: customer.email,
          phone: customer.phone ?? "",
          orders: customer._count.ordersCreated,
          spendPoisa: spendMap.get(customer.id) ?? 0,
          spend: formatPoisa(spendMap.get(customer.id) ?? 0, { symbol }),
          since: customer.createdAt.toISOString(),
        })),
        headers: ["name", "email", "phone", "orders", "spendPoisa", "spend", "since"],
      };
    }
  }
}
