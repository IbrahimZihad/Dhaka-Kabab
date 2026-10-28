import { expect, test } from "@playwright/test";

import { REFRESH_TIMEOUT } from "./support/env";
import { moneyText, runTag, testMobile } from "./support/money";
import { guestContext, staffContext } from "./support/staff";
import { addQuickDish } from "./support/shop";
import { closeSession, floorTile, pickFreeTable, seatAtTable, sendCartToKitchen } from "./support/tables";

/**
 * Scenario 1's payment half, driven through the door the product really has.
 *
 * This installation has no bank configured, so online payment runs on the bundled
 * simulated gateway — and every screen that touches it says so out loud. The path a
 * guest can actually walk is a table's bill: order at the table, staff draw the bill
 * up, staff finalize it, only then may the guest pay online, and the gateway's own
 * verified notification (not the redirect) is what settles the money.
 *
 * FINDING, reported rather than papered over: a TAKEAWAY order has no way to reach a
 * gateway at all. Bills are only ever created for a table session
 * (`getOrCreateOpenBill(sessionId)` is the single `bill.create` in the service), the
 * guest's online payment needs a finalized bill for *its* session, and the counter's
 * "Pay online" panel only exists on a bill screen. So the takeaway checkout that this
 * suite also covers can only ever be paid in person; the order page's own hint sends
 * staff to "bills and payments", where no such bill can be raised.
 */
test.describe.serial("simulated gateway, from a table bill to a settled payment", () => {
  const tag = runTag();

  test("the gateway is only entered through a finalized bill, and pays in simulation", async ({ browser }) => {
    const owner = await staffContext(browser, "owner");
    const ownerPage = await owner.newPage();
    const target = await pickFreeTable(ownerPage);

    const guest = await guestContext(browser);
    const table = await guest.newPage();
    await seatAtTable(table, target);
    await addQuickDish(table);
    await table.goto("/order");
    const orderNumber = await sendCartToKitchen(table);
    expect(orderNumber, "the table needs an order before it can be billed").toMatch(/[A-Za-z0-9-]{4,}/);

    // ------------------------------------------------------------ staff draw it up
    await ownerPage.goto("/admin/floor");
    const tile = floorTile(ownerPage, target.label);
    await tile.getByRole("button", { name: /Draw up the bill|Refresh the bill/ }).click();
    await tile.getByRole("button", { name: "Draw up / refresh the bill" }).click();
    await expect(tile).toContainText("was drawn up from its orders", { timeout: 60_000 });

    const billNumber = await ownerPage
      .locator("a[href^='/admin/bills/']")
      .filter({ hasText: /Open the bill/ })
      .getAttribute("href");
    expect(billNumber, "the floor tile should link to the bill it just raised").toBeTruthy();
    await ownerPage.goto(billNumber as string);
    await expect(ownerPage.getByText("Open", { exact: true }).first())
      .toBeVisible({ timeout: 60_000 });

    // ------------------------------------------------- an open bill cannot be paid
    const billCard = table.locator("div.card").filter({ hasText: "The bill" });
    await expect(billCard.getByText("Outstanding", { exact: true })).toBeVisible({ timeout: REFRESH_TIMEOUT });
    const payButton = table.getByRole("button", { name: /^Pay .* online$/ });
    await expect(payButton, "the guest should be offered the outstanding amount").toBeVisible();
    await payButton.click();
    await table.getByPlaceholder("Your name").fill(`E2e Payer ${tag}`);
    await table.getByPlaceholder("Mobile number").fill(testMobile(tag));
    await table.getByPlaceholder("Email for the receipt").fill(`e2e.${tag}@example.test`);
    await table.getByRole("button", { name: "Continue to the bank" }).click();

    await expect(table.getByText("not finalized yet", { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(table, "a refusal must not hand the guest to a payment page").toHaveURL(/\/order/);

    // --------------------------------------------------------- staff finalize it
    await ownerPage.reload();
    await ownerPage.getByRole("button", { name: "Finalize this bill" }).click();
    await expect(ownerPage.getByText("This bill is finalized", { exact: false })).toBeVisible({ timeout: 60_000 });

    // ------------------------------------------------------------ the hand-off
    await expect(payButton, "a finalized bill may be paid online from the table").toBeVisible({
      timeout: REFRESH_TIMEOUT,
    });
    const outstanding = (await payButton.innerText()).trim();
    await payButton.click();
    await table.getByPlaceholder("Your name").fill(`E2e Payer ${tag}`);
    await table.getByPlaceholder("Mobile number").fill(testMobile(tag));
    await table.getByPlaceholder("Email for the receipt").fill(`e2e.${tag}@example.test`);
    await table.getByRole("button", { name: "Continue to the bank" }).click();

    await table.waitForURL(/\/pay\/simulated\?ref=/, { timeout: 60_000 });
    const reference = new URL(table.url()).searchParams.get("ref");
    expect(reference, "the hand-off carries the payment's own reference").toBeTruthy();

    // Every claim this page makes about itself: a stand-in, labelled as one.
    await expect(table.getByText("Development gateway", { exact: true })).toBeVisible();
    await expect(table.getByRole("heading", { level: 1, name: "Simulated payment" })).toBeVisible();
    await expect(table.getByText(/no payment provider is configured/i)).toBeVisible();
    await expect(table.getByText("Nothing here touches a card", { exact: false })).toBeVisible();
    await expect(table.getByText(/flagged as simulated/i)).toBeVisible();
    await expect(table.getByText(outstanding, { exact: false }).first()).toBeVisible();

    await table.getByRole("button", { name: "Approve payment" }).click();
    await expect(table.getByText(/returning you to the restaurant/i)).toBeVisible({ timeout: 60_000 });
    await table.waitForURL(/\/order(\?|$)/, { timeout: 30_000 });

    // The notification, not the redirect, is what settles the bill.
    await expect(billCard.getByText(/settled/i)).toBeVisible({ timeout: REFRESH_TIMEOUT });
    await expect(billCard.getByText("Outstanding", { exact: true })).toBeVisible();

    // ------------------------------------------------------------------ the ledger
    await ownerPage.reload();
    await expect(ownerPage.getByText("Settled", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(ownerPage.getByText("Simulated", { exact: true }).first()).toBeVisible();
    await expect(ownerPage.getByText(/not real money|simulated/i).first()).toBeVisible();

    // The day's takings must separate simulated money from real money, out loud.
    await ownerPage.goto("/admin");
    await expect(ownerPage.getByRole("heading", { level: 1, name: "Today" })).toBeVisible({ timeout: 90_000 });
    const collected = ownerPage
      .locator("div, section")
      .filter({ has: ownerPage.getByText("Actually collected", { exact: true }) })
      .last();
    await expect(collected).toContainText(/simulated gateway and is not real money|Counter and verified online/i);
    const attention = ownerPage.getByRole("heading", { level: 2, name: "Needs someone's attention" });
    await expect(attention).toBeVisible();

    await closeSession(ownerPage, target, "Bill settled");
    expect(
      await moneyText(table.locator("div.card").filter({ hasText: "The bill" })).count(),
      "the guest's own bill panel is expected to show amounts",
    ).toBeGreaterThan(0);

    await owner.close();
    await guest.close();
  });
});
