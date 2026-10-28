import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Table state as staff and guests see it. A table's ordering code is a credential,
 * so the suite reads it off the staff screen that already shows it to staff instead
 * of querying the database for secrets.
 */

export type SeatingTarget = {
  label: string;
  token: string;
  orderUrl: string;
};

/** One floor tile, by table label. */
export function floorTile(owner: Page, label: string): Locator {
  return owner
    .locator("section.card")
    .filter({ has: owner.getByRole("heading", { level: 2, name: `Table ${label}`, exact: true }) })
    .first();
}

/**
 * Picks a table a guest can actually sit at — nobody seated, and not left for
 * clearing by an earlier run, because the app refuses a scan of such a table —
 * and reads its ordering link and code from the "Order link & QR" panel the app
 * offers staff.
 */
export async function pickFreeTable(owner: Page): Promise<SeatingTarget> {
  await owner.goto("/admin/floor");
  await expect(owner.getByRole("heading", { level: 1, name: "Floor" })).toBeVisible({ timeout: 90_000 });

  // The badge is the only thing that separates a table a guest can scan from one
  // marked as needing clearing or out of service; both still say "No party seated".
  const freeTiles = owner
    .locator("section.card")
    .filter({ hasText: "No party seated" })
    .filter({ hasNotText: "Needs clearing" })
    .filter({ hasNotText: "Out of service" });
  const available = await freeTiles.count();
  expect(available, "the floor board should have a free table to seat a test party at").toBeGreaterThan(0);

  // The last free tile is the least contested: the demo seed keeps its live
  // sessions on the earlier tables.
  const tile = freeTiles.nth(available - 1);
  const label = (await tile.getByRole("heading", { level: 2 }).first().innerText())
    .replace(/^Table\s+/i, "")
    .trim();

  await tile.getByRole("button", { name: /Order link & QR/ }).click();
  const orderUrl = await tile.locator("a[href*='table=']").first().getAttribute("href");
  const token = (await tile.locator("p.font-mono").first().innerText()).trim();

  expect(orderUrl, `table ${label} should publish an ordering link`).toMatch(/[?&]table=/);
  expect(token, `table ${label} should show its staff-only ordering code`).toMatch(/^[A-Za-z0-9]{8,64}$/);

  return { label, token, orderUrl: orderUrl as string };
}

/**
 * Opens a table's ordering link on a guest's own device and waits for the screen to
 * say which table it is. The app seats the device itself when `?table=` is present,
 * so this is all that scanning the sticker does.
 */
async function seat(guest: Page, target: SeatingTarget): Promise<void> {
  await guest.goto(`/order?table=${target.token}`);
  await expect(guest.locator("p.notice-ok"))
    .toContainText(new RegExp(`table ${escapeRegExp(target.label)}`, "i"), { timeout: 90_000 });
  await expect(guest.getByRole("heading", { level: 2, name: `Table ${target.label}` })).toBeVisible();
}

/** A first device on the sticker: it opens the visit. */
export async function seatAtTable(guest: Page, target: SeatingTarget): Promise<void> {
  await seat(guest, target);
  await expect(guest.locator("p.notice-ok")).toContainText(/now open for your visit/i, { timeout: 30_000 });
}

/** A second device on the same sticker: it joins the visit already open. */
export async function joinExistingTable(guest: Page, target: SeatingTarget): Promise<void> {
  await seat(guest, target);
  await expect(guest.locator("p.notice-ok")).toContainText(/You are ordering with/i, { timeout: 30_000 });
}

/** The card holding the orders everyone at this table can see. */
export function sharedOrdersCard(page: Page): Locator {
  return page.locator("div.card").filter({ has: page.getByRole("heading", { name: "Orders at this table" }) }).first();
}

/** Order numbers on that list; one `p.font-semibold` per order. */
export function sharedOrderNumbers(page: Page): Promise<string[]> {
  return sharedOrdersCard(page)
    .locator("li p.font-semibold")
    .allInnerTexts()
    .then((texts) => texts.map((text) => text.trim()));
}

/**
 * Sends this device's cart and returns the order number the table gained. Waiting on
 * the app's own 8-second refresh is the point: a screen that never shows the order
 * is a failure, not a reason to sleep.
 */
export async function sendCartToKitchen(page: Page): Promise<string> {
  const before = await sharedOrderNumbers(page);
  const send = page.getByRole("button", { name: /Send \d+ dish(?:es)? to the kitchen/ });
  await expect(send, "the table screen should offer to send this device's dishes").toBeVisible({ timeout: 30_000 });
  await send.click();

  await expect
    .poll(async () => (await sharedOrderNumbers(page)).filter((number) => !before.includes(number)).length, {
      timeout: 90_000,
      message: "the table's order list should gain exactly the order just sent",
    })
    .toBe(1);

  return (await sharedOrderNumbers(page)).find((number) => !before.includes(number)) as string;
}

/** A ticket on the kitchen board, by the number the guest was given. */
export function kitchenTicket(page: Page, orderNumber: string): Locator {
  return page.locator("article.card").filter({ has: page.getByText(orderNumber, { exact: true }) }).first();
}

export function kitchenColumn(page: Page, title: "New" | "Cooking" | "Ready"): Locator {
  return page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { level: 2, name: new RegExp(`^${title}`) }) })
    .first();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Puts a table back on the floor as "Free", the way staff do from the same tile.
 * Needed because closing a session leaves the table for clearing, and a run that
 * stops there hands the next one a room with fewer usable tables than the
 * availability grid says it has.
 */
export async function reopenTable(owner: Page, target: SeatingTarget): Promise<void> {
  const tile = floorTile(owner, target.label);
  // The board reloads itself after the close, so wait for the tile to be back in
  // staff-hand rather than reading a badge that has not landed yet.
  await expect(tile.getByRole("button", { name: "Set table status" })).toBeVisible({ timeout: 60_000 });
  if ((await tile.getByText("Needs clearing", { exact: true }).count()) === 0) return;

  await tile.getByRole("button", { name: "Set table status" }).click();
  await tile.getByLabel("Floor state").selectOption({ label: "Free" });
  await tile.getByRole("button", { name: "Save the state" }).click();
  await expect(tile).toContainText(`Table ${target.label} marked Free`, { timeout: 60_000 });
}

/**
 * Ends a visit the way floor staff do, so a spec leaves the table free for the next
 * run instead of accumulating half-finished parties in the demo room. The reason is
 * stated as it is: a test party that paid nothing at the counter has not "settled"
 * anything unless the suite really settled a bill first.
 */
export async function closeSession(
  owner: Page,
  target: SeatingTarget,
  reason: "Closed manually" | "Bill settled" | "Left without paying",
): Promise<void> {
  // Opened rather than reloaded, because the spec that finishes a visit is not
  // necessarily standing on the floor board when it gets here — the payment journey
  // goes off to read the day's takings first.
  await owner.goto("/admin/floor");
  const tile = floorTile(owner, target.label);
  await tile.getByRole("button", { name: "Close session" }).click();
  await tile.getByLabel("Why is this visit ending?").selectOption({ label: reason });
  await tile.getByRole("button", { name: "Close the session" }).click();
  await expect(tile).toContainText(`Table ${target.label} was cleared`, { timeout: 60_000 });
  await reopenTable(owner, target);
}
