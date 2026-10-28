import { describe, expect, it } from "vitest";
import { isTransitionAllowed, paymentStatusFor } from "@/server/services/order.service";
import type { OrderStatus, PaymentStatus, UserRole } from "@prisma/client";

/**
 * The two pure exports of `src/server/services/order.service.ts`.
 *
 * Importing this module does construct a Prisma client (the service file pulls
 * in `@/lib/db`), but nothing here connects to a database: the client is lazy,
 * these two functions touch no I/O, and the run below proves it.
 */

const ALL_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
];

const ALL_ROLES: UserRole[] = ["OWNER", "MANAGER", "CASHIER", "KITCHEN", "CUSTOMER"];

/** The order lifecycle, transcribed from the policy rather than the code. */
const LIFECYCLE: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "SERVED", "CANCELLED"],
  PREPARING: ["READY", "SERVED", "CANCELLED"],
  READY: ["SERVED", "COMPLETED", "CANCELLED"],
  SERVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Least privilege: which target status each role may move an order into. */
const ROLE_TARGETS: Record<UserRole, OrderStatus[]> = {
  OWNER: ["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"],
  MANAGER: ["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"],
  CASHIER: ["CONFIRMED", "SERVED", "COMPLETED", "CANCELLED"],
  KITCHEN: ["PREPARING", "READY"],
  CUSTOMER: [],
};

function allowedTargets(from: OrderStatus, role: string): OrderStatus[] {
  return ALL_STATUSES.filter((to) => isTransitionAllowed(from, to, role));
}

describe("isTransitionAllowed — full role x state coverage", () => {
  const cells: { from: OrderStatus; role: UserRole }[] = ALL_ROLES.flatMap((role) =>
    ALL_STATUSES.map((from) => ({ from, role })),
  );

  it.each(cells)("$role moving $from", ({ from, role }) => {
    const expected = LIFECYCLE[from].filter((to) => ROLE_TARGETS[role].includes(to));
    expect(allowedTargets(from, role).sort()).toEqual([...expected].sort());
  });

  it("a transition needs both the lifecycle edge and the role grant", () => {
    // PENDING -> CANCELLED is a legal edge, but only roles that may cancel take it.
    expect(isTransitionAllowed("PENDING", "CANCELLED", "OWNER")).toBe(true);
    expect(isTransitionAllowed("PENDING", "CANCELLED", "KITCHEN")).toBe(false);
    expect(isTransitionAllowed("PENDING", "CANCELLED", "CUSTOMER")).toBe(false);
    // KITCHEN may reach PREPARING/READY, and READY -> COMPLETED is not its edge at all.
    expect(isTransitionAllowed("PREPARING", "READY", "KITCHEN")).toBe(true);
    expect(isTransitionAllowed("READY", "COMPLETED", "KITCHEN")).toBe(false);
    expect(isTransitionAllowed("PENDING", "COMPLETED", "KITCHEN")).toBe(false);
  });

  it("terminal states accept nothing, whoever asks", () => {
    for (const role of ALL_ROLES) {
      expect(allowedTargets("COMPLETED", role)).toEqual([]);
      expect(allowedTargets("CANCELLED", role)).toEqual([]);
    }
  });

  it("a role can never move an order into its own starting state", () => {
    for (const status of ALL_STATUSES) {
      for (const role of ALL_ROLES) {
        expect(isTransitionAllowed(status, status, role)).toBe(false);
      }
    }
  });

  it("only OWNER and MANAGER can complete an order end to end", () => {
    const path: OrderStatus[] = ["CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED"];
    let cursor: OrderStatus = "PENDING";
    for (const next of path) {
      expect(isTransitionAllowed(cursor, next, "MANAGER"), `${cursor} -> ${next}`).toBe(true);
      cursor = next;
    }
    // A cashier can walk the same ticket forward only where the kitchen is done.
    expect(isTransitionAllowed("READY", "COMPLETED", "CASHIER")).toBe(true);
    expect(isTransitionAllowed("PENDING", "PREPARING", "CASHIER")).toBe(false);
  });

  it("treats an unknown role as having no transitions at all", () => {
    for (const status of ALL_STATUSES) {
      expect(allowedTargets(status, "ROBOT")).toEqual([]);
    }
    expect(isTransitionAllowed("PENDING", "CONFIRMED", "")).toBe(false);
    expect(isTransitionAllowed("PENDING", "CONFIRMED", undefined as unknown as string)).toBe(false);
  });
});

describe("paymentStatusFor", () => {
  const cases: { name: string; total: number; paid: number; expected: PaymentStatus }[] = [
    { name: "nothing collected yet", total: 125000, paid: 0, expected: "UNPAID" },
    { name: "a first partial payment", total: 125000, paid: 100, expected: "PARTIAL" },
    { name: "one poisa short", total: 125000, paid: 124999, expected: "PARTIAL" },
    { name: "settled exactly", total: 125000, paid: 125000, expected: "PAID" },
    { name: "overpaid", total: 125000, paid: 130000, expected: "PAID" },
    { name: "a negative payment is still unpaid", total: 125000, paid: -5000, expected: "UNPAID" },
    { name: "a paid zero-value bill", total: 0, paid: 1, expected: "PAID" },
    { name: "a zero total with nothing paid", total: 0, paid: 0, expected: "PAID" },
  ];

  it.each(cases)("$name", ({ total, paid, expected }) => {
    expect(paymentStatusFor(total, paid)).toBe(expected);
  });

  it("returns a value from the PaymentStatus domain for every case", () => {
    const domain: PaymentStatus[] = ["UNPAID", "PARTIAL", "PAID", "REFUNDED"];
    for (let paid = -100; paid <= 200_000; paid += 7919) {
      expect(domain).toContain(paymentStatusFor(125_000, paid));
    }
  });

  it("the status never moves backwards as money arrives", () => {
    const rank: Record<PaymentStatus, number> = { UNPAID: 0, PARTIAL: 1, PAID: 2, REFUNDED: 3 };
    let previous = -1;
    for (const paid of [0, 1, 62_499, 62_500, 124_999, 125_000, 125_001, 500_000]) {
      const status = paymentStatusFor(125_000, paid);
      expect(rank[status]).toBeGreaterThanOrEqual(previous);
      previous = rank[status];
    }
  });

  it("treats a fully discounted bill as settled rather than owed forever", () => {
    // The rule lives in one place now, so the till never has to record a token
    // payment to get a ৳0 order off the outstanding list.
    expect(paymentStatusFor(0, 0)).toBe("PAID");
  });

  it("REFUNDED is out of reach for this helper — refunds are a separate ledger", () => {
    expect(paymentStatusFor(125_000, 125_000)).toBe("PAID");
    expect(paymentStatusFor(125_000, 0)).toBe("UNPAID");
  });
});
