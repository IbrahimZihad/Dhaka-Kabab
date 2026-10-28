import { expect, test } from "@playwright/test";

import { closeDb, readItemWithPaidAddon, readOrderByNumber, readSettings, readTableForOrdering } from "./support/db";
import { REFRESH_TIMEOUT, ownerCredential } from "./support/env";
import { runTag } from "./support/money";
import { expectSignedInAs, guestContext, signIn } from "./support/staff";

/**
 * The staff side of the counter: the door, the boards behind it, and what is left
 * when someone walks out of it.
 *
 * Nobody here is handed a cookie. The owner comes in through the real login form
 * with the credential the developer keeps in `.env`, and the order the kitchen
 * moves is one a guest placed minutes earlier through the public ordering endpoint,
 * so the ticket on the board is the same row the guest's phone is watching. What
 * the cook must never see is a price, and what a signed-out person must never see
 * is a board.
 */

/** What the board calls a status, written out again on purpose rather than borrowed. */
const STAFF_LABELS: Record<string, string> = {
  PENDING: "Received",
  CONFIRMED: "Confirmed",
  PREPARING: "Cooking",
  READY: "Ready",
  SERVED: "Served",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** The one step a ticket may be pushed to from here, and the button that does it. */
const NEXT_STEP: Record<string, { button: string; to: string; column: RegExp }> = {
  PENDING: { button: "Confirm", to: "CONFIRMED", column: /^New/ },
  CONFIRMED: { button: "Start", to: "PREPARING", column: /^Cooking/ },
  PREPARING: { button: "Ready", to: "READY", column: /^Ready/ },
};

test.afterAll(async () => {
  await closeDb();
});

test("the staff door opens on the panels, and closes them again on sign-out", async ({ page }) => {
  await signIn(page, ownerCredential());

  await expect(page.getByRole("heading", { level: 1, name: "Today", exact: true })).toBeVisible({ timeout: 90_000 });
  await expectSignedInAs(page, "Owner");
  await expect(page.getByText("Signed in as Owner", { exact: false })).toBeVisible();

  await page.goto("/admin/floor");
  await expect(page.getByRole("heading", { level: 1, name: "Floor", exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Every table in the room", { exact: false })).toBeVisible();
  expect(await page.locator("section.card").filter({ has: page.getByRole("heading", { level: 2, name: /^Table / }) }).count(), "the board lists the room").toBeGreaterThan(0);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  // Both guarded screens now bounce to the login form rather than showing a shell.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Today", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();

  await page.goto("/kitchen");
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Kitchen", exact: true })).toHaveCount(0);
});

test("a guest's order reaches the kitchen board, and the step a cook takes shows on the floor", async ({ browser, request }) => {
  const [settings, table, dish] = await Promise.all([readSettings(), readTableForOrdering(), readItemWithPaidAddon()]);
  const tag = runTag();

  const group = dish.groups.find((entry) => entry.options.some((option) => option.priceDeltaPoisa > 0));
  const extra = group?.options.find((option) => option.priceDeltaPoisa > 0);
  if (!group || !extra) throw new Error(`${dish.name} should have carried a paid extra.`);

  // The guest places it through the public endpoint, exactly as the table screen does.
  const placed = await request.post("/api/orders", {
    data: {
      type: "DINE_IN",
      tableToken: table.publicToken,
      items: [{ menuItemId: dish.id, quantity: 1, options: [{ groupId: group.id, optionId: extra.id }] }],
      specialInstructions: `Birthday table, marker ${tag}`,
      idempotencyKey: `e2e-staff-${tag}`,
    },
  });
  expect(placed.status(), "the guest's order was accepted").toBe(201);
  const orderNumber: string = ((await placed.json()) as { data: { order: { orderNumber: string } } }).data.order.orderNumber;
  expect(orderNumber, "the order is named").toBeTruthy();

  // This test ends by signing out, and signing out deletes the session it is holding.
  // The owner state written by the setup project is shared by every later spec, so
  // borrowing it here would revoke the owner for the rest of the run and the next
  // staff screen would report a bounced session instead of the flow it came to test.
  // The cook therefore opens its own door, through the same login form.
  const context = await guestContext(browser);
  const page = await context.newPage();
  try {
    await signIn(page, ownerCredential());

    await page.goto("/kitchen");
    await expect(page.getByRole("heading", { level: 1, name: "Kitchen", exact: true })).toBeVisible({ timeout: 90_000 });

    const ticket = page.locator("article").filter({ has: page.getByText(orderNumber, { exact: true }) });
    await expect(ticket).toBeVisible({ timeout: 60_000 });

    const arrived = await readOrderByNumber(orderNumber);
    const step = NEXT_STEP[arrived.status];
    if (!step) throw new Error(`Order ${orderNumber} arrived as ${arrived.status}, which the kitchen cannot advance.`);

    await expect(ticket.getByText(`Table ${table.label}`, { exact: false })).toBeVisible();
    await expect(ticket.getByText(STAFF_LABELS[arrived.status], { exact: true })).toBeVisible();
    await expect(ticket.getByText(`1× ${dish.name}`, { exact: false })).toBeVisible();
    // The add-on the guest paid for has to reach the person cooking it.
    await expect(ticket.getByText(`with ${extra.name}`, { exact: false })).toBeVisible();
    await expect(ticket.getByText(`Birthday table, marker ${tag}`, { exact: false })).toBeVisible();

    // A cook reads dishes, not the restaurant's margins.
    await expect(ticket.getByText(settings.currencySymbol, { exact: false })).toHaveCount(0);
    expect(arrived.contactName ?? "", "a table order carries no guest name to leak").toBe("");

    await ticket.getByRole("button", { name: step.button, exact: true }).click();

    const column = page.locator("section.card").filter({ has: page.getByRole("heading", { level: 2, name: step.column }) });
    const movedTicket = column.locator("article").filter({ hasText: orderNumber });
    await expect(movedTicket).toBeVisible({ timeout: REFRESH_TIMEOUT });
    // The 15-second poll replaces the board; the add-on must survive that refresh.
    // Scoped to this ticket — other columns and other tickets carry the same add-on name.
    await expect(movedTicket.getByText(`with ${extra.name}`, { exact: false })).toBeVisible({ timeout: REFRESH_TIMEOUT });

    const moved = await readOrderByNumber(orderNumber);
    expect(moved.status, "the server took the step, not just the screen").toBe(step.to);
    expect(moved.table?.label).toBe(table.label);

    await page.goto("/admin/floor");
    const tile = page.locator("section.card").filter({ has: page.getByRole("heading", { level: 2, name: `Table ${table.label}`, exact: true }) });
    const row = tile.locator("li").filter({ hasText: orderNumber });
    await expect(row).toBeVisible({ timeout: 90_000 });
    await expect(row.getByText(STAFF_LABELS[step.to], { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

    // Signed out, the board is not merely empty — it is not reachable at all.
    await page.goto("/kitchen");
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Kitchen", exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
