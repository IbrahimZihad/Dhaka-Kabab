import { prisma, type Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { randomToken } from "@/lib/ids";
import { getSettings } from "@/server/services/settings.service";
import { nextDocumentNumber } from "@/server/services/counters";
import { openSession } from "@/server/services/table.service";
import { queueNotification } from "@/server/services/notification.service";
import {
  isOpenAt,
  parseOpeningHours,
  slotStartsForDay,
  wallToUtc,
  addMinutes,
  zonedParts,
  dayRange,
  minutesBetween,
  formatInZone,
  describeOpeningHours,
} from "@/lib/time";
import { phoneSearchDigits } from "@/server/validation/common";
import type { ReservationCreateInput } from "@/server/validation/reservation";
import type { ReservationStatus } from "@prisma/client";

/**
 * Reservations. Availability is computed from table capacity minus the seats
 * already committed to overlapping bookings, and is re-checked inside a locked
 * transaction at confirmation time.
 */

const BLOCKING_STATUSES: ReservationStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN"];

const RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canMoveReservation(from: ReservationStatus, to: ReservationStatus): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to);
}

export type BusyInterval = { startsAt: Date; endsAt: Date; reservationId: string; code: string };

/**
 * Booked windows per table for one local day, including the buffer that must
 * sit between two sittings at the same table.
 */
async function busyTablesForDay(
  dateKey: string,
  timeZone: string,
  bufferMinutes: number,
  client: Db = prisma,
): Promise<Map<string, BusyInterval[]>> {
  const { start, end } = dayRange(dateKey, timeZone);
  const assignments = await client.reservationTableAssignment.findMany({
    where: {
      reservation: { startsAt: { gte: addMinutes(start, -12 * 60), lt: addMinutes(end, 12 * 60) }, status: { in: BLOCKING_STATUSES } },
    },
    include: { reservation: { select: { id: true, code: true, startsAt: true, durationMinutes: true, status: true } } },
  });

  const map = new Map<string, BusyInterval[]>();
  for (const assignment of assignments) {
    const reservation = assignment.reservation;
    const list = map.get(assignment.tableId) ?? [];
    list.push({
      startsAt: addMinutes(reservation.startsAt, -bufferMinutes),
      endsAt: addMinutes(reservation.startsAt, reservation.durationMinutes + bufferMinutes),
      reservationId: reservation.id,
      code: reservation.code,
    });
    map.set(assignment.tableId, list);
  }
  return map;
}

function isTableFree(busy: BusyInterval[] | undefined, from: Date, to: Date): boolean {
  if (!busy) return true;
  return !busy.some((interval) => interval.startsAt < to && interval.endsAt > from);
}

/**
 * Tables that can seat a party at a given instant. A single table is preferred;
 * only when nothing large enough is free do we combine tables, and then we take
 * the fewest, smallest-fitting combination so big tables stay available for big
 * parties.
 */
export async function chooseTables(
  partySize: number,
  startsAt: Date,
  durationMinutes: number,
  bufferMinutes: number,
  options: { dateKey: string; timeZone: string; excludeReservationId?: string; client?: Db } = {
    dateKey: zonedParts(startsAt, "Asia/Dhaka").dateKey,
    timeZone: "Asia/Dhaka",
  },
): Promise<{ tableIds: string[]; seats: number; combined: boolean }> {
  const client = options.client ?? prisma;
  const to = addMinutes(startsAt, durationMinutes);
  const tables = await client.restaurantTable.findMany({
    where: { isEnabled: true, status: { notIn: ["DISABLED", "CLEANING"] } },
    orderBy: [{ capacity: "asc" }, { number: "asc" }],
  });
  const busy = await busyTablesForDay(options.dateKey, options.timeZone, bufferMinutes, client);
  const free = tables.filter((table) => isTableFree(busy.get(table.id), startsAt, to));

  const single = free.find((table) => table.capacity >= partySize);
  if (single) return { tableIds: [single.id], seats: single.capacity, combined: false };

  // Combine from the largest free tables downward; stop as soon as seats cover.
  const bySize = [...free].sort((a, b) => b.capacity - a.capacity);
  const chosen: typeof bySize = [];
  let seats = 0;
  for (const table of bySize) {
    chosen.push(table);
    seats += table.capacity;
    if (seats >= partySize) break;
  }
  if (seats < partySize) {
    throw new AppError(
      "CONFLICT",
      `We cannot seat ${partySize} guests at that time. Please choose another time or call us to arrange the room.`,
    );
  }
  return { tableIds: chosen.map((table) => table.id), seats, combined: chosen.length > 1 };
}

export type SlotAvailability = {
  dateKey: string;
  slots: { time: string; available: boolean; reason?: string }[];
  closed: boolean;
  maxPartySize: number;
};

/**
 * Public availability. A slot is offered only when the backend has confirmed
 * there is a table that can take the party for the full seating window.
 */
export async function getAvailability(
  dateKey: string,
  partySize: number,
  client: Db = prisma,
): Promise<SlotAvailability> {
  const settings = await getSettings(client);
  const timeZone = settings.timezone;
  const rules = parseOpeningHours(settings.openingHours);
  const now = new Date();

  const target = wallToUtc(dateKey, "12:00", timeZone);
  const targetDay = zonedParts(target, timeZone).dateKey;
  if (targetDay !== dateKey) throw new AppError("VALIDATION", "Invalid date.");

  const daysAhead = Math.floor((target.getTime() - wallToUtc(zonedParts(now, timeZone).dateKey, "00:00", timeZone).getTime()) / 86_400_000);
  if (daysAhead < 0) throw new AppError("VALIDATION", "That date has already passed.");
  if (daysAhead > settings.reservationMaxDaysAhead) {
    throw new AppError("VALIDATION", `We take bookings up to ${settings.reservationMaxDaysAhead} days ahead.`);
  }

  const times = slotStartsForDay(dateKey, rules, {
    slotMinutes: settings.reservationSlotMinutes,
    durationMinutes: settings.reservationDurationMinutes,
    cutoffMinutes: settings.reservationCutoffMinutes,
    now,
    timeZone,
  });

  const busy = await busyTablesForDay(dateKey, timeZone, settings.reservationBufferMinutes, client);
  // Seats on offer are the seats chooseTables is willing to allocate. A table sent to
  // CLEANING is used by that allocator but not counted here, so the grid promises a
  // party the restaurant then refuses at the same slot.
  const tables = await client.restaurantTable.findMany({
    where: { isEnabled: true, status: { notIn: ["DISABLED", "CLEANING"] } },
    select: { id: true, capacity: true },
  });
  const maxPartySize = tables.reduce((total, table) => total + table.capacity, 0);

  const slots = await Promise.all(
    times.map(async (time) => {
      const startsAt = wallToUtc(dateKey, time, timeZone);
      const endsAt = addMinutes(startsAt, settings.reservationDurationMinutes);
      const freeSeats = tables
        .filter((table) => isTableFree(busy.get(table.id), startsAt, endsAt))
        .reduce((total, table) => total + table.capacity, 0);
      return {
        time,
        available: freeSeats >= partySize,
        reason: freeSeats >= partySize ? undefined : freeSeats === 0 ? "Fully booked" : `Only ${freeSeats} seats left`,
      };
    }),
  );

  return { dateKey, slots, closed: times.length === 0, maxPartySize };
}

export async function createReservation(input: ReservationCreateInput, context: { ip?: string; createdVia?: string; customerId?: string | null } = {}) {
  const settings = await getSettings();
  const timeZone = settings.timezone;
  const rules = parseOpeningHours(settings.openingHours);

  const startsAt = wallToUtc(input.dateKey, input.time, timeZone);
  if (Number.isNaN(startsAt.getTime())) throw new AppError("VALIDATION", "That date and time could not be read.");

  if (!isOpenAt(startsAt, rules, timeZone)) {
    throw new AppError("VALIDATION", "We are closed at that time. Please choose an open slot.");
  }
  const minutesToArrival = minutesBetween(new Date(), startsAt);
  if (minutesToArrival < settings.reservationCutoffMinutes) {
    throw new AppError(
      "VALIDATION",
      `Bookings close ${settings.reservationCutoffMinutes} minutes before seating time. Please call us instead.`,
    );
  }
  return prisma.$transaction(
    async (tx) => {
      // One lock per calendar day serialises competing bookings without a
      // table-level scan; it is released when the transaction ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reservation:${input.dateKey}`}))`;

      const { tableIds, seats, combined } = await chooseTables(
        input.partySize,
        startsAt,
        settings.reservationDurationMinutes,
        settings.reservationBufferMinutes,
        { dateKey: input.dateKey, timeZone, client: tx },
      );

      const code = await nextDocumentNumber("reservation", { timeZone, client: tx });
      const reservation = await tx.reservation.create({
        data: {
          code,
          publicToken: randomToken(12),
          customerName: input.customerName,
          phone: input.phone,
          email: input.email ?? null,
          partySize: input.partySize,
          startsAt,
          durationMinutes: settings.reservationDurationMinutes,
          status: "PENDING",
          specialRequests: input.specialRequests ?? null,
          policyAccepted: input.policyAccepted,
          customerId: context.customerId ?? null,
          createdVia: context.createdVia ?? "WEB",
          tables: {
            create: tableIds.map((tableId) => ({ tableId, seatsUsed: 0 })),
          },
        },
        include: { tables: { include: { table: { select: { label: true, capacity: true } } } } },
      });

      await writeAudit({
        actorUserId: context.customerId ?? null,
        actorType: context.customerId ? "USER" : "GUEST",
        actorLabel: input.customerName,
        action: "reservation.create",
        entityType: "Reservation",
        entityId: reservation.id,
        after: { code, partySize: input.partySize, startsAt, tables: tableIds.length, combined, seats },
        ip: context.ip,
      });

      await queueNotification({
        type: "RESERVATION_CREATED",
        subject: `New booking ${code} — ${input.customerName}, ${input.partySize} guests`,
        bodyText: `${input.customerName} requested ${input.partySize} guests on ${input.dateKey} at ${input.time}. Tables: ${reservation.tables.map((assignment) => assignment.table.label).join(", ")}.`,
        relatedKind: "Reservation",
        relatedId: reservation.id,
        staffAudience: true,
      });

      return reservation;
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function confirmReservation(id: string, actor: { userId: string; role: string; ip?: string }) {
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: { tables: { include: { table: true } } } });
  if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
  if (!canMoveReservation(reservation.status, "CONFIRMED")) {
    throw new AppError("INVALID_TRANSITION", `A ${reservation.status.toLowerCase()} booking cannot be confirmed.`);
  }
  const confirmed = await prisma.reservation.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
  await writeAudit({ actorUserId: actor.userId, action: "reservation.confirm", entityType: "Reservation", entityId: id, ip: actor.ip });

  const settings = await getSettings();
  const tables = reservation.tables.map((assignment) => assignment.table.label).join(", ");
  await queueNotification({
    type: "RESERVATION_CONFIRMED",
    toEmail: reservation.email ?? undefined,
    toName: reservation.customerName,
    subject: `${settings.name} — table ${reservation.code} is confirmed`,
    bodyText:
      `Your booking ${reservation.code} for ${reservation.partySize} guest${reservation.partySize === 1 ? "" : "s"} is confirmed ` +
      `for ${formatInZone(reservation.startsAt, settings.timezone)} (${tables || "table to be assigned on arrival"}).\n` +
      `Please arrive within ${settings.reservationCutoffMinutes >= 15 ? 15 : settings.reservationCutoffMinutes} minutes of the booking time.\n` +
      `${settings.name}, ${[settings.addressLine1, settings.city].filter(Boolean).join(", ")}`,
    relatedKind: "Reservation",
    relatedId: reservation.id,
  });
  return confirmed;
}

export async function cancelReservation(
  id: string,
  reason: string,
  actor: { userId: string | null; role?: string; ip?: string; guestToken?: string },
) {
  const reservation = await prisma.reservation.findUnique({ where: { id } });
  if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");

  // A caller with no staff account must prove they hold the booking's own link.
  // Without this check any reservation id would be cancellable by anyone.
  if (!actor.userId) {
    if (!actor.guestToken || actor.guestToken !== reservation.publicToken) {
      throw new AppError("FORBIDDEN", "This booking can only be changed from the confirmation link it was made with.");
    }
  }

  if (!canMoveReservation(reservation.status, "CANCELLED")) {
    throw new AppError("INVALID_TRANSITION", `This booking is already ${reservation.status.toLowerCase()} and cannot be cancelled.`);
  }
  const cancelled = await prisma.reservation.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
  });
  await writeAudit({
    actorUserId: actor.userId,
    actorType: actor.userId ? "USER" : "GUEST",
    action: "reservation.cancel",
    entityType: "Reservation",
    entityId: id,
    meta: { reason },
    ip: actor.ip,
  });
  await queueNotification({
    type: "RESERVATION_CANCELLED",
    toEmail: reservation.email ?? undefined,
    toName: reservation.customerName,
    subject: `Booking ${reservation.code} cancelled`,
    bodyText: `Your booking for ${reservation.partySize} guests has been cancelled.`,
    relatedKind: "Reservation",
    relatedId: reservation.id,
  });
  return cancelled;
}

export async function markNoShow(id: string, actor: { userId: string; role: string; ip?: string }) {
  const reservation = await prisma.reservation.findUnique({ where: { id } });
  if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
  if (!canMoveReservation(reservation.status, "NO_SHOW")) {
    throw new AppError("INVALID_TRANSITION", `This booking is already ${reservation.status.toLowerCase()}.`);
  }
  const updated = await prisma.reservation.update({ where: { id }, data: { status: "NO_SHOW", noShowAt: new Date() } });
  await writeAudit({ actorUserId: actor.userId, action: "reservation.no_show", entityType: "Reservation", entityId: id, ip: actor.ip });
  return updated;
}

/** Checking a party in opens the table session, so orders and the bill line up. */
export async function checkInReservation(
  id: string,
  actor: { userId: string; role: string; ip?: string },
) {
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: { tables: { include: { table: true } } } });
  if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
  if (reservation.status !== "CONFIRMED" && reservation.status !== "PENDING") {
    throw new AppError("INVALID_TRANSITION", `A ${reservation.status.toLowerCase()} booking cannot be checked in.`);
  }
  const primary = reservation.tables[0];
  if (!primary) throw new AppError("CONFLICT", "No table has been assigned to this booking yet.");
  if (primary.table.status === "OCCUPIED") {
    throw new AppError("CONFLICT", `Table ${primary.table.label} is occupied. Free it or reassign the booking first.`);
  }

  const session = await openSession(
    { tableId: primary.tableId, guestCount: reservation.partySize, reservationId: reservation.id },
    { userId: actor.userId, ip: actor.ip },
  );
  const updated = await prisma.reservation.update({
    where: { id },
    data: { status: "CHECKED_IN", checkedInAt: new Date() },
  });
  await writeAudit({ actorUserId: actor.userId, action: "reservation.check_in", entityType: "Reservation", entityId: id, after: { sessionId: session.id }, ip: actor.ip });
  return { reservation: updated, session };
}

export async function completeReservation(id: string, actor: { userId: string; role: string; ip?: string }) {
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: { sessions: { where: { status: "ACTIVE" } } } });
  if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
  if (!canMoveReservation(reservation.status, "COMPLETED")) {
    throw new AppError("INVALID_TRANSITION", `This booking is already ${reservation.status.toLowerCase()}.`);
  }
  if (reservation.sessions.length > 0) {
    throw new AppError("CONFLICT", "Close the table session first so the bill is settled.");
  }
  const updated = await prisma.reservation.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
  await writeAudit({ actorUserId: actor.userId, action: "reservation.complete", entityType: "Reservation", entityId: id, ip: actor.ip });
  return updated;
}

/** Moving a booking to another time or party size, with a fresh availability check. */
export async function rescheduleReservation(
  id: string,
  input: { dateKey?: string; time?: string; partySize?: number },
  actor: { userId: string; role: string; ip?: string },
) {
  const settings = await getSettings();
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: { tables: true } });
  if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
  if (!["PENDING", "CONFIRMED"].includes(reservation.status)) {
    throw new AppError("INVALID_TRANSITION", `A ${reservation.status.toLowerCase()} booking cannot be rescheduled.`);
  }

  const dateKey = input.dateKey ?? zonedParts(reservation.startsAt, settings.timezone).dateKey;
  const time = input.time ?? zonedParts(reservation.startsAt, settings.timezone).time;
  const partySize = input.partySize ?? reservation.partySize;
  const startsAt = wallToUtc(dateKey, time, settings.timezone);

  if (!isOpenAt(startsAt, parseOpeningHours(settings.openingHours), settings.timezone)) {
    throw new AppError("VALIDATION", "We are closed at that time.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reservation:${dateKey}`}))`;
    // Drop this booking's own claims before asking what is free.
    await tx.reservationTableAssignment.deleteMany({ where: { reservationId: id } });
    const { tableIds } = await chooseTables(partySize, startsAt, settings.reservationDurationMinutes, settings.reservationBufferMinutes, {
      dateKey,
      timeZone: settings.timezone,
      client: tx,
    });
    const updated = await tx.reservation.update({
      where: { id },
      data: {
        startsAt,
        partySize,
        durationMinutes: settings.reservationDurationMinutes,
        tables: { create: tableIds.map((tableId) => ({ tableId, seatsUsed: 0 })) },
      },
      include: { tables: { include: { table: { select: { label: true } } } } },
    });
    await writeAudit({
      actorUserId: actor.userId,
      action: "reservation.reschedule",
      entityType: "Reservation",
      entityId: id,
      before: { startsAt: reservation.startsAt, partySize: reservation.partySize, tables: reservation.tables.length },
      after: { startsAt: updated.startsAt, partySize: updated.partySize, tables: updated.tables.length },
      ip: actor.ip,
    });
    return updated;
  });
}

export async function assignTables(
  id: string,
  tableIds: string[],
  actor: { userId: string; role: string; ip?: string },
) {
  const settings = await getSettings();
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: { tables: { include: { table: { select: { label: true } } } } },
  });
  if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");
  if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(reservation.status)) {
    throw new AppError("INVALID_TRANSITION", `This booking is ${reservation.status.toLowerCase()}.`);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reservation:${zonedParts(reservation.startsAt, settings.timezone).dateKey}`}))`;
    const busy = await busyTablesForDay(zonedParts(reservation.startsAt, settings.timezone).dateKey, settings.timezone, settings.reservationBufferMinutes, tx);
    const from = reservation.startsAt;
    const to = addMinutes(from, reservation.durationMinutes);

    const tables = await tx.restaurantTable.findMany({ where: { id: { in: tableIds } } });
    if (tables.length !== tableIds.length) throw new AppError("NOT_FOUND", "One of the chosen tables does not exist.");
    const taken = tables.filter(
      (table) => !isTableFree(
        (busy.get(table.id) ?? []).filter((interval) => interval.reservationId !== id),
        from,
        to,
      ),
    );
    if (taken.length > 0) {
      throw new AppError("CONFLICT", `Table ${taken.map((table) => table.label).join(", ")} is already booked for an overlapping time.`);
    }
    const seats = tables.reduce((total, table) => total + table.capacity, 0);
    if (seats < reservation.partySize) {
      throw new AppError("CONFLICT", `Those tables seat ${seats}; the party is ${reservation.partySize}.`);
    }

    await tx.reservationTableAssignment.deleteMany({ where: { reservationId: id } });
    for (const table of tables) {
      await tx.reservationTableAssignment.create({ data: { reservationId: id, tableId: table.id, seatsUsed: table.capacity } });
    }
    const updated = await tx.reservation.findUniqueOrThrow({
      where: { id },
      include: { tables: { include: { table: { select: { label: true } } } } },
    });
    await writeAudit({
      db: tx,
      actorUserId: actor.userId,
      action: "reservation.assign_tables",
      entityType: "Reservation",
      entityId: id,
      before: { tables: reservation.tables.map((assignment) => assignment.table.label) },
      after: { tables: updated.tables.map((assignment) => assignment.table.label) },
      ip: actor.ip,
    });
    return updated;
  });
}

export async function getReservationByToken(publicToken: string, client: Db = prisma) {
  const reservation = await client.reservation.findUnique({
    where: { publicToken },
    include: { tables: { include: { table: { select: { label: true, capacity: true } } } }, sessions: { orderBy: { openedAt: "desc" }, take: 1 } },
  });
  if (!reservation) throw new AppError("NOT_FOUND", "We could not find that booking.");
  return reservation;
}

export async function listReservations(
  filters: { from?: Date; to?: Date; status?: ReservationStatus; search?: string },
  pagination: { skip: number; take: number },
) {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.startsAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) };
  }
  if (filters.search) {
    const digits = phoneSearchDigits(filters.search);
    where.OR = [
      { code: { contains: filters.search, mode: "insensitive" as const } },
      { customerName: { contains: filters.search, mode: "insensitive" as const } },
      // Only search the phone once there are actual digits: an empty "contains"
      // matches every stored number and would return the whole list.
      ...(digits.length >= 3 ? [{ phone: { contains: digits, mode: "insensitive" as const } }] : []),
    ];
  }
  const [reservations, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      orderBy: { startsAt: "asc" },
      skip: pagination.skip,
      take: pagination.take,
      include: { tables: { include: { table: { select: { label: true } } } } },
    }),
    prisma.reservation.count({ where }),
  ]);
  return { reservations, total };
}

/**
 * Tables with a confirmed booking in the next hour show as RESERVED, unless they
 * are already occupied by a live session. Called when the floor is rendered.
 */
export async function refreshReservedStatuses(withinMinutes = 60, client: Db = prisma) {
  const now = new Date();
  const horizon = addMinutes(now, withinMinutes);
  const upcoming = await client.reservationTableAssignment.findMany({
    where: {
      reservation: { status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: now, lte: horizon } },
      table: { isEnabled: true, status: "AVAILABLE" },
    },
    include: { table: { select: { id: true } } },
  });
  if (upcoming.length === 0) return 0;
  const result = await client.restaurantTable.updateMany({
    where: { id: { in: [...new Set(upcoming.map((assignment) => assignment.table.id))] }, status: "AVAILABLE" },
    data: { status: "RESERVED" },
  });
  return result.count;
}

export async function reservationFactsForChat(dateKey?: string, partySize?: number) {
  const settings = await getSettings();
  const availability =
    dateKey && partySize && partySize > 0 ? await getAvailability(dateKey, partySize).catch(() => null) : null;
  return {
    name: settings.name,
    timezone: settings.timezone,
    openingHours: describeOpeningHours(parseOpeningHours(settings.openingHours)),
    policy: {
      slotMinutes: settings.reservationSlotMinutes,
      sittingMinutes: settings.reservationDurationMinutes,
      bufferMinutes: settings.reservationBufferMinutes,
      maxDaysAhead: settings.reservationMaxDaysAhead,
      cutoffMinutes: settings.reservationCutoffMinutes,
      depositPoisa: settings.reservationDepositPoisa,
      requiresPolicyAcceptance: settings.requirePolicyAcceptance,
    },
    todayKey: zonedParts(new Date(), settings.timezone).dateKey,
    availability,
    note: "Availability above comes from getAvailability(). Anything it does not confirm must be reported as unknown, not guessed.",
  };
}
