import { expect, test } from "@playwright/test";

import { quickAddDish } from "./support/cart";
import { closeDb, readQuickAddItem, readSettings } from "./support/db";
import { runTag, testMobile } from "./support/money";
import { guestContext, staffContext } from "./support/staff";

/**
 * The counter's own journey, start to finish, on one screen.
 *
 * A guest orders a takeaway and walks up to pay. Before this screen existed the
 * owner had to draw the bill up from the floor board — which only exists for
 * tables — so a takeaway could never be billed, receipted or paid at all. The
 * order page now carries one button, and the bill it opens does the whole job:
 * fix the amount, take the money, hand over the receipt.
 *
 * The takeaway is deliberately the subject here: it is the case that used to have
 * no door to the money.
 */

test.afterAll(async () => {
  await closeDb();
});

test("a takeaway is billed, paid and receipted from the order the owner is looking at", async ({ browser }) => {
  const [settings, dish] = await Promise.all([readSettings(), readQuickAddItem()]);
  const tag = runTag();
  const name = `E2E Settle ${tag}`;

  const guest = await guestContext(browser);
  const page = await guest.newPage();
  const owner = await staffContext(browser, "owner");
  const ownerPage = await owner.newPage();

  try {
    // ------------------------------------------------------- the guest's order
    await page.goto("/menu");
    await quickAddDish(page, dish, settings.currencySymbol);
    await page.goto("/checkout");
    await page.getByRole("radio", { name: "Takeaway", exact: false }).check();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Mobile number", { exact: true }).fill(testMobile(tag));
    await page.getByRole("button", { name: "Place the order" }).click();
    await page.waitForURL(/\/track\//, { timeout: 60_000 });

    const heading = page.getByRole("heading", { level: 2 }).first();
    await expect(heading).toContainText(/Order \S+/, { timeout: 40_000 });
    const orderNumber = (/Order (\S+)/.exec(await heading.innerText()) ?? [])[1];
    if (!orderNumber) throw new Error("the confirmation did not name the order");
    expect(orderNumber, "the confirmation names the order").toBeTruthy();

    // The guest is told, without asking, where the money goes.
    await expect(page.getByText(/pay .* at the counter when you collect/i)).toBeVisible();

    // -------------------------------------------------- owner: order → bill
    await ownerPage.goto(`/admin/orders?search=${encodeURIComponent(orderNumber)}`);
    // Exact: the active-filter badge above the list also carries the order number.
    await ownerPage.getByRole("link", { name: orderNumber, exact: true }).click();
    await expect(ownerPage.getByRole("heading", { level: 1, name: orderNumber })).toBeVisible({
      timeout: 60_000,
    });

    await ownerPage.getByRole("button", { name: "Bill & take payment" }).click();
    await ownerPage.waitForURL(/\/admin\/bills\/[^/]+$/, { timeout: 60_000 });

    // Everything the till does is on this one page, in the order it is done.
    const settle = ownerPage.locator("section.card").filter({ hasText: "Settle this bill" });
    await expect(settle).toBeVisible({ timeout: 60_000 });
    await expect(settle.getByRole("heading", { level: 3, name: /Fix the amount/ })).toBeVisible();
    await expect(settle.getByRole("heading", { level: 3, name: /Take the payment/ })).toBeVisible();
    await expect(settle.getByRole("heading", { level: 3, name: /Hand over the receipt/ })).toBeVisible();

    // ------------------------------------------------- fix the amount
    await settle.getByRole("button", { name: "Finalize this bill" }).click();
    await expect(settle.getByText("This bill is finalized", { exact: false })).toBeVisible({ timeout: 60_000 });

    // ------------------------------------------------- take the money
    await settle.getByRole("button", { name: /^Record payment of/ }).click();
    await expect(settle.getByText(/is settled\./)).toBeVisible({ timeout: 60_000 });

    // ------------------------------------------------- the receipt, unasked
    // The receipt is fetched as soon as the bill is fixed, so the owner can print
    // without hunting for another panel.
    await expect(settle.getByRole("button", { name: "Print", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(settle.getByRole("button", { name: "Download a text copy" })).toBeVisible();
    await expect(settle.locator("article")).toContainText("Bill", { timeout: 60_000 });

    // A takeaway has no table to clear, so that control must not appear here.
    await expect(ownerPage.getByRole("button", { name: /Clear table/ })).toHaveCount(0);
  } finally {
    await guest.close();
    await owner.close();
  }
});
