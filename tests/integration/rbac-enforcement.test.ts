import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyCanonicalSettings,
  bearerRequest,
  cleanupFixtures,
  createFixtureCategory,
  createFixtureDineInOrder,
  createFixtureItem,
  createFixtureUser,
  createFixtureVisit,
  expectDatabaseUnderTest,
  expectRefusal,
  findResidue,
  prisma,
  runTag,
  sessionTokenFor,
  track,
  uniqueKey,
  uniquePhone,
  type FixtureUser,
} from "./support";
import { cancelOrder, createOrder, updateOrderStatus } from "@/server/services/order.service";
import { getBillById, openBillForSession, voidBill } from "@/server/services/billing.service";
import { myOrderHistory } from "@/server/services/customer.service";
import { getCurrentUserFromRequest, resolveToken, type AuthenticatedUser } from "@/lib/auth/session";
import { assertPermission } from "@/lib/auth/rbac";
import type { OrderCreateInput } from "@/server/validation/order";

/**
 * RBAC against live rows. `tests/unit/rbac.test.ts` already pins the pure
 * permission matrix; what an integration file has to prove is that the gate
 * bites: a refusal leaves the row untouched, an identity is re-checked against the
 * database on every request, and one customer's data never reaches another.
 *
 * Services enforce authority from the actor object they are handed — the exact
 * object a route builds from a resolved session — so driving them with real rows
 * exercises the same control the HTTP layer relies on, without a web runtime.
 */

const KEBAB_PRICE = 300_00;

let kebab: Awaited<ReturnType<typeof createFixtureItem>>;
let owner: FixtureUser;
let manager: FixtureUser;
let cashier: FixtureUser;
let kitchen: FixtureUser;
let customer: FixtureUser;

/** An actor-shaped object for the service calls that gate on `role`. */
const actor = (user: FixtureUser) => ({ userId: user.id, role: user.role });
/** A resolved-session-shaped object for the pure permission gate. */
const asUser = (user: FixtureUser): AuthenticatedUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  sessionId: "integration-session",
});

/** A dine-in visit with one PENDING order, and that session's bill raised to OPEN. */
async function pendingOrder(label: string) {
  const visit = await createFixtureVisit(label);
  const { order } = await createFixtureDineInOrder(visit, kebab.id, 1, { keyPrefix: label });
  return { visit, order };
}
async function openBillTarget(label: string) {
  const { visit, order } = await pendingOrder(label);
  const bill = await openBillForSession(visit.sessionId, actor(manager));
  track("bills", bill.id);
  return { visit, order, bill };
}

beforeAll(async () => {
  expect(await expectDatabaseUnderTest()).toBeTruthy();
  await applyCanonicalSettings();
  const category = await createFixtureCategory("Grill");
  kebab = await createFixtureItem(category.id, "Seekh Kebab", KEBAB_PRICE);
  owner = await createFixtureUser("OWNER", "Owner");
  manager = await createFixtureUser("MANAGER", "Manager");
  cashier = await createFixtureUser("CASHIER", "Cashier");
  kitchen = await createFixtureUser("KITCHEN", "Kitchen");
  customer = await createFixtureUser("CUSTOMER", "Customer");
});

afterAll(async () => {
  await cleanupFixtures();
  expect(await findResidue()).toEqual([]);
});

describe("mutating authority is enforced on the row, not just the button", () => {
  it("voids a bill only for owner and manager, and leaves the bill OPEN for everyone else", async () => {
    const { bill } = await openBillTarget("Void-matrix");

    for (const user of [cashier, kitchen, customer]) {
      await expectRefusal(
        () => voidBill(bill.id, "Not this role's call", actor(user)),
        "FORBIDDEN",
        `${user.role} voiding a bill`,
      );
    }
    // Every refusal happened before any write, so the bill is still an untouched OPEN one.
    expect((await getBillById(bill.id)).status).toBe("OPEN");

    const voided = await voidBill(bill.id, "Comped by owner", actor(owner));
    expect(voided.status).toBe("VOIDED");

    // A manager holds the same authority on its own bill.
    const second = await openBillTarget("Void-manager");
    expect((await voidBill(second.bill.id, "Priced wrong", actor(manager))).status).toBe("VOIDED");
  });

  it("cancels an order only for counter and management staff", async () => {
    const { order } = await pendingOrder("Cancel-matrix");

    for (const user of [kitchen, customer]) {
      await expectRefusal(() => cancelOrder(order.id, "Not allowed", actor(user)), "FORBIDDEN", `${user.role} cancelling`);
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");

    const cancelled = await cancelOrder(order.id, "Guest left", actor(cashier));
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("gives a signed-in customer no part of the order lifecycle", async () => {
    const { order } = await pendingOrder("Customer-lifecycle");

    // A move every staff role can make is refused outright for a customer.
    await expectRefusal(
      () => updateOrderStatus(order.id, "CONFIRMED", actor(customer)),
      "INVALID_TRANSITION",
      "customer confirming an order",
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });

  it("refuses the broad order-view permission for a customer at the gate", () => {
    expect(() => assertPermission(asUser(customer), "order:view:any")).toThrow(/may not perform this action/);
    expect(() => assertPermission(asUser(kitchen), "order:view:any")).not.toThrow();
  });
});

describe("identity is re-checked against the database on every request", () => {
  it("rejects a deactivated staff account whose session token is still cryptographically valid", async () => {
    const desk = await createFixtureUser("CASHIER", "Desk");
    const token = await sessionTokenFor(desk);

    const live = await resolveToken(token);
    expect(live).not.toBeNull();
    expect(live?.role).toBe("CASHIER");
    expect(await getCurrentUserFromRequest(bearerRequest(token))).not.toBeNull();

    // Deactivate the account but leave the session row in place, exactly as a
    // manager flipping the switch does.
    await prisma.user.update({ where: { id: desk.id }, data: { isActive: false } });

    // The very same token now resolves to nobody — the check runs per request,
    // not once at sign-in.
    expect(await resolveToken(token)).toBeNull();
    expect(await getCurrentUserFromRequest(bearerRequest(token))).toBeNull();

    // Proof the rejection is the isActive re-check, not the token having been revoked.
    expect(await prisma.session.findUnique({ where: { id: live!.sessionId } })).not.toBeNull();
  });
});

describe("one customer never reads another customer's orders", () => {
  it("scopes the order history to the signed-in customer", async () => {
    const alpha = await createFixtureUser("CUSTOMER", "Alpha");
    const beta = await createFixtureUser("CUSTOMER", "Beta");

    const orderFor = async (user: FixtureUser) => {
      const input: OrderCreateInput = {
        type: "TAKEAWAY",
        contact: { name: `${runTag} ${user.name}`, phone: uniquePhone() },
        items: [{ menuItemId: kebab.id, quantity: 1, options: [], instructions: null }],
        idempotencyKey: uniqueKey("rbac-history"),
      };
      const { order } = await createOrder(input, { customerId: user.id });
      track("orders", order.id);
      return order;
    };
    const alphaOrder = await orderFor(alpha);
    const betaOrder = await orderFor(beta);
    expect(alphaOrder.customerId).toBe(alpha.id);
    expect(betaOrder.customerId).toBe(beta.id);

    const alphaHistory = await myOrderHistory(alpha.id);
    const betaHistory = await myOrderHistory(beta.id);
    const alphaIds = alphaHistory.map((row) => row.id);
    const betaIds = betaHistory.map((row) => row.id);

    expect(alphaIds).toContain(alphaOrder.id);
    expect(alphaIds).not.toContain(betaOrder.id); // never another customer's order
    expect(betaIds).toContain(betaOrder.id);
    expect(betaIds).not.toContain(alphaOrder.id);
  });
});
