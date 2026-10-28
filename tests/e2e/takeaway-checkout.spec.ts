import { expect, test, type Page } from "@playwright/test";

import { quickAddDish } from "./support/cart";
import { closeDb, countOrdersSince, findTakeawayOrderByName, readQuickAddItem, readSettings } from "./support/db";
import { money, expectedTotals } from "./support/expectations";
import { runTag, testMobile, toPoisa } from "./support/money";
import { guestContext } from "./support/staff";

/**
 * Takeaway: a guest with no table, no account and a phone number.
 *
 * The checkout screen is where a browser could lie about money, and the app's own
 * answer is that it does not listen: the cart sends ids, quantities and a subtotal
 * used only as a staleness check. These specs try the lie. One order is placed the
 * honest way and its figures are compared with the row the server wrote and with
 * the charges the settings say apply; the next edits the cart's own price in
 * localStorage and expects to be refused rather than charged.
 */

test.afterAll(async () => {
  await closeDb();
});

/** One row of the confirmation's totals block: `Food`, `Service charge`, `VAT`, `Total`. */
function figureOnScreen(page: Page, label: string) {
  return page
    .locator("dl div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first()
    .locator("dd");
}

test("a takeaway order is confirmed with an order number and the restaurant's own arithmetic", async ({ browser }) => {
  const [settings, dish] = await Promise.all([readSettings(), readQuickAddItem()]);
  const tag = runTag();
  const name = `E2E Takeaway ${tag}`;
  const phone = testMobile(tag);

  const context = await guestContext(browser);
  const page = await context.newPage();
  try {
    await page.goto("/menu");
    await quickAddDish(page, dish, settings.currencySymbol);

    await page.goto("/checkout");
    // Nothing is taken here, and the page says so before the guest presses anything.
    await expect(page.getByText("Nothing is charged here.", { exact: false })).toBeVisible();
    await page.getByRole("radio", { name: "Takeaway", exact: false }).check();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Mobile number", { exact: true }).fill(phone);

    await expect(page.getByText(`Food subtotal: ${money(dish.pricePoisa, settings.currencySymbol)}`, { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Place the order" }).click();
    await page.waitForURL(/\/track\//, { timeout: 60_000 });

    const heading = page.getByRole("heading", { level: 2 });
    await expect(heading.first()).toContainText(/Order \S+/, { timeout: 40_000 });
    const orderNumber = (/Order (\S+)/.exec(await heading.first().innerText()) ?? [])[1];
    expect(orderNumber, "the confirmation names the order").toBeTruthy();

    const shownSubtotal = toPoisa(await figureOnScreen(page, "Food").innerText());
    const shownService = toPoisa(await figureOnScreen(page, "Service charge").innerText());
    const shownVat = toPoisa(await figureOnScreen(page, "VAT").innerText());
    const shownTotal = toPoisa(await figureOnScreen(page, "Total").innerText());

    const order = await findTakeawayOrderByName(name);
    expect(order, "the order the screen showed was really written").not.toBeNull();
    if (!order) return;

    expect(order.type).toBe("TAKEAWAY");
    expect(order.orderNumber).toBe(orderNumber);
    // The contact the guest typed, as the restaurant stored it.
    expect(order.contactName).toBe(name);
    expect(order.contactPhone).toBe(phone);

    // The server priced every line from its own menu, not from the browser's claim.
    expect(order.items.map((line) => line.unitPricePoisa)).toEqual([dish.pricePoisa]);
    const expected = expectedTotals(order.items.map((line) => line.lineTotalPoisa), settings);
    expect(order.subtotalPoisa, "stored subtotal").toBe(dish.pricePoisa);
    expect(order.serviceChargePoisa, "stored service charge").toBe(expected.serviceChargePoisa);
    expect(order.vatPoisa, "stored VAT").toBe(expected.vatPoisa);
    expect(order.totalPoisa, "stored total").toBe(expected.totalPoisa);

    // And the confirmation shows exactly those figures, formatted.
    expect(shownSubtotal, "subtotal on screen").toBe(order.subtotalPoisa);
    expect(shownService, "service charge on screen").toBe(order.serviceChargePoisa);
    expect(shownVat, "VAT on screen").toBe(order.vatPoisa);
    expect(shownTotal, "total on screen").toBe(order.totalPoisa);
    await expect(figureOnScreen(page, "Total")).toHaveText(money(order.totalPoisa, settings.currencySymbol));
  } finally {
    await context.close();
  }
});

test("a cart that reports its own price is refused, not charged at that price", async ({ browser }) => {
  const [settings, dish] = await Promise.all([readSettings(), readQuickAddItem()]);
  const tag = runTag();
  const name = `E2E Tampered ${tag}`;
  const createdAfter = new Date();

  const context = await guestContext(browser);
  const page = await context.newPage();
  try {
    await page.goto("/menu");
    await quickAddDish(page, dish, settings.currencySymbol);

    // A guest editing what their phone sends: sell the dish for one poisa.
    await page.evaluate(() => {
      const raw = window.localStorage.getItem("dk.cart.v1");
      if (!raw) throw new Error("the cart never persisted");
      const lines = JSON.parse(raw) as { unitPricePoisa: number }[];
      for (const line of lines) line.unitPricePoisa = 1;
      window.localStorage.setItem("dk.cart.v1", JSON.stringify(lines));
    });

    await page.goto("/checkout");
    await page.getByRole("radio", { name: "Takeaway", exact: false }).check();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Mobile number", { exact: true }).fill(testMobile(tag));
    await page.getByRole("button", { name: "Place the order" }).click();

    // The mismatch is a refusal in the guest's language, not a re-priced order.
    await expect(page.getByText("Prices or availability changed while you were browsing", { exact: false })).toBeVisible({
      timeout: 40_000,
    });
    await expect(page).not.toHaveURL(/\/track\//);

    expect(await findTakeawayOrderByName(name), "no order was written for the tampered cart").toBeNull();
    expect(await countOrdersSince(createdAfter), "a refused order creates no row").toBe(0);
  } finally {
    await context.close();
  }
});

test("the online payment door says plainly that it is a stand-in, never that money arrived", async ({ page }) => {
  await page.goto("/pay/simulated");

  await expect(page.getByText("Development gateway", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Simulated payment", exact: true })).toBeVisible();
  await expect(page.getByText("No payment provider is configured for this installation", { exact: false })).toBeVisible();
  // With no reference it refuses to pretend, and changes nothing.
  await expect(page.getByText("This page needs a payment reference", { exact: false })).toBeVisible();

  // A guest must never be told a payment succeeded when none was attempted.
  await expect(page.getByText(/payment (was )?successful/i)).toHaveCount(0);
  await expect(page.getByText(/has been paid/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve payment" })).toHaveCount(0);
});
