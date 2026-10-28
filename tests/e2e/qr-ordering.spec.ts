import { expect, test } from "@playwright/test";

import { addDishWithPaidExtra, orderTotalsBlock, parseSessionTotals } from "./support/cart";
import { closeDb, countOrdersSince, readItemWithPaidAddon, readOrderByNumber, readSettings, readTableForOrdering } from "./support/db";
import { expectedTotals, money } from "./support/expectations";
import { guestContext } from "./support/staff";
import { POLL } from "./support/env";

/**
 * The QR journey, from the sticker to the table's own screen.
 *
 * A guest is seated by a random 16-byte token that only the database and the staff
 * floor board know, so the spec reads one at run time instead of carrying a
 * literal. What has to come back is the restaurant's arithmetic, not the phone's:
 * the dish is deliberately chosen with an extra that costs money, and the figure
 * on the screen is then compared with the row the server wrote and with the
 * charges the settings say apply.
 */

test.afterAll(async () => {
  await closeDb();
});

test("a guest joins a table by its real code, sends a dish with a paid extra, and sees the kitchen's own total", async ({ browser }) => {
  const [table, item, settings] = await Promise.all([readTableForOrdering(), readItemWithPaidAddon(), readSettings()]);

  const context = await guestContext(browser);
  const page = await context.newPage();
  try {
    // This is the link the QR sticker carries.
    await page.goto(`/order?table=${encodeURIComponent(table.publicToken)}`);

    await expect(page.getByRole("heading", { level: 2, name: `Table ${table.label}`, exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/Welcome — table|You are ordering with table/)).toBeVisible();

    const { extras, unitPoisa } = await addDishWithPaidExtra(page, item);
    expect(extras.length, "the added dish carries a paid extra").toBeGreaterThan(0);

    await page.goto("/order");
    const pending = page.locator("div.card").filter({ hasText: "Your dishes, not yet sent" }).first();
    await expect(pending.getByRole("heading", { level: 3, name: "Your dishes, not yet sent", exact: true })).toBeVisible();
    // Scoped to this device's own list — the cart summary in the sidebar names the same dish.
    await expect(pending.getByText(`1× ${item.name}`, { exact: false })).toBeVisible();

    // The cart's own subtotal is the menu price plus the extra — the guest's view.
    await expect(pending.getByText(`Subtotal ${money(unitPoisa, settings.currencySymbol)}`, { exact: false })).toBeVisible();

    await page.getByRole("button", { name: /Send \d+ dish(?:es)? to the kitchen/ }).click();

    const message = page.getByText(/Order \S+ is in\./);
    await expect(message).toBeVisible({ timeout: 40_000 });
    const orderNumber = (/Order (\S+) is in\./.exec(await message.innerText()) ?? [])[1];
    expect(orderNumber, "the app named the order it created").toBeTruthy();

    // It lands on the table's own list of orders.
    const row = orderTotalsBlock(page, orderNumber);
    await expect(row).toBeVisible({ timeout: POLL.table + POLL.margin });
    await expect(row.getByText(item.name, { exact: false })).toBeVisible();
    await expect(row.getByText(extras[0].name, { exact: false })).toBeVisible();

    const charges = parseSessionTotals(await row.locator("span.hint").filter({ hasText: " · VAT " }).innerText());
    const totalText = await row.locator("span.price").last().innerText();

    const order = await readOrderByNumber(orderNumber);
    expect(order.type).toBe("DINE_IN");
    expect(order.table?.label).toBe(table.label);
    expect(order.sessionId, "the order belongs to the seated visit").toBeTruthy();

    // The server's row, the settings' arithmetic and the guest's screen must agree.
    const expected = expectedTotals(order.items.map((line) => line.lineTotalPoisa), settings, {
      discountPoisa: order.discountPoisa,
    });
    expect(order.subtotalPoisa, "stored subtotal").toBe(expected.subtotalPoisa);
    expect(order.serviceChargePoisa, "stored service charge").toBe(expected.serviceChargePoisa);
    expect(order.vatPoisa, "stored VAT").toBe(expected.vatPoisa);
    expect(order.totalPoisa, "stored total").toBe(expected.totalPoisa);

    expect(charges.subtotalPoisa, "subtotal shown at the table").toBe(order.subtotalPoisa);
    expect(charges.serviceChargePoisa, "service charge shown at the table").toBe(order.serviceChargePoisa);
    expect(charges.vatPoisa, "VAT shown at the table").toBe(order.vatPoisa);
    expect(totalText.trim(), "total shown at the table").toBe(money(order.totalPoisa, settings.currencySymbol));

    // Nothing was charged: a table order is food on the way, not money taken.
    expect(order.paymentStatus).toBe("UNPAID");
    expect(order.paidPoisa).toBe(0);
  } finally {
    await context.close();
  }
});

test("a garbled table code is refused in human words and creates no order", async ({ browser }) => {
  const createdAfter = new Date();
  const context = await guestContext(browser);
  const page = await context.newPage();
  try {
    await page.goto("/order?table=NOT-A-TABLE-CODE-000000");

    await expect(page.getByText("This table code is not recognised", { exact: false })).toBeVisible({ timeout: 60_000 });

    // Rejected as a join, not as a crash: the guest is still offered the door.
    await expect(page.getByRole("heading", { level: 2, name: "Scan the code on your table", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join table" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Orders at this table", exact: true })).toHaveCount(0);

    expect(await countOrdersSince(createdAfter), "a refused join must not create an order").toBe(0);
  } finally {
    await context.close();
  }
});
