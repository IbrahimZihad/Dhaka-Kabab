import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { formatPoisa } from "@/lib/money";
import { getSettings } from "@/server/services/settings.service";
import { dayRange } from "@/lib/time";
import { publicUser, type PublicUser } from "@/server/services/auth.service";
import { phoneSearchDigits } from "@/server/validation/common";
import type { CustomerUpdateInput } from "@/server/validation/auth";

/**
 * Customer records. Registered diners are User rows; guests who ordered through
 * a table QR without signing in are kept as contact snapshots on the order, so a
 * restaurant can still see who dined and what they spent.
 */

export type CustomerSpend = { orders: number; spendPoisa: number; lastOrderAt: Date | null };

/**
 * Widen the two date keys of a spend filter to whole days in the restaurant's
 * own timezone. A bare key is UTC midnight, which is 06:00 in Dhaka, so without
 * this a diner charged at 02:00 falls outside their own "today" — and the end
 * key, read as a start, would drop the final day from the window entirely.
 */
export async function spendWindow(fromKey?: string, toKey?: string): Promise<{ from?: Date; to?: Date }> {
  if (!fromKey && !toKey) return {};
  const { timezone } = await getSettings();
  return {
    from: fromKey ? dayRange(fromKey, timezone).start : undefined,
    to: toKey ? dayRange(toKey, timezone).end : undefined,
  };
}

export async function listCustomers(
  filters: { search?: string; active?: boolean; from?: Date; to?: Date },
  pagination: { skip: number; take: number },
) {
  const phoneDigits = phoneSearchDigits(filters.search ?? "");
  const where = {
    role: "CUSTOMER" as const,
    ...(filters.active === undefined ? {} : { isActive: filters.active }),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" as const } },
            { email: { contains: filters.search, mode: "insensitive" as const } },
            // An empty "contains" matches every stored number, so a search that
            // is all punctuation must not contribute the phone branch.
            ...(phoneDigits.length >= 3 ? [{ phone: { contains: phoneDigits } }] : []),
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        address: true,
        notes: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  const spend = await spendByCustomer(users.map((customer) => customer.id), filters.from, filters.to);
  const settings = await getSettings();
  return {
    customers: users.map((customer) => ({
      ...customer,
      spend: spend.get(customer.id) ?? { orders: 0, spendPoisa: 0, lastOrderAt: null },
      spendLabel: formatPoisa(spend.get(customer.id)?.spendPoisa ?? 0, { symbol: settings.currencySymbol }),
    })),
    total,
  };
}

async function spendByCustomer(customerIds: string[], from?: Date, to?: Date): Promise<Map<string, CustomerSpend>> {
  const map = new Map<string, CustomerSpend>();
  if (customerIds.length === 0) return map;
  const grouped = await prisma.order.groupBy({
    by: ["customerId"],
    where: {
      customerId: { in: customerIds },
      status: { not: "CANCELLED" },
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    },
    _sum: { totalPoisa: true },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  for (const row of grouped) {
    if (!row.customerId) continue;
    map.set(row.customerId, {
      orders: row._count._all,
      spendPoisa: row._sum.totalPoisa ?? 0,
      lastOrderAt: row._max.createdAt ?? null,
    });
  }
  return map;
}

export async function getCustomerProfile(id: string) {
  const [customer, orders, reservations, spend] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        address: true,
        notes: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.order.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { items: { select: { nameSnapshot: true, quantity: true } }, table: { select: { label: true } } },
    }),
    prisma.reservation.findMany({
      where: { customerId: id },
      orderBy: { startsAt: "desc" },
      take: 50,
      include: { tables: { include: { table: { select: { label: true } } } } },
    }),
    spendByCustomer([id]),
  ]);
  if (!customer) throw new AppError("NOT_FOUND", "Customer not found.");
  const settings = await getSettings();
  const totals = spend.get(id) ?? { orders: 0, spendPoisa: 0, lastOrderAt: null };
  return {
    customer,
    totals: { ...totals, spendLabel: formatPoisa(totals.spendPoisa, { symbol: settings.currencySymbol }) },
    orders,
    reservations,
  };
}

export async function updateCustomer(
  id: string,
  input: Partial<CustomerUpdateInput>,
  actor: { userId: string; ip?: string },
): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new AppError("NOT_FOUND", "Customer not found.");
  if (existing.role !== "CUSTOMER") throw new AppError("VALIDATION", "This is a staff account; edit it from Staff.");
  if (input.phone) {
    const clash = await prisma.user.findFirst({ where: { phone: input.phone, id: { not: id } } });
    if (clash) throw new AppError("CONFLICT", "Another account already uses that phone number.");
  }

  // Field by field: an omitted key leaves the stored value alone, so a partial
  // save cannot wipe a staff note or a delivery address.
  const data: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone || null;
  if (input.address !== undefined) data.address = input.address || null;
  if (input.notes !== undefined) data.notes = input.notes || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (Object.keys(data).length === 0) return publicUser(existing);

  const updated = await prisma.user.update({ where: { id }, data });
  if (input.isActive === false) {
    await prisma.session.deleteMany({ where: { userId: id } });
  }
  await writeAudit({
    actorUserId: actor.userId,
    action: "customer.update",
    entityType: "User",
    entityId: id,
    before: { name: existing.name, phone: existing.phone, isActive: existing.isActive },
    after: { name: updated.name, phone: updated.phone, isActive: updated.isActive },
    meta: { changedKeys: Object.keys(data) },
    ip: actor.ip,
  });
  return publicUser(updated);
}

/**
 * Diners who ordered without an account. Contact snapshots live on the order,
 * so this list survives even if the guest never registers.
 */
export async function listWalkInGuests(pagination: { skip: number; take: number }) {
  const grouped = await prisma.order.groupBy({
    by: ["contactPhone", "contactName"],
    where: { customerId: null, contactPhone: { not: null }, status: { not: "CANCELLED" } },
    _count: { _all: true },
    _sum: { totalPoisa: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    skip: pagination.skip,
    take: pagination.take,
  });
  const settings = await getSettings();
  return grouped.map((row) => ({
    name: row.contactName ?? "Unnamed guest",
    phone: row.contactPhone ?? "",
    orders: row._count._all,
    spendPoisa: row._sum.totalPoisa ?? 0,
    spendLabel: formatPoisa(row._sum.totalPoisa ?? 0, { symbol: settings.currencySymbol }),
    lastVisit: row._max.createdAt,
  }));
}

/** Signed-in customer's own history — never another person's. */
export async function myOrderHistory(userId: string, limit = 20) {
  return prisma.order.findMany({
    where: { customerId: userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      orderNumber: true,
      publicToken: true,
      type: true,
      status: true,
      paymentStatus: true,
      totalPoisa: true,
      createdAt: true,
      table: { select: { label: true } },
      items: { select: { nameSnapshot: true, quantity: true } },
    },
  });
}

export async function myReservations(userId: string, limit = 20) {
  return prisma.reservation.findMany({
    where: { customerId: userId },
    orderBy: { startsAt: "desc" },
    take: limit,
    select: {
      id: true,
      code: true,
      publicToken: true,
      startsAt: true,
      partySize: true,
      status: true,
      tables: { select: { table: { select: { label: true } } } },
    },
  });
}
