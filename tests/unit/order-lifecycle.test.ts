import { describe, expect, it } from "vitest";
import type { OrderStatus, ReservationStatus } from "@prisma/client";
import { isTransitionAllowed } from "@/server/services/order.service";
import { canMoveReservation } from "@/server/services/reservation.service";

/**
 * Order + reservation lifecycle. The only pure part of these otherwise DB-heavy
 * services is the transition matrix: `isTransitionAllowed(from, to, role)` and
 * `canMoveReservation(from, to)`. The expected tables below are transcribed from
 * the documented policy, not derived from the source, so a change to either side
 * surfaces as a failure.
 */

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
];

/** Legal forward edges and the cancel branch; COMPLETED and CANCELLED are terminal. */
const EXPECTED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "SERVED", "CANCELLED"],
  PREPARING: ["READY", "SERVED", "CANCELLED"],
  READY: ["SERVED", "COMPLETED", "CANCELLED"],
  SERVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Least-privilege: which target statuses each staff role may drive an order into. */
const EXPECTED_ROLE_TARGETS: Record<string, OrderStatus[]> = {
  OWNER: ["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"],
  MANAGER: ["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"],
  CASHIER: ["CONFIRMED", "SERVED", "COMPLETED", "CANCELLED"],
  KITCHEN: ["PREPARING", "READY"],
  CUSTOMER: [],
};

const STAFF_ROLES = ["OWNER", "MANAGER", "CASHIER", "KITCHEN"] as const;

describe("order transitions", () => {
  it("permits every documented forward step for an authorised role", () => {
    // Each edge is legal and at least one role may drive it; OWNER opens every
    // transition the map allows, so it is the natural witness role.
    expect(isTransitionAllowed("PENDING", "CONFIRMED", "OWNER")).toBe(true);
    expect(isTransitionAllowed("CONFIRMED", "PREPARING", "OWNER")).toBe(true);
    expect(isTransitionAllowed("PREPARING", "READY", "OWNER")).toBe(true);
    expect(isTransitionAllowed("READY", "SERVED", "OWNER")).toBe(true);
    expect(isTransitionAllowed("SERVED", "COMPLETED", "OWNER")).toBe(true);
  });

  it("refuses backward jumps", () => {
    for (const role of STAFF_ROLES) {
      expect(isTransitionAllowed("COMPLETED", "PREPARING", role), role).toBe(false);
      expect(isTransitionAllowed("PREPARING", "CONFIRMED", role), role).toBe(false);
      expect(isTransitionAllowed("SERVED", "READY", role), role).toBe(false);
    }
  });

  it("refuses every move out of a terminal state", () => {
    for (const terminal of ["COMPLETED", "CANCELLED"] as OrderStatus[]) {
      for (const to of ORDER_STATUSES) {
        for (const role of STAFF_ROLES) {
          expect(isTransitionAllowed(terminal, to, role), `${terminal}->${to} ${role}`).toBe(false);
        }
      }
    }
  });

  it("refuses the illegal skips that the map does not list", () => {
    // PENDING is not one hop from SERVED, so no role may jump it.
    expect(isTransitionAllowed("PENDING", "SERVED", "OWNER")).toBe(false);
    expect(isTransitionAllowed("PENDING", "PREPARING", "OWNER")).toBe(false);
    expect(isTransitionAllowed("PENDING", "READY", "OWNER")).toBe(false);
    // COMPLETED is only reachable from READY/SERVED, never straight from CONFIRMED.
    expect(isTransitionAllowed("CONFIRMED", "COMPLETED", "OWNER")).toBe(false);
  });

  it("permits the skips the map actually does allow", () => {
    // CONFIRMED -> SERVED and PREPARING -> SERVED are deliberate express paths;
    // asserting them locks the policy in and would catch an accidental tightening.
    expect(isTransitionAllowed("CONFIRMED", "SERVED", "CASHIER")).toBe(true);
    expect(isTransitionAllowed("PREPARING", "SERVED", "OWNER")).toBe(true);
    expect(isTransitionAllowed("READY", "COMPLETED", "CASHIER")).toBe(true);
  });

  describe("role gating", () => {
    it("lets KITCHEN move a ticket forward only within the kitchen lane", () => {
      expect(isTransitionAllowed("CONFIRMED", "PREPARING", "KITCHEN")).toBe(true);
      expect(isTransitionAllowed("PREPARING", "READY", "KITCHEN")).toBe(true);
      // Ready -> served, and confirm/cancel, are floor-side actions the kitchen
      // must not perform even though the status map allows the edge.
      expect(isTransitionAllowed("PENDING", "CONFIRMED", "KITCHEN")).toBe(false);
      expect(isTransitionAllowed("READY", "SERVED", "KITCHEN")).toBe(false);
      expect(isTransitionAllowed("PENDING", "CANCELLED", "KITCHEN")).toBe(false);
    });

    it("lets a CASHIER confirm/serve/close and cancel, but never cook", () => {
      expect(isTransitionAllowed("PENDING", "CONFIRMED", "CASHIER")).toBe(true);
      expect(isTransitionAllowed("READY", "COMPLETED", "CASHIER")).toBe(true);
      expect(isTransitionAllowed("PREPARING", "CANCELLED", "CASHIER")).toBe(true);
      expect(isTransitionAllowed("CONFIRMED", "PREPARING", "CASHIER")).toBe(false);
      expect(isTransitionAllowed("PREPARING", "READY", "CASHIER")).toBe(false);
    });

    it("grants CUSTOMER no transition at all", () => {
      for (const from of ORDER_STATUSES) {
        for (const to of ORDER_STATUSES) {
          expect(isTransitionAllowed(from, to, "CUSTOMER"), `${from}->${to}`).toBe(false);
        }
      }
    });

    it("treats an unknown role as having no targets", () => {
      expect(isTransitionAllowed("PENDING", "CONFIRMED", "ROBOT")).toBe(false);
    });
  });

  it("matches the transcribed (transition ∩ role) policy for the full matrix", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        for (const role of [...STAFF_ROLES, "CUSTOMER"]) {
          const expected =
            EXPECTED_TRANSITIONS[from].includes(to) && (EXPECTED_ROLE_TARGETS[role] ?? []).includes(to);
          expect(isTransitionAllowed(from, to, role), `${from}->${to} ${role}`).toBe(expected);
        }
      }
    }
  });

  it("keeps a cancel reachable from every non-terminal state for a floor role", () => {
    for (const from of ORDER_STATUSES) {
      const terminal = EXPECTED_TRANSITIONS[from].length === 0;
      const canCancel = isTransitionAllowed(from, "CANCELLED", "MANAGER");
      expect(canCancel, `from ${from}`).toBe(!terminal && EXPECTED_TRANSITIONS[from].includes("CANCELLED"));
    }
  });
});

const RESERVATION_STATUSES: ReservationStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

const EXPECTED_RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

describe("reservation transitions", () => {
  it("permits the forward and abandon edges the policy lists", () => {
    expect(canMoveReservation("PENDING", "CONFIRMED")).toBe(true);
    expect(canMoveReservation("CONFIRMED", "CHECKED_IN")).toBe(true);
    expect(canMoveReservation("CHECKED_IN", "COMPLETED")).toBe(true);
    expect(canMoveReservation("PENDING", "NO_SHOW")).toBe(true);
  });

  it("refuses backward jumps and skips", () => {
    expect(canMoveReservation("CHECKED_IN", "CONFIRMED")).toBe(false);
    expect(canMoveReservation("CONFIRMED", "PENDING")).toBe(false);
    expect(canMoveReservation("PENDING", "COMPLETED")).toBe(false);
    expect(canMoveReservation("PENDING", "CHECKED_IN")).toBe(false);
    expect(canMoveReservation("CONFIRMED", "COMPLETED")).toBe(false);
  });

  it("refuses every move out of a terminal reservation state", () => {
    for (const terminal of ["COMPLETED", "CANCELLED", "NO_SHOW"] as ReservationStatus[]) {
      for (const to of RESERVATION_STATUSES) {
        expect(canMoveReservation(terminal, to), `${terminal}->${to}`).toBe(false);
      }
    }
  });

  it("matches the transcribed policy for the full matrix", () => {
    for (const from of RESERVATION_STATUSES) {
      for (const to of RESERVATION_STATUSES) {
        const expected = EXPECTED_RESERVATION_TRANSITIONS[from].includes(to);
        expect(canMoveReservation(from, to), `${from}->${to}`).toBe(expected);
      }
    }
  });
});
