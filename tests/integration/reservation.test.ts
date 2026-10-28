import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CANONICAL_SETTINGS,
  CLOSED_SLOT,
  LATER_SLOT,
  OPEN_SLOT,
  applyCanonicalSettings,
  cleanupFixtures,
  createFixtureTable,
  dateKeyAhead,
  expectDatabaseUnderTest,
  expectRefusal,
  findResidue,
  fixtureStaffActor,
  prisma,
  releaseBookingTables,
  runTag,
  track,
  uniqueEmail,
  uniquePhone,
} from "./support";
import {
  assignTables,
  cancelReservation,
  confirmReservation,
  createReservation,
  getAvailability,
} from "@/server/services/reservation.service";
import { wallToUtc } from "@/lib/time";
import type { ReservationCreateInput } from "@/server/validation/reservation";

/**
 * Reservation booking rules, against the real database.
 *
 * The fixture table used by the overlap tests is created *disabled*. `chooseTables()`
 * only auto-assigns enabled tables, and integration files run in parallel workers
 * against this one shared database, so a disabled table is a booking surface no
 * other worker can collide with. `assignTables()` does not gate on `isEnabled` — it
 * checks overlap and seats — which is what makes the isolation possible without
 * faking any product behaviour.
 *
 * Each scenario uses its own future date: the busy-window maths is scoped to one
 * local day, so separate dates keep scenarios from interfering with each other.
 */

type Actor = { userId: string; role: string };

const [opensAt, closesAt] = [CANONICAL_SETTINGS.openingHours[0].opens, CANONICAL_SETTINGS.openingHours[0].closes];
const timeZone = CANONICAL_SETTINGS.timezone;

let ownTable: Awaited<ReturnType<typeof createFixtureTable>>;
/**
 * An enabled table so that `createReservation()`'s auto-assignment always has
 * somewhere to land, whatever other parallel workers have booked.
 */
let houseTable: Awaited<ReturnType<typeof createFixtureTable>>;
let actor: Actor;

function booking(overrides: Partial<ReservationCreateInput> & Pick<ReservationCreateInput, "dateKey">): ReservationCreateInput {
  return {
    customerName: `Party ${runTag}`,
    phone: uniquePhone(),
    email: uniqueEmail("guest"),
    partySize: 2,
    time: OPEN_SLOT,
    specialRequests: "Near the window",
    policyAccepted: true,
    ...overrides,
  };
}

beforeAll(async () => {
  expect(await expectDatabaseUnderTest()).toBeTruthy();
  await applyCanonicalSettings();
  actor = await fixtureStaffActor();
  ownTable = await createFixtureTable(4, { section: "IT overlap", enabled: false });
  houseTable = await createFixtureTable(20, { section: "IT floor" });
});

afterAll(async () => {
  await cleanupFixtures();
  expect(await findResidue()).toEqual([]);
});

describe("reservation booking window", () => {
  it("refuses a seating time outside opening hours", async () => {
    const dateKey = await dateKeyAhead(3);

    const error = await expectRefusal(
      () => createReservation(booking({ dateKey, time: CLOSED_SLOT }), { createdVia: "WEB" }),
      "VALIDATION",
      "closed-hours booking",
    );

    expect(error.status).toBe(400);
    expect(error.message).toMatch(/closed at that time/i);
    expect(
      await prisma.reservation.count({
        where: { customerName: { contains: runTag }, startsAt: wallToUtc(dateKey, CLOSED_SLOT, timeZone) },
      }),
    ).toBe(0);
  });

  it("refuses a seating time inside the pre-arrival cutoff", async () => {
    const yesterday = await dateKeyAhead(-1);

    const error = await expectRefusal(
      () => createReservation(booking({ dateKey: yesterday }), { createdVia: "WEB" }),
      "VALIDATION",
      "cutoff booking",
    );

    // Same status as the closed-hours refusal, so the wording is what proves the
    // cutoff branch fired rather than the opening-hours one.
    expect(error.message).toMatch(/bookings close 60 minutes before/i);
  });

  it("refuses to publish availability for a date that has passed or is too far ahead", async () => {
    const [yesterday, farAhead] = [await dateKeyAhead(-1), await dateKeyAhead(61)];

    await expectRefusal(() => getAvailability(yesterday, 2), "VALIDATION", "past date");
    const far = await expectRefusal(() => getAvailability(farAhead, 2), "VALIDATION", "beyond the advance window");
    expect(far.message).toMatch(/60 days ahead/);
  });

  it("offers open-hour slots on a grid that keeps the whole seating window inside service", async () => {
    const availability = await getAvailability(await dateKeyAhead(3), 2);

    const times = availability.slots.map((slot) => slot.time);
    expect(availability.closed).toBe(false);
    expect(times.length).toBeGreaterThan(0);
    expect(times).toContain(OPEN_SLOT);
    expect(times).toContain(LATER_SLOT);
    expect(Math.min(...times.map(toMinutes))).toBeGreaterThanOrEqual(toMinutes(opensAt));
    // A 90-minute sitting must finish before closing, so the last start is 21:30.
    expect(Math.max(...times.map(toMinutes))).toBeLessThanOrEqual(toMinutes(closesAt) - CANONICAL_SETTINGS.reservationDurationMinutes);
  });

  it("marks every slot unavailable once the party outgrows the whole room", async () => {
    const dateKey = await dateKeyAhead(4);
    const availability = await getAvailability(dateKey, 10_000);

    // The room's seats are whatever this run's fixture table plus anything another
    // worker has registered; the test only needs a figure the refusal is measured
    // against, so it reads it from the service rather than assuming a number.
    expect(availability.maxPartySize).toBeGreaterThanOrEqual(houseTable.capacity);
    expect(availability.slots.length).toBeGreaterThan(0);
    for (const slot of availability.slots) {
      expect(slot.available).toBe(false);
      const seatsLeft = Number(/Only (\d+) seats left/.exec(slot.reason ?? "")?.[1] ?? 0);
      expect(slot.reason).toMatch(/^(Fully booked|Only \d+ seats left)$/);
      expect(seatsLeft).toBeLessThanOrEqual(availability.maxPartySize);
    }
  });
});

describe("reservation table conflicts", () => {
  it("books a table for an open slot and records one assignment row per table", async () => {
    const dateKey = await dateKeyAhead(5);

    const reservation = await createReservation(booking({ dateKey }), { createdVia: "WEB" });
    track("reservations", reservation.id);

    expect(reservation.status).toBe("PENDING");
    expect(reservation.code).toMatch(/^BK-\d{4}-\d{4}$/);
    expect(reservation.durationMinutes).toBe(CANONICAL_SETTINGS.reservationDurationMinutes);
    expect(reservation.startsAt).toEqual(wallToUtc(dateKey, OPEN_SLOT, timeZone));

    const assignments = await prisma.reservationTableAssignment.findMany({ where: { reservationId: reservation.id } });
    expect(assignments.length).toBeGreaterThan(0);
    expect(new Set(assignments.map((row) => row.tableId)).size).toBe(assignments.length);

    await releaseBookingTables(reservation.id);
  });

  it("refuses to place a second party on a table already booked for an overlapping window", async () => {
    const dateKey = await dateKeyAhead(6);

    const first = await createReservation(booking({ dateKey }), { createdVia: "WEB" });
    track("reservations", first.id);
    await assignTables(first.id, [ownTable.id], actor);
    await releaseBookingTables(first.id);

    const second = await createReservation(booking({ dateKey, customerName: `Second ${runTag}` }), { createdVia: "WEB" });
    track("reservations", second.id);

    const error = await expectRefusal(() => assignTables(second.id, [ownTable.id], actor), "CONFLICT", "overlapping table");
    expect(error.status).toBe(409);
    expect(error.message).toContain(ownTable.label);
    // The refused booking keeps whatever the availability check gave it, and the
    // table is still committed to exactly one party at that instant.
    expect(await committedAt(dateKey, OPEN_SLOT)).toEqual([{ reservationId: first.id, seatsUsed: ownTable.capacity }]);

    await releaseBookingTables(second.id);
  });

  it("refuses a party bigger than the seats offered by the chosen tables", async () => {
    const dateKey = await dateKeyAhead(7);

    const reservation = await createReservation(booking({ dateKey, partySize: 5, customerName: `Big ${runTag}` }), { createdVia: "WEB" });
    track("reservations", reservation.id);

    const error = await expectRefusal(() => assignTables(reservation.id, [ownTable.id], actor), "CONFLICT", "over-capacity tables");
    expect(error.message).toMatch(/seat 4; the party is 5/);

    await releaseBookingTables(reservation.id);
  });

  it("seats a later party at the same table once the buffer has passed", async () => {
    const dateKey = await dateKeyAhead(8);

    const earlier = await createReservation(booking({ dateKey }), { createdVia: "WEB" });
    track("reservations", earlier.id);
    await assignTables(earlier.id, [ownTable.id], actor);
    await releaseBookingTables(earlier.id);

    const later = await createReservation(booking({ dateKey, time: LATER_SLOT, customerName: `Later ${runTag}` }), { createdVia: "WEB" });
    track("reservations", later.id);

    const assigned = await assignTables(later.id, [ownTable.id], actor);
    await releaseBookingTables(later.id);

    const ownRows = assigned.tables.filter((row) => row.tableId === ownTable.id);
    expect(ownRows).toHaveLength(1);
    // An explicit assignment records the seats it commits.
    expect(ownRows[0]?.seatsUsed).toBe(ownTable.capacity);
  });

  it("ignores a booking's own rows when re-checking overlap", async () => {
    const dateKey = await dateKeyAhead(9);

    const held = await createReservation(booking({ dateKey }), { createdVia: "WEB" });
    track("reservations", held.id);
    await assignTables(held.id, [ownTable.id], actor);
    await releaseBookingTables(held.id);

    const overlapping = await createReservation(booking({ dateKey, customerName: `Overlap ${runTag}` }), { createdVia: "WEB" });
    track("reservations", overlapping.id);
    await expectRefusal(() => assignTables(overlapping.id, [ownTable.id], actor), "CONFLICT", "another party on the table");
    await releaseBookingTables(overlapping.id);

    // Re-assigning the same booking to the same table is allowed, which is what
    // proves the refusal above is about the *other* party, not about the table.
    const reassigned = await assignTables(held.id, [ownTable.id], actor);
    expect(reassigned.tables.map((row) => row.tableId)).toEqual([ownTable.id]);
  });

  it("frees the slot for the same table once the booking is cancelled", async () => {
    const dateKey = await dateKeyAhead(10);

    const held = await createReservation(booking({ dateKey }), { createdVia: "WEB" });
    track("reservations", held.id);
    await assignTables(held.id, [ownTable.id], actor);
    await releaseBookingTables(held.id);

    const waiting = await createReservation(booking({ dateKey, customerName: `Waiting ${runTag}` }), { createdVia: "WEB" });
    track("reservations", waiting.id);
    await expectRefusal(() => assignTables(waiting.id, [ownTable.id], actor), "CONFLICT", "table still held");

    const cancelled = await cancelReservation(held.id, "Guest called to cancel", { userId: actor.userId, role: actor.role });
    expect(cancelled.status).toBe("CANCELLED");

    const assigned = await assignTables(waiting.id, [ownTable.id], actor);
    expect(assigned.tables.map((row) => row.tableId)).toEqual([ownTable.id]);
    // The cancelled booking keeps its assignment row on the record, but it stops
    // committing the table: one blocking row remains, and it belongs to the party
    // that was refused a moment ago.
    expect(await committedAt(dateKey, OPEN_SLOT)).toEqual([{ reservationId: waiting.id, seatsUsed: ownTable.capacity }]);

    await releaseBookingTables(held.id);
  });

  it("refuses to cancel a booking without the link it was made with", async () => {
    const reservation = await createReservation(booking({ dateKey: await dateKeyAhead(11) }), { createdVia: "WEB" });
    track("reservations", reservation.id);

    await expectRefusal(
      () => cancelReservation(reservation.id, "Changed plans", { userId: null, guestToken: "not-the-token" }),
      "FORBIDDEN",
      "cancel with the wrong guest token",
    );
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("PENDING");

    const cancelled = await cancelReservation(reservation.id, "Changed plans", { userId: null, guestToken: reservation.publicToken });
    expect(cancelled.status).toBe("CANCELLED");
    await releaseBookingTables(reservation.id);

    const again = await expectRefusal(
      () => cancelReservation(reservation.id, "Twice", { userId: null, guestToken: reservation.publicToken }),
      "INVALID_TRANSITION",
      "cancelling a cancelled booking",
    );
    expect(again.status).toBe(400);

    // A terminal booking cannot be confirmed either way.
    await expectRefusal(
      () => confirmReservation(reservation.id, { userId: actor.userId, role: actor.role }),
      "INVALID_TRANSITION",
      "confirm a cancelled booking",
    );
  });
});

/** "09:30" → 570, so wall-clock labels can be compared numerically. */
function toMinutes(label: string): number {
  const [hours, minutes] = label.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Assignments that still commit our table at one instant. Scoped by the booking
 * instant and by the statuses the availability maths treats as blocking, because
 * the file's own bookings pile up on this table across dates and a cancelled row
 * stays on the record on purpose.
 */
function committedAt(dateKey: string, time: string) {
  return prisma.reservationTableAssignment.findMany({
    where: {
      tableId: ownTable.id,
      reservation: { status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }, startsAt: wallToUtc(dateKey, time, timeZone) },
    },
    select: { reservationId: true, seatsUsed: true },
  });
}
