import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyCanonicalSettings,
  cleanupFixtures,
  createFixtureCategory,
  createFixtureItem,
  createFixtureOption,
  createFixtureTable,
  expectDatabaseUnderTest,
  expectRefusal,
  findResidue,
  fixtureStaffActor,
  joinFixtureTable,
  prisma,
  runTag,
  track,
  uniqueKey,
  uniquePhone,
  uniqueSlug,
} from "./support";
import {
  cancelOrder,
  createOrder,
  getOrderByPublicToken,
  getSessionOrdersForGuest,
  priceOrderLines,
  updateOrderStatus,
} from "@/server/services/order.service";
import { closeSession } from "@/server/services/table.service";
import { updateMenuItem } from "@/server/services/menu.service";
import type { OrderCreateInput } from "@/server/validation/order";
import type { MenuItem } from "@prisma/client";

/**
 * Orders: what the guest may decide, and what only the database may decide.
 *
 * Every figure below is written out in poisa against the canonical settings the
 * suite installs (10% service charge, 5% VAT, no cash rounding), so a change in the
 * charge maths shows up as a wrong integer instead of a re-derived expectation.
 */

const KEBAB_PRICE = 350_00;
const NAAN_PRICE = 50_00;

let actor: { userId: string; role: string };
let kebab: MenuItem;
let naan: MenuItem;
let retired: MenuItem;
let offlineCategoryItem: MenuItem;
let extraEgg: { groupId: string; optionId: string };

function orderInput(overrides: Partial<OrderCreateInput> = {}): OrderCreateInput {
  return {
    type: "TAKEAWAY",
    contact: { name: `Guest ${runTag}`, phone: uniquePhone() },
    items: [{ menuItemId: kebab.id, quantity: 2, options: [], instructions: null }],
    idempotencyKey: uniqueKey("idem"),
    ...overrides,
  };
}

/** The menu row as `updateMenuItem` wants it, with one field changed. */
function withPrice(item: MenuItem, pricePoisa: number) {
  return {
    name: item.name,
    slug: item.slug,
    description: item.description,
    categoryId: item.categoryId,
    pricePoisa,
    imageUrl: item.imageUrl,
    available: true,
    featured: false,
    prepMinutes: item.prepMinutes,
    ingredients: item.ingredients,
    allergens: item.allergens,
    spicyLevel: item.spicyLevel,
    servesInfo: item.servesInfo,
    sortOrder: item.sortOrder,
  };
}

beforeAll(async () => {
  expect(await expectDatabaseUnderTest()).toBeTruthy();
  await applyCanonicalSettings();
  actor = await fixtureStaffActor();

  const category = await createFixtureCategory("Kababs");
  kebab = await createFixtureItem(category.id, "Seekh Kebab", KEBAB_PRICE);
  naan = await createFixtureItem(category.id, "Naan", NAAN_PRICE);
  retired = await createFixtureItem(category.id, "Special Kacchi", 900_00, { available: false });

  const paidOption = await createFixtureOption(kebab.id, "Extra egg", 50_00);
  extraEgg = { groupId: paidOption.group.id, optionId: paidOption.option.id };

  // A dish under a switched-off category must not be orderable either.
  const hiddenCategory = await prisma.menuCategory.create({
    data: { name: `Past specials (${runTag})`, slug: uniqueSlug("past-specials"), sortOrder: 99, isActive: false },
  });
  track("categories", hiddenCategory.id);
  offlineCategoryItem = await createFixtureItem(hiddenCategory.id, "Winter special", 500_00);
});

afterAll(async () => {
  await cleanupFixtures();
  expect(await findResidue()).toEqual([]);
});

describe("order pricing", () => {
  it("prices every line from the menu row and derives the charges itself", async () => {
    const { order } = await createOrder(orderInput(), { customerId: null });
    track("orders", order.id);

    const line = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(line.unitPricePoisa).toBe(KEBAB_PRICE);
    expect(line.lineTotalPoisa).toBe(700_00);
    expect(line.nameSnapshot).toBe(kebab.name);

    expect(order.subtotalPoisa).toBe(700_00);
    expect(order.serviceChargePoisa).toBe(70_00);
    expect(order.vatPoisa).toBe(35_00);
    expect(order.totalPoisa).toBe(805_00);
    expect(order.discountPoisa).toBe(0);
    expect(order.status).toBe("PENDING");
    expect(order.paymentStatus).toBe("UNPAID");
  });

  it("refuses a cart subtotal that does not match the menu instead of charging what the client sent", async () => {
    const idempotencyKey = uniqueKey("forged-cart");

    const error = await expectRefusal(
      () => createOrder(orderInput({ idempotencyKey, cartTotalPoisa: 1 }), { customerId: null }),
      "CONFLICT",
      "stale cart",
    );
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/prices or availability changed/i);
    expect(await prisma.order.count({ where: { idempotencyKey } })).toBe(0);
  });

  it("prices a dish at whatever the menu says when the order is placed", async () => {
    const before = await createOrder(orderInput(), { customerId: null });
    track("orders", before.order.id);

    try {
      await updateMenuItem(kebab.id, withPrice(kebab, 400_00), actor.userId);

      const after = await createOrder(orderInput(), { customerId: null });
      track("orders", after.order.id);

      expect(before.order.subtotalPoisa).toBe(700_00);
      expect(after.order.subtotalPoisa).toBe(800_00);
      // The earlier order keeps its own snapshot; only the new one follows the price.
      expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: before.order.id } })).unitPricePoisa).toBe(KEBAB_PRICE);
    } finally {
      await updateMenuItem(kebab.id, withPrice(kebab, KEBAB_PRICE), actor.userId);
    }
  });

  it("adds a customization option's price delta from the database", async () => {
    const choice = [{ groupId: extraEgg.groupId, optionId: extraEgg.optionId }];

    const priced = await priceOrderLines([{ menuItemId: kebab.id, quantity: 2, options: choice, instructions: null }]);
    expect(priced).toHaveLength(1);
    expect(priced[0]?.unitPricePoisa).toBe(400_00);
    expect(priced[0]?.lineTotalPoisa).toBe(800_00);
    expect(priced[0]?.optionsSnapshot).toEqual([{ groupName: "Extra egg choice", optionName: "Extra egg extra", priceDeltaPoisa: 50_00 }]);

    const { order } = await createOrder(orderInput({ items: [{ menuItemId: kebab.id, quantity: 2, options: choice, instructions: null }] }), {
      customerId: null,
    });
    track("orders", order.id);

    expect(order.subtotalPoisa).toBe(800_00);
    expect(order.serviceChargePoisa).toBe(80_00);
    expect(order.vatPoisa).toBe(40_00);
    expect(order.totalPoisa).toBe(920_00);
  });

  it("refuses a dish id that is not on the menu", async () => {
    const error = await expectRefusal(
      () => createOrder(orderInput({ items: [{ menuItemId: "ckf-not-a-dish", quantity: 1, options: [], instructions: null }] }), { customerId: null }),
      "ITEM_UNAVAILABLE",
      "unknown menu id",
    );

    expect(error.status).toBe(409);
    expect(error.details?.items?.[0]).toMatch(/is no longer on the menu/);
  });

  it("refuses a dish that is off the menu, and one under a switched-off category", async () => {
    const soldOut = await expectRefusal(
      () => createOrder(orderInput({ items: [{ menuItemId: retired.id, quantity: 1, options: [], instructions: null }] }), { customerId: null }),
      "ITEM_UNAVAILABLE",
      "unavailable dish",
    );
    expect(soldOut.message).toMatch(/not available right now/);

    const hidden = await expectRefusal(
      () => createOrder(orderInput({ items: [{ menuItemId: offlineCategoryItem.id, quantity: 1, options: [], instructions: null }] }), { customerId: null }),
      "ITEM_UNAVAILABLE",
      "dish under an inactive category",
    );
    expect(hidden.message).toMatch(/not available right now/);
  });

  it("refuses an unavailable option, an unknown option group and a choice over the limit", async () => {
    const gone = await prisma.menuItemCustomizationOption.create({
      data: { groupId: extraEgg.groupId, name: "Gone", priceDeltaPoisa: 10_00, available: false, sortOrder: 1 },
    });

    await expectRefusal(
      () => priceOrderLines([{ menuItemId: kebab.id, quantity: 1, options: [{ groupId: extraEgg.groupId, optionId: gone.id }], instructions: null }]),
      "ITEM_UNAVAILABLE",
      "sold-out option",
    );

    await expectRefusal(
      () => priceOrderLines([{ menuItemId: kebab.id, quantity: 1, options: [{ groupId: "ckf-no-such-group", optionId: extraEgg.optionId }], instructions: null }]),
      "VALIDATION",
      "unknown option group",
    );

    await expectRefusal(
      () =>
        priceOrderLines([
          {
            menuItemId: kebab.id,
            quantity: 1,
            options: [
              { groupId: extraEgg.groupId, optionId: extraEgg.optionId },
              { groupId: extraEgg.groupId, optionId: extraEgg.optionId },
            ],
            instructions: null,
          },
        ]),
      "VALIDATION",
      "more options than the group allows",
    );
  });

  it("returns the first order when the same submission is replayed", async () => {
    const idempotencyKey = uniqueKey("replay");

    const first = await createOrder(orderInput({ idempotencyKey }), { customerId: null });
    expect(first.replayed).toBe(false);
    track("orders", first.order.id);

    const second = await createOrder(orderInput({ idempotencyKey }), { customerId: null });
    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(await prisma.order.count({ where: { idempotencyKey } })).toBe(1);
  });

  it("refuses a channel the restaurant has not enabled", async () => {
    const error = await expectRefusal(
      () =>
        createOrder(
          orderInput({
            type: "DELIVERY",
            contact: { name: `Guest ${runTag}`, phone: uniquePhone(), address: "House 12, Road 3, Dhanmondi" },
          }),
          { customerId: null },
        ),
      "VALIDATION",
      "delivery channel",
    );
    expect(error.message).toMatch(/delivery is not available/i);
  });
});

describe("dine-in orders and the table session", () => {
  it("attaches a dine-in order to the visit opened by the QR scan", async () => {
    const table = await createFixtureTable(4);
    const joined = await joinFixtureTable(table.publicToken, "Window party");

    const { order } = await createOrder(
      orderInput({ type: "DINE_IN", tableToken: table.publicToken, participantToken: joined.participantToken, contact: undefined }),
      { customerId: null },
    );
    track("orders", order.id);

    expect(order.sessionId).toBe(joined.sessionId);
    expect(order.tableId).toBe(table.id);
    expect(order.participantId).not.toBeNull();

    const storedTable = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: table.id } });
    expect(storedTable.status).toBe("OCCUPIED");

    const guestView = await getSessionOrdersForGuest(joined.participantToken);
    expect(guestView.session.orders.map((row) => row.id)).toEqual([order.id]);
    expect((await getOrderByPublicToken(order.publicToken)).id).toBe(order.id);
  });

  it("refuses to order into a visit that has been closed", async () => {
    const table = await createFixtureTable(4);
    const joined = await joinFixtureTable(table.publicToken, "Late party");
    await closeSession(joined.sessionId, { reason: "MANUAL" }, { userId: actor.userId, role: actor.role });

    // Closing puts the table through cleaning, so the QR entry point itself refuses
    // before the session check is ever reached.
    const error = await expectRefusal(
      () => createOrder(orderInput({ type: "DINE_IN", tableToken: table.publicToken, contact: undefined }), { customerId: null }),
      "TABLE_INACTIVE",
      "ordering after the visit closed",
    );
    expect(error.status).toBe(409);

    await expectRefusal(() => getSessionOrdersForGuest(joined.participantToken), "SESSION_CLOSED", "guest view after the visit closed");
  });
});

describe("order status lifecycle", () => {
  async function newOrder() {
    const { order } = await createOrder(orderInput({ items: [{ menuItemId: naan.id, quantity: 1, options: [], instructions: null }] }), {
      customerId: null,
    });
    track("orders", order.id);
    return order;
  }

  it("refuses an illegal jump and leaves the stored status untouched", async () => {
    const order = await newOrder();

    const error = await expectRefusal(
      () => updateOrderStatus(order.id, "SERVED", { userId: actor.userId, role: "OWNER" }),
      "INVALID_TRANSITION",
      "PENDING straight to SERVED",
    );
    expect(error.status).toBe(400);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
    expect(await prisma.orderStatusEvent.count({ where: { orderId: order.id, toStatus: "SERVED" } })).toBe(0);
  });

  it("writes one status event per legal move, from the status it actually left", async () => {
    const order = await newOrder();
    const kitchen = { userId: actor.userId, role: "KITCHEN" };

    await updateOrderStatus(order.id, "CONFIRMED", { userId: actor.userId, role: "OWNER" });
    await updateOrderStatus(order.id, "PREPARING", kitchen);
    await updateOrderStatus(order.id, "READY", kitchen);
    await updateOrderStatus(order.id, "COMPLETED", { userId: actor.userId, role: "MANAGER" });

    const events = await prisma.orderStatusEvent.findMany({ where: { orderId: order.id } });
    const chain = new Set(events.map((event) => `${event.fromStatus ?? "none"}->${event.toStatus}`));
    expect([...chain].sort()).toEqual(
      ["CONFIRMED->PREPARING", "none->PENDING", "PENDING->CONFIRMED", "PREPARING->READY", "READY->COMPLETED"].sort(),
    );
    expect(events).toHaveLength(5);
    // The creation event has no actor: the guest submitted the order, nobody moved it.
    const created = events.filter((event) => event.toStatus === "PENDING");
    expect(created).toHaveLength(1);
    expect(created[0]?.actorUserId).toBeNull();
    expect(events.filter((event) => event.toStatus !== "PENDING").every((event) => event.actorUserId === actor.userId)).toBe(true);
  });

  it("refuses to move a completed order backwards", async () => {
    const order = await newOrder();
    await updateOrderStatus(order.id, "CONFIRMED", { userId: actor.userId, role: "OWNER" });
    await updateOrderStatus(order.id, "PREPARING", { userId: actor.userId, role: "KITCHEN" });
    await updateOrderStatus(order.id, "SERVED", { userId: actor.userId, role: "OWNER" });
    await updateOrderStatus(order.id, "COMPLETED", { userId: actor.userId, role: "OWNER" });

    const error = await expectRefusal(
      () => updateOrderStatus(order.id, "PREPARING", { userId: actor.userId, role: "OWNER" }),
      "INVALID_TRANSITION",
      "COMPLETED back to PREPARING",
    );
    expect(error.message).toMatch(/cannot move to "PREPARING"/);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("COMPLETED");
    expect(await prisma.orderStatusEvent.count({ where: { orderId: order.id } })).toBe(5);
  });

  it("refuses to revive a cancelled order", async () => {
    const order = await newOrder();
    const cancelled = await cancelOrder(order.id, "Guest left again", { userId: actor.userId, role: "CASHIER" });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledReason).toBe("Guest left again");

    await expectRefusal(
      () => updateOrderStatus(order.id, "CONFIRMED", { userId: actor.userId, role: "OWNER" }),
      "INVALID_TRANSITION",
      "CANCELLED back to CONFIRMED",
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");

    // Moving an order to the status it already holds is a no-op, not a second event.
    await updateOrderStatus(order.id, "CANCELLED", { userId: actor.userId, role: "OWNER" });
    expect(await prisma.orderStatusEvent.count({ where: { orderId: order.id, toStatus: "CANCELLED" } })).toBe(1);
  });

  it("keeps each role inside its own part of the lifecycle", async () => {
    const order = await newOrder();

    await expectRefusal(
      () => updateOrderStatus(order.id, "CONFIRMED", { userId: actor.userId, role: "KITCHEN" }),
      "INVALID_TRANSITION",
      "kitchen confirming an order",
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");

    await updateOrderStatus(order.id, "CONFIRMED", { userId: actor.userId, role: "CASHIER" });
    await expectRefusal(
      () => updateOrderStatus(order.id, "PREPARING", { userId: actor.userId, role: "CASHIER" }),
      "INVALID_TRANSITION",
      "cashier cooking",
    );

    const cooking = await updateOrderStatus(order.id, "PREPARING", { userId: actor.userId, role: "KITCHEN" });
    expect(cooking.status).toBe("PREPARING");
  });

  it("refuses a cancellation from a role that may not cancel", async () => {
    const order = await newOrder();

    const error = await expectRefusal(
      () => cancelOrder(order.id, "Not my job", { userId: actor.userId, role: "KITCHEN" }),
      "FORBIDDEN",
      "kitchen cancelling",
    );
    expect(error.status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });
});
