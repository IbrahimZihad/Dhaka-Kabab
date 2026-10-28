import QRCode from "qrcode";
import { derivePaymentStatus } from "@/lib/billing-math";
import { prisma, type Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { randomShortCode, randomToken } from "@/lib/ids";
import { getSettings } from "@/server/services/settings.service";
import type { TableInput } from "@/server/validation/table";

/**
 * Floor tables, their public QR tokens and the dining sessions that bind orders
 * to one visit.
 */

export type TableWithSession = Awaited<ReturnType<typeof listTables>>[number];

export async function listTables(options: { includeDisabled?: boolean } = {}, client: Db = prisma) {
  const tables = await client.restaurantTable.findMany({
    where: options.includeDisabled ? {} : { isEnabled: true },
    orderBy: [{ section: "asc" }, { number: "asc" }],
    include: {
      sessions: {
        where: { status: "ACTIVE" },
        orderBy: { openedAt: "desc" },
        take: 1,
        include: {
          orders: {
            where: { status: { not: "CANCELLED" } },
            select: { id: true, orderNumber: true, totalPoisa: true, status: true, paymentStatus: true },
          },
          bills: {
            where: { status: { in: ["OPEN", "FINALIZED"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, number: true, totalPoisa: true, paidPoisa: true, status: true },
          },
          reservation: { select: { id: true, code: true, customerName: true, partySize: true, startsAt: true, status: true } },
          guests: { select: { id: true, label: true, lastSeenAt: true } },
        },
      },
      _count: { select: { sessions: true } },
    },
  });
  return tables.map((table) => {
    const session = table.sessions[0] ?? null;
    const bill = session?.bills[0] ?? null;
    const outstanding = bill ? Math.max(0, bill.totalPoisa - bill.paidPoisa) : 0;
    return {
      id: table.id,
      label: table.label,
      number: table.number,
      publicToken: table.publicToken,
      capacity: table.capacity,
      section: table.section,
      status: table.status,
      isEnabled: table.isEnabled,
      disabledReason: table.disabledReason,
      sessionCount: table._count.sessions,
      activeSession: session
        ? {
            id: session.id,
            code: session.code,
            openedAt: session.openedAt,
            guestCount: session.guestCount,
            reservation: session.reservation,
            participants: session.guests.length,
            orders: session.orders,
            bill,
            outstandingPoisa: outstanding,
          }
        : null,
    };
  });
}

export async function getTableSummary(tableId: string, client: Db = prisma) {
  const tables = await listTables({ includeDisabled: true }, client);
  const table = tables.find((candidate) => candidate.id === tableId);
  if (!table) throw new AppError("NOT_FOUND", "Table not found.");
  return table;
}

/**
 * QR lookup. A disabled table or a stale token is refused here, which is the
 * single place the public ordering entry point decides what "valid table" means.
 */
export async function resolveTableToken(tableToken: string, client: Db = prisma) {
  const table = await client.restaurantTable.findUnique({ where: { publicToken: tableToken } });
  if (!table) throw new AppError("NOT_FOUND", "This table code is not recognised. Please ask staff for a new code.");
  if (!table.isEnabled || table.status === "DISABLED") {
    throw new AppError("TABLE_INACTIVE", `Table ${table.label} is closed for ordering. Please ask staff for help.`);
  }
  if (table.status === "CLEANING") {
    throw new AppError("TABLE_INACTIVE", `Table ${table.label} is being cleaned. Staff will open it shortly.`);
  }
  return table;
}

export async function createTable(input: TableInput, actorUserId: string | null, ip?: string) {
  const labelClash = await prisma.restaurantTable.findUnique({ where: { label: input.label } });
  if (labelClash) throw new AppError("CONFLICT", `Table label ${input.label} is already used.`);
  const numberClash = await prisma.restaurantTable.findUnique({ where: { number: input.number } });
  if (numberClash) throw new AppError("CONFLICT", `Table number ${input.number} is already used.`);

  const table = await prisma.restaurantTable.create({
    data: {
      label: input.label,
      number: input.number,
      capacity: input.capacity,
      section: input.section ?? null,
      isEnabled: input.isEnabled,
      status: input.isEnabled ? "AVAILABLE" : "DISABLED",
      publicToken: randomToken(16),
    },
  });
  await writeAudit({ actorUserId, action: "table.create", entityType: "RestaurantTable", entityId: table.id, after: table, ip });
  return table;
}

export async function updateTable(id: string, input: TableInput, actorUserId: string | null, ip?: string) {
  const before = await prisma.restaurantTable.findUnique({ where: { id } });
  if (!before) throw new AppError("NOT_FOUND", "Table not found.");
  const labelClash = await prisma.restaurantTable.findUnique({ where: { label: input.label } });
  if (labelClash && labelClash.id !== id) throw new AppError("CONFLICT", `Table label ${input.label} is already used.`);
  const numberClash = await prisma.restaurantTable.findUnique({ where: { number: input.number } });
  if (numberClash && numberClash.id !== id) throw new AppError("CONFLICT", `Table number ${input.number} is already used.`);
  if (!input.isEnabled && before.status === "OCCUPIED") {
    throw new AppError("CONFLICT", "Settle or transfer the active session before disabling this table.");
  }

  const table = await prisma.restaurantTable.update({
    where: { id },
    data: {
      label: input.label,
      number: input.number,
      capacity: input.capacity,
      section: input.section ?? null,
      isEnabled: input.isEnabled,
      status: input.isEnabled ? (before.isEnabled ? before.status : before.status === "DISABLED" ? "AVAILABLE" : before.status) : "DISABLED",
      disabledReason: input.isEnabled ? null : "Disabled by staff",
    },
  });
  await writeAudit({ actorUserId, action: "table.update", entityType: "RestaurantTable", entityId: id, before, after: table, ip });
  return table;
}

/**
 * Status changes go through this guard so a click cannot put the floor in a
 * contradictory state (e.g. "available" while an open session still has orders).
 */
export async function setTableStatus(
  id: string,
  status: "AVAILABLE" | "RESERVED" | "OCCUPIED" | "CLEANING" | "DISABLED",
  actorUserId: string | null,
  options: { reason?: string; ip?: string } = {},
) {
  const table = await prisma.restaurantTable.findUnique({
    where: { id },
    include: { sessions: { where: { status: "ACTIVE" }, take: 1 } },
  });
  if (!table) throw new AppError("NOT_FOUND", "Table not found.");

  if (status === "AVAILABLE" && table.sessions.length > 0) {
    throw new AppError("CONFLICT", "Close the active session first, then mark the table available.");
  }
  if (status === "OCCUPIED" && table.sessions.length === 0) {
    throw new AppError("CONFLICT", "Seat the guests with “Start session” instead of setting the status by hand.");
  }
  if (status === "DISABLED") {
    if (table.sessions.length > 0) throw new AppError("CONFLICT", "Settle or transfer the active session before disabling this table.");
    const updated = await prisma.restaurantTable.update({
      where: { id },
      data: { status: "DISABLED", isEnabled: false, disabledReason: options.reason ?? "Disabled by staff" },
    });
    await writeAudit({ actorUserId, action: "table.disable", entityType: "RestaurantTable", entityId: id, after: updated, meta: { reason: options.reason }, ip: options.ip });
    return updated;
  }
  if (!table.isEnabled) {
    throw new AppError("CONFLICT", "Re-enable this table before putting it back on the floor.");
  }

  const updated = await prisma.restaurantTable.update({
    where: { id },
    data: { status, disabledReason: null },
  });
  await writeAudit({ actorUserId, action: "table.status", entityType: "RestaurantTable", entityId: id, before: { status: table.status }, after: { status }, ip: options.ip });
  return updated;
}

/**
 * Rotating a token invalidates every printed placard for that table, so the old
 * token stops working immediately.
 */
export async function rotateTableToken(id: string, actorUserId: string | null, ip?: string) {
  const table = await prisma.restaurantTable.findUnique({ where: { id } });
  if (!table) throw new AppError("NOT_FOUND", "Table not found.");
  const updated = await prisma.restaurantTable.update({
    where: { id },
    data: { publicToken: randomToken(16), tokenRotatedAt: new Date() },
  });
  await writeAudit({
    actorUserId,
    action: "table.token.rotate",
    entityType: "RestaurantTable",
    entityId: id,
    meta: { previousLabel: table.label },
    ip,
  });
  return updated;
}

export function orderUrlForTable(tableToken: string, appUrl: string): string {
  return `${appUrl}/order?table=${encodeURIComponent(tableToken)}`;
}

/** PNG data URL, ready for an <img src>. Also used by the download endpoint. */
export async function qrDataUrl(target: string): Promise<string> {
  return QRCode.toDataURL(target, { width: 512, margin: 2, errorCorrectionLevel: "M", color: { dark: "#1b1a17", light: "#ffffff" } });
}

export async function qrPngBuffer(target: string): Promise<Buffer> {
  return QRCode.toBuffer(target, { type: "png", width: 512, margin: 2, errorCorrectionLevel: "M" });
}

/** Every active table plus its QR target and image, for the printable sheet. */
export async function buildQrSheet(appUrl: string) {
  const tables = await prisma.restaurantTable.findMany({
    where: { isEnabled: true },
    orderBy: [{ section: "asc" }, { number: "asc" }],
  });
  return Promise.all(
    tables.map(async (table) => ({
      id: table.id,
      label: table.label,
      number: table.number,
      capacity: table.capacity,
      section: table.section,
      url: orderUrlForTable(table.publicToken, appUrl),
      dataUrl: await qrDataUrl(orderUrlForTable(table.publicToken, appUrl)),
    })),
  );
}

// ---------------------------------------------------------------------------
// Dining sessions
// ---------------------------------------------------------------------------

export type JoinedSession = {
  sessionId: string;
  sessionCode: string;
  tableId: string;
  tableLabel: string;
  tableToken: string;
  participantToken: string;
  openedAt: Date;
  wasAutoOpened: boolean;
};

/**
 * Guest entry point after a QR scan. Locks the table row so two phones scanning
 * at once still land in the same session, and never in two.
 */
export async function joinSessionByTableToken(
  tableToken: string,
  input: { participantToken?: string; label?: string },
): Promise<JoinedSession> {
  const settings = await getSettings();
  if (!settings.allowDineIn) throw new AppError("TABLE_INACTIVE", "Dine-in ordering is turned off right now.");

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM restaurant_tables WHERE "publicToken" = ${tableToken} FOR UPDATE`;
    if (locked.length === 0) throw new AppError("NOT_FOUND", "This table code is not recognised. Please ask staff for a new code.");

    const table = await tx.restaurantTable.findUniqueOrThrow({
      where: { id: locked[0]!.id },
      include: { sessions: { where: { status: "ACTIVE" }, orderBy: { openedAt: "desc" }, take: 1 } },
    });
    if (!table.isEnabled || table.status === "DISABLED") {
      throw new AppError("TABLE_INACTIVE", `Table ${table.label} is closed for ordering. Please ask staff for help.`);
    }
    if (table.status === "CLEANING") {
      throw new AppError("TABLE_INACTIVE", `Table ${table.label} is being cleaned. Staff will open it shortly.`);
    }

    let session = table.sessions[0] ?? null;
    let wasAutoOpened = false;
    if (!session) {
      // A guest scanning an untouched table opens the visit; staff stay in
      // control through the CLEANING/DISABLED states and settlement.
      session = await tx.tableSession.create({
        data: {
          code: `${table.label}-${randomShortCode(4)}`,
          tableId: table.id,
          guestCount: 2,
          openedByUserId: null,
          notes: "Opened by guest scanning the table QR code",
        },
      });
      await tx.restaurantTable.update({ where: { id: table.id }, data: { status: "OCCUPIED" } });
      wasAutoOpened = true;
    }

    let participant = input.participantToken
      ? await tx.tableSessionGuest.findUnique({ where: { participantToken: input.participantToken } })
      : null;
    if (participant && participant.sessionId !== session.id) participant = null;
    if (!participant) {
      participant = await tx.tableSessionGuest.create({
        data: { sessionId: session.id, participantToken: randomToken(12), label: input.label ?? null },
      });
    } else {
      participant = await tx.tableSessionGuest.update({
        where: { id: participant.id },
        data: { lastSeenAt: new Date() },
      });
    }

    return {
      sessionId: session.id,
      sessionCode: session.code,
      tableId: table.id,
      tableLabel: table.label,
      tableToken: table.publicToken,
      participantToken: participant.participantToken,
      openedAt: session.openedAt,
      wasAutoOpened,
      tableName: table.label,
    };
  });

  await writeAudit({
    actorType: "GUEST",
    actorLabel: `table ${result.tableName}`,
    action: result.wasAutoOpened ? "session.open.guest" : "session.join",
    entityType: "TableSession",
    entityId: result.sessionId,
    meta: { tableToken, autoOpened: result.wasAutoOpened },
  });

  const { tableName: _tableName, ...joined } = result;
  void _tableName;
  return joined;
}

export async function openSession(
  input: { tableId: string; guestCount: number; reservationId?: string; notes?: string },
  actor: { userId: string; ip?: string },
) {
  const session = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM restaurant_tables WHERE id = ${input.tableId} FOR UPDATE`;
    if (locked.length === 0) throw new AppError("NOT_FOUND", "Table not found.");
    const table = await tx.restaurantTable.findUniqueOrThrow({
      where: { id: input.tableId },
      include: { sessions: { where: { status: "ACTIVE" }, take: 1 } },
    });
    if (!table.isEnabled) throw new AppError("TABLE_INACTIVE", `Table ${table.label} is disabled.`);
    if (table.sessions.length > 0) {
      throw new AppError("CONFLICT", `Table ${table.label} already has an open session (${table.sessions[0]!.code}).`);
    }
    if (input.reservationId) {
      const reservation = await tx.reservation.findUnique({ where: { id: input.reservationId } });
      if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
      if (!["CONFIRMED", "PENDING", "CHECKED_IN"].includes(reservation.status)) {
        throw new AppError("CONFLICT", `Reservation ${reservation.code} is ${reservation.status} and cannot seat guests.`);
      }
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
    }

    const created = await tx.tableSession.create({
      data: {
        code: `${table.label}-${randomShortCode(4)}`,
        tableId: table.id,
        guestCount: input.guestCount,
        reservationId: input.reservationId ?? null,
        openedByUserId: actor.userId,
        notes: input.notes ?? null,
      },
    });
    await tx.restaurantTable.update({ where: { id: table.id }, data: { status: "OCCUPIED" } });
    return created;
  });

  await writeAudit({
    actorUserId: actor.userId,
    action: "session.open",
    entityType: "TableSession",
    entityId: session.id,
    after: session,
    ip: actor.ip,
  });
  return session;
}

export async function closeSession(
  sessionId: string,
  input: { reason: "SETTLED" | "TRANSFERRED" | "NO_PAYMENT" | "MANUAL"; note?: string },
  actor: { userId: string; role: string; ip?: string },
) {
  const settings = await getSettings();
  const session = await prisma.$transaction(async (tx) => {
    const existing = await tx.tableSession.findUnique({
      where: { id: sessionId },
      include: {
        table: true,
        bills: { where: { status: { in: ["OPEN", "FINALIZED"] } } },
        orders: { where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } },
      },
    });
    if (!existing) throw new AppError("NOT_FOUND", "Session not found.");
    if (existing.status === "CLOSED") return existing;

    const outstanding = existing.bills.reduce((total, bill) => total + Math.max(0, bill.totalPoisa - bill.paidPoisa), 0);
    if (outstanding > 0 && input.reason !== "TRANSFERRED") {
      const allowed = actor.role === "OWNER" || actor.role === "MANAGER";
      if (!allowed) {
        throw new AppError(
          "CONFLICT",
          `This session still has an unpaid balance. Settle the bill first, or ask a manager to close it.`,
        );
      }
    }

    // Unsettled orders are served-and-closed so they stay on the historical bill.
    if (existing.orders.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: existing.orders.map((order) => order.id) } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
    for (const bill of existing.bills) {
      if (bill.status === "OPEN") {
        const settled = bill.paidPoisa >= bill.totalPoisa;
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            status: settled ? "SETTLED" : "FINALIZED",
            finalizedAt: bill.finalizedAt ?? new Date(),
            settledAt: settled ? (bill.settledAt ?? new Date()) : bill.settledAt,
          },
        });
        // The visit is over, so the orders on this bill are never going to be paid
        // separately; their money state has to match the bill it just became.
        await tx.order.updateMany({
          where: { bills: { some: { billId: bill.id } } },
          data: { paymentStatus: derivePaymentStatus({ totalPoisa: bill.totalPoisa, paidPoisa: bill.paidPoisa }) },
        });
      }
    }

    const closed = await tx.tableSession.update({
      where: { id: sessionId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedByUserId: actor.userId,
        closeReason: input.reason,
        notes: input.note ? `${existing.notes ?? ""} ${input.note}`.trim() : existing.notes,
      },
    });

    const stillActive = await tx.tableSession.count({ where: { tableId: closed.tableId, status: "ACTIVE" } });
    if (stillActive === 0) {
      await tx.restaurantTable.update({
        where: { id: closed.tableId },
        data: {
          status:
            !existing.table.isEnabled || existing.table.status === "DISABLED"
              ? "DISABLED"
              : input.reason === "SETTLED" || input.reason === "MANUAL"
                ? "CLEANING"
                : input.reason === "NO_PAYMENT"
                  ? "CLEANING"
                  : "AVAILABLE",
        },
      });
    }
    return closed;
  });

  await writeAudit({
    actorUserId: actor.userId,
    action: "session.close",
    entityType: "TableSession",
    entityId: session.id,
    after: { reason: input.reason, note: input.note },
    meta: { role: actor.role, rounding: settings.roundingStepPoisa },
    ip: actor.ip,
  });
  return session;
}

/**
 * Moving a party between tables. The open orders follow the guests, the old
 * session closes as transferred and the target table takes over the visit.
 */
export async function transferSession(
  input: { fromTableId: string; toTableId: string; reason?: string },
  actor: { userId: string; ip?: string },
) {
  if (input.fromTableId === input.toTableId) throw new AppError("VALIDATION", "Choose a different destination table.");
  const result = await prisma.$transaction(async (tx) => {
    // Lock in a fixed order so two opposite transfers cannot deadlock.
    const [first, second] = [input.fromTableId, input.toTableId].sort();
    await tx.$queryRaw`SELECT id FROM restaurant_tables WHERE id IN (${first}, ${second}) FOR UPDATE`;

    const from = await tx.restaurantTable.findUniqueOrThrow({
      where: { id: input.fromTableId },
      include: { sessions: { where: { status: "ACTIVE" }, take: 1 } },
    });
    if (from.sessions.length === 0) throw new AppError("CONFLICT", `Table ${from.label} has no open session.`);
    const source = from.sessions[0]!;

    const to = await tx.restaurantTable.findUniqueOrThrow({
      where: { id: input.toTableId },
      include: { sessions: { where: { status: "ACTIVE" }, take: 1 } },
    });
    if (!to.isEnabled) throw new AppError("TABLE_INACTIVE", `Table ${to.label} is disabled.`);
    if (to.sessions.length > 0) throw new AppError("CONFLICT", `Table ${to.label} is already occupied.`);
    if (to.capacity < source.guestCount) {
      throw new AppError("CONFLICT", `Table ${to.label} seats ${to.capacity}; the party is ${source.guestCount}.`);
    }

    const target = await tx.tableSession.create({
      data: {
        code: `${to.label}-${randomShortCode(4)}`,
        tableId: to.id,
        guestCount: source.guestCount,
        reservationId: source.reservationId,
        openedByUserId: actor.userId,
        notes: `Transferred from ${from.label}. ${source.notes ?? ""}`.trim(),
      },
    });

    await tx.order.updateMany({ where: { sessionId: source.id }, data: { sessionId: target.id, tableId: to.id } });
    await tx.tableSessionGuest.updateMany({ where: { sessionId: source.id }, data: { sessionId: target.id } });

    // A partially raised bill travels with the guests; anything settled stays put.
    const openBill = await tx.bill.findFirst({ where: { sessionId: source.id, status: "OPEN" } });
    if (openBill) {
      await tx.bill.update({ where: { id: openBill.id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: "Table transferred" } });
      await writeAudit({ db: tx, actorUserId: actor.userId, action: "bill.void", entityType: "Bill", entityId: openBill.id, meta: { reason: "transfer" } });
    }

    await tx.tableSession.update({
      where: { id: source.id },
      data: { status: "CLOSED", closedAt: new Date(), closedByUserId: actor.userId, closeReason: "TRANSFERRED" },
    });
    await tx.restaurantTable.update({ where: { id: to.id }, data: { status: "OCCUPIED" } });
    await tx.restaurantTable.update({ where: { id: from.id }, data: { status: "CLEANING" } });

    return { source, target, fromLabel: from.label, toLabel: to.label };
  });

  await writeAudit({
    actorUserId: actor.userId,
    action: "session.transfer",
    entityType: "TableSession",
    entityId: result.target.id,
    meta: { from: result.fromLabel, to: result.toLabel, reason: input.reason },
    ip: actor.ip,
  });
  return result.target;
}

export async function getSessionForGuest(participantToken: string, client: Db = prisma) {
  const participant = await client.tableSessionGuest.findUnique({
    where: { participantToken },
    include: {
      session: {
        include: {
          table: true,
          guests: true,
          orders: { orderBy: { createdAt: "asc" }, include: { items: { orderBy: { createdAt: "asc" } } } },
          bills: { where: { status: { in: ["OPEN", "FINALIZED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!participant) throw new AppError("NOT_FOUND", "This ordering link is no longer valid.");
  if (participant.session.status !== "ACTIVE") throw new AppError("SESSION_CLOSED", "This table's session has been closed. Please ask staff for a new code.");
  return participant;
}
