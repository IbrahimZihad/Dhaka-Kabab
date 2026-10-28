import { expect, test } from "@playwright/test";

import { runTag, testMobile } from "./support/money";
import { recordFinding } from "./support/staff";
import { addQuickDish } from "./support/shop";

/**
 * Scenario 5 — the app's empty and invalid states.
 *
 * Each of these is the screen a real guest gets when a link has expired, a code was
 * misread or a number was typed badly. The test is the same in every case: the app
 * says something true, and does not do the thing that was not allowed.
 */
test.describe("empty and invalid states", () => {
  test("an unknown tracking token is turned away without a stack trace", async ({ page }) => {
    const response = await page.goto("/track/e2enotarealorder1");
    const body = page.locator("body");

    await expect(page.getByRole("heading", { level: 1, name: "There is no page here" })).toBeVisible({
      timeout: 90_000,
    });
    await expect(body).not.toContainText(/Application error|digest|Minified React error|TypeError:|PrismaClient/i);
    // The leak this guards against is a real order card, which titles itself
    // "Order <number>" — not the ordinary words "Order at a table" the site's own
    // navigation and footer legitimately show on a 404.
    await expect(page.getByRole("heading", { level: 2, name: /^Order / })).toHaveCount(0);
    // The 404's own doors, not the site chrome: header and footer repeat the same
    // three links on every page, so a page-wide query matches all of them at once.
    await expect(page.locator("main").getByRole("link", { name: "Track an order" })).toBeVisible();

    if (response && response.status() !== 404) {
      recordFinding(
        `An unknown order token renders the not-found screen but answers HTTP ${response.status()}, not 404, ` +
          "so a crawler or a monitor cannot tell a dead link from a live page.",
      );
    }
  });

  test("the tracking form refuses a code that is not a code before going anywhere", async ({ page }) => {
    await page.goto("/track");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 90_000 });

    const field = page.getByLabel(/code/i).first();
    await expect(field).toBeVisible();
    await field.fill("12");
    await page.getByRole("button", { name: /Find my order/i }).click();

    await expect(page.getByText("That does not look like a code", { exact: false })).toBeVisible();
    await expect(page, "a code too short to be one must not be sent to the server").toHaveURL(/\/track$/);
  });

  test("a table link that is not a table link says so", async ({ page }) => {
    await page.goto("/order?table=not-a-real-token");
    const notice = page.locator("p.notice-error").first();
    await expect(notice, "the ordering screen should refuse a bad sticker link").toBeVisible({ timeout: 90_000 });
    await expect(notice).toContainText(/invalid link|not recognised/i);
    await expect(page.getByRole("heading", { level: 2, name: /^Table / })).toHaveCount(0);

    // An unknown but well-formed code is refused by the lookup, not the validator.
    await page.goto("/order?table=e2enotatable1");
    await expect(page.locator("p.notice-error").first()).toContainText(/invalid link|not recognised/i, {
      timeout: 60_000,
    });
  });

  test("an empty cart stays empty and offers the doors that exist", async ({ page }) => {
    await page.goto("/cart");
    await expect(page.getByRole("heading", { level: 2, name: "Your order is empty" })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Browse the menu" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review and place order" })).toHaveCount(0);
  });

  test("a bad mobile number is stopped at the form, not submitted", async ({ page }) => {
    const tag = runTag();
    await addQuickDish(page);
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { level: 1, name: "Place your order" })).toBeVisible({ timeout: 60_000 });

    await page.getByLabel("Takeaway — collect from the counter").check();
    await page.locator("#ck-name").fill(`E2e Bad Number ${tag}`);

    await page.locator("#ck-phone").fill("12345");
    await page.getByRole("button", { name: "Place the order" }).click();
    await expect(page.getByText("Enter a Bangladeshi mobile number, e.g. 01712345678.", { exact: true })).toBeVisible();
    await expect(page, "the order must not be placed").toHaveURL(/\/checkout$/);

    // A number-shaped lie is also refused: this one starts with a dead prefix.
    await page.locator("#ck-phone").fill("01212345678");
    await page.getByRole("button", { name: "Place the order" }).click();
    await expect(page.getByText("Enter a Bangladeshi mobile number", { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/\/checkout$/);

    // The name is checked too, and the cart is still intact — nothing was half-sent.
    await page.locator("#ck-phone").fill(testMobile(tag));
    await page.locator("#ck-name").fill("x");
    await page.getByRole("button", { name: "Place the order" }).click();
    await expect(page.getByText("Please enter a name for the order.", { exact: true })).toBeVisible();
    // The checkout's own figure, not the sidebar's identical label: the cart survived every refusal.
    await expect(page.getByText(/^Food subtotal: /)).toBeVisible();

    await expect(page.locator("article.card")).toHaveCount(0);
  });

  test("the payment screen without a payment reference sends the guest back to the table", async ({ page }) => {
    await page.goto("/pay/simulated");
    await expect(page.getByRole("heading", { level: 1, name: "Simulated payment" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("This page needs a payment reference", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve payment" })).toHaveCount(0);
  });
});
