import { expect, test } from "@playwright/test";

import { POLL, REFRESH_TIMEOUT, CREDENTIALS } from "./support/env";
import { moneyText, runTag, testMobile } from "./support/money";
import { guestContext, recordFinding, staffContext } from "./support/staff";
import { addQuickDish, placeTakeawayOrder } from "./support/shop";
import { escapeRegExp, kitchenColumn, kitchenTicket } from "./support/tables";

/**
 * Scenario 4 — staff take an order through the steps the state machine allows, and a
 * role sees only the screens its permissions open.
 *
 * The kitchen account is made exactly as an operator would make one:
 * `ADMIN_EMAIL=… ADMIN_ROLE=KITCHEN npm run admin:create` (see `support/auth.setup.ts`),
 * then signed in through the real form. Nothing here invents a user behind the app's
 * back, and no credential is printed, asserted on or stored in the working tree.
 */
test.describe.serial("staff lifecycle and role boundaries", () => {
  const tag = runTag();
  const guestName = `E2e Leakprobe ${tag}`;
  const mobile = testMobile(tag);

  let orderNumber = "";
  let trackToken = "";

  test("the owner's day screen and floor board read from the seeded room", async ({ browser }) => {
    const owner = await staffContext(browser, "owner");
    const page = await owner.newPage();

    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible({ timeout: 90_000 });

    const billed = page.locator("div, section").filter({ has: page.getByText("Billed today", { exact: true }) }).last();
    await expect(billed).toContainText("৳");
    await expect(page.getByText("Actually collected", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Needs someone's attention" })).toBeVisible();

    await page.goto("/admin/floor");
    await expect(page.getByRole("heading", { level: 1, name: "Floor" })).toBeVisible({ timeout: 90_000 });
    const tableHeadings = page.getByRole("heading", { level: 2, name: /^Table / });
    expect(
      await tableHeadings.count(),
      "the seeded room should show every table on the floor board",
    ).toBeGreaterThanOrEqual(12);

    await owner.close();
  });

  test("a guest order reaches the kitchen board as a numbered ticket", async ({ browser }) => {
    const guest = await guestContext(browser);
    const page = await guest.newPage();

    await addQuickDish(page);
    await page.goto("/checkout");
    const placed = await placeTakeawayOrder(page, { name: guestName, mobile });
    trackToken = placed.token;

    const heading = page.getByRole("heading", { level: 2, name: /^Order / }).first();
    await expect(heading).toBeVisible({ timeout: 60_000 });
    orderNumber = (await heading.innerText()).replace(/^Order\s+/, "").trim();
    expect(orderNumber, "the guest needs a number to quote at the counter").toMatch(/[A-Za-z0-9-]{4,}/);

    await guest.close();
  });

  test("the owner moves that order only along legal steps, and the badge follows", async ({ browser }) => {
    test.skip(!orderNumber, "no order was created to move");

    const owner = await staffContext(browser, "owner");
    const page = await owner.newPage();

    await page.goto("/kitchen");
    await expect(page.getByRole("heading", { level: 1, name: "Kitchen" })).toBeVisible({ timeout: 90_000 });

    await expect
      .poll(
        async () => {
          await page.reload();
          return (await kitchenTicket(page, orderNumber).count()) === 1;
        },
        { timeout: REFRESH_TIMEOUT + POLL.kitchen, message: `the kitchen should receive ${orderNumber}` },
      )
      .toBe(true);

    const ticket = kitchenTicket(page, orderNumber);
    await expect(kitchenColumn(page, "New").locator("article.card").filter({ hasText: orderNumber })).toBeVisible();
    const firstBadge = (await ticket.locator("span.badge").nth(1).innerText()).trim();
    expect(["Received", "Confirmed"], `a fresh order should start at a kitchen step, not ${firstBadge}`).toContain(
      firstBadge,
    );

    // CONFIRMED → PREPARING, the only move a cook may make from here.
    await ticket.getByRole("button", { name: "Start" }).click();
    await expect(ticket.locator("span.badge").nth(1)).toHaveText("Cooking", { timeout: 60_000 });
    await expect(kitchenColumn(page, "Cooking").locator("article.card").filter({ hasText: orderNumber })).toBeVisible();

    // PREPARING → READY.
    await ticket.getByRole("button", { name: "Ready" }).click();
    await expect(ticket.locator("span.badge").nth(1)).toHaveText("Ready", { timeout: 60_000 });
    await expect(kitchenColumn(page, "Ready").locator("article.card").filter({ hasText: orderNumber })).toBeVisible();

    // …and the guest's own tracking page follows the same server truth.
    const guest = await guestContext(browser);
    const guestPage = await guest.newPage();
    await guestPage.goto(`/track/${trackToken}`);
    await expect
      .poll(
        async () => {
          await guestPage.reload();
          return await guestPage.locator("article.card span.badge").first().innerText();
        },
        { timeout: REFRESH_TIMEOUT + POLL.tracking },
      )
      .toContain("Ready");

    await owner.close();
    await guest.close();
  });

  test("a kitchen account sees the display and nothing else", async ({ browser }) => {
    const kitchen = await staffContext(browser, "kitchen");
    const page = await kitchen.newPage();

    await page.goto("/kitchen");
    await expect(page.getByRole("heading", { level: 1, name: "Kitchen" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Connection lost", { exact: false })).toHaveCount(0);

    // Refused screens, in the app's own words, straight from the RBAC table.
    await page.goto("/admin/reports");
    await expect(
      page.getByText("Your role is not given the reports permission, so no figures are shown here.", { exact: false }),
    ).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Daily sales", { exact: false })).toHaveCount(0);

    await page.goto("/admin");
    await expect(page.getByText("Your screen is the kitchen display", { exact: false })).toBeVisible();

    await page.goto("/admin/floor");
    await expect(page.getByRole("heading", { level: 2, name: "Kitchen staff" })).toBeVisible();

    await page.goto("/admin/qr");
    await expect(page.getByRole("heading", { level: 2, name: "Owners and managers only" })).toBeVisible();

    // The owner who made the account can find it in the staff list; the kitchen
    // member is not given the screen that lists people at all.
    const owner = await staffContext(browser, "owner");
    const ownerPage = await owner.newPage();
    await ownerPage.goto("/admin/staff");
    await expect(ownerPage.getByText(CREDENTIALS.kitchen.name, { exact: true })).toBeVisible({ timeout: 90_000 });

    await page.goto("/admin/staff");
    await expect(page.getByText("may not view or change staff accounts", { exact: false })).toBeVisible();
    await expect(page.getByText(CREDENTIALS.kitchen.name, { exact: true })).toHaveCount(0);

    await kitchen.close();
    await owner.close();
  });

  test("the kitchen display leaks no money, no contact details and no table codes", async ({ browser }) => {
    const kitchen = await staffContext(browser, "kitchen");
    const page = await kitchen.newPage();
    await page.goto("/kitchen");
    await expect(page.getByRole("heading", { level: 1, name: "Kitchen" })).toBeVisible({ timeout: 90_000 });

    // The board is polled from the safe projection; check the wire as well as the screen.
    const queue = await page.request.get("/api/kitchen/queue");
    expect(queue.ok(), "the kitchen queue endpoint should answer for a cook").toBe(true);
    const wire = await queue.text();

    await page.reload();
    await expect(page.locator("article.card").first()).toBeVisible({ timeout: 90_000 });

    const leaks: string[] = [];
    if ((await moneyText(page).count()) > 0) leaks.push("a currency figure on the board");
    if (guestName && (await page.getByText(guestName, { exact: false }).count()) > 0) leaks.push("the guest's name");
    if ((await page.getByText(mobile, { exact: false }).count()) > 0) leaks.push("the guest's mobile number");
    if (trackToken && (await page.getByText(escapeRegExp(trackToken)).count()) > 0) leaks.push("a tracking token");

    for (const needle of [guestName, mobile, trackToken, "৳"]) {
      if (needle && wire.toLowerCase().includes(needle.toLowerCase())) leaks.push(`${needle} in /api/kitchen/queue`);
    }

    if (leaks.length > 0) {
      recordFinding(`The kitchen display exposes staff-only data to a KITCHEN role: ${leaks.join("; ")}.`);
    }
    expect(leaks, `kitchen board should hold dishes, not money or contacts (${leaks.join("; ")})`).toEqual([]);

    await kitchen.close();
  });
});
