import { expect, test, type Page } from "@playwright/test";

import { POLL, REFRESH_TIMEOUT } from "./support/env";
import { guestContext, staffContext } from "./support/staff";
import { addQuickDish } from "./support/shop";
import {
  closeSession,
  floorTile,
  joinExistingTable,
  kitchenTicket,
  pickFreeTable,
  seatAtTable,
  sendCartToKitchen,
  sharedOrderNumbers,
} from "./support/tables";

/**
 * Scenario 2 — ordering from the QR sticker, with seat isolation.
 *
 * The sticker's link is the whole of a guest's authority: it seats that device at one
 * table, opens the visit if nobody has opened it yet, and adds a participant rather
 * than taking over whoever is already there. Two browsers on one link therefore share
 * a visit and, in time, its orders and bill — while each keeps its own unsent dishes,
 * which is exactly what the app's own copy promises.
 */

/** The visit line the guest's table screen prints, e.g. "Visit ABC-123 · 2 guests". */
function visitLine(page: Page): Promise<string> {
  return page.locator("p.hint").filter({ hasText: /^Visit / }).first().innerText().then((text) => text.trim());
}

test.describe.serial("QR table ordering", () => {
  test("a sticker seats the device that scanned it and opens the visit", async ({ browser }) => {
    const owner = await staffContext(browser, "owner");
    const ownerPage = await owner.newPage();
    const target = await pickFreeTable(ownerPage);

    const device = await guestContext(browser);
    const guest = await device.newPage();
    await seatAtTable(guest, target);

    expect(await visitLine(guest), "the table screen should name the visit it belongs to").toMatch(
      /^Visit \S+ · \d+ guests?/,
    );

    await addQuickDish(guest);
    await guest.goto("/order");
    const number = await sendCartToKitchen(guest);
    expect(number, "the table should gain a numbered order").toMatch(/[A-Za-z0-9-]{4,}/);
    await expect(guest.locator("div.card").filter({ hasText: "Orders at this table" })).toContainText(number);

    await closeSession(ownerPage, target, "Closed manually");
    await owner.close();
    await device.close();
  });

  test("a second device joins the same visit, keeps its own basket, and staff see both orders", async ({
    browser,
  }) => {
    const owner = await staffContext(browser, "owner");
    const ownerPage = await owner.newPage();
    const target = await pickFreeTable(ownerPage);

    const first = await guestContext(browser);
    const deviceA = await first.newPage();
    await seatAtTable(deviceA, target);
    await addQuickDish(deviceA);
    await deviceA.goto("/order");
    const numberA = await sendCartToKitchen(deviceA);

    // Second phone, same sticker.
    const second = await guestContext(browser);
    const deviceB = await second.newPage();
    await joinExistingTable(deviceB, target);

    // Same visit on both devices, so B really did join A's table and not open its own.
    const visitA = await visitLine(deviceA);
    await expect.poll(() => visitLine(deviceB), { timeout: REFRESH_TIMEOUT }).toBe(visitA);

    // …but a separate participant: B has queued nothing of its own, and A's queue
    // never travelled to B's device.
    await expect(deviceB.getByText("Nothing in your list right now", { exact: false })).toBeVisible();
    await expect(deviceB.getByRole("button", { name: /Send \d+ dish(?:es)? to the kitchen/ })).toHaveCount(0);
    await expect(deviceB.getByText(numberA, { exact: false })).toBeVisible();

    // B builds its own list; A is left with nothing unsent.
    const dishB = await addQuickDish(deviceB);
    await deviceB.goto("/order");
    await expect(deviceB.locator("div.card").filter({ hasText: "Your dishes, not yet sent" })).toContainText(dishB.name);
    await deviceA.reload();
    await expect(deviceA.getByText("Nothing in your list right now", { exact: false })).toBeVisible();

    const numberB = await sendCartToKitchen(deviceB);
    expect(numberB, "two sends must make two orders").not.toBe(numberA);

    // The table's order list is shared, so both devices see both orders once their own
    // eight-second polling lands.
    await expect
      .poll(async () => (await sharedOrderNumbers(deviceA)).includes(numberB), {
        timeout: REFRESH_TIMEOUT,
        message: "device A should see the order device B sent",
      })
      .toBe(true);
    await expect.poll(async () => (await sharedOrderNumbers(deviceB)).includes(numberA), {
      timeout: REFRESH_TIMEOUT,
    }).toBe(true);

    // Kitchen: both tickets, addressed to this table, and no money on either.
    const kitchen = await staffContext(browser, "owner");
    const cook = await kitchen.newPage();
    await cook.goto("/kitchen");
    await expect(cook.getByRole("heading", { level: 1, name: "Kitchen" })).toBeVisible({ timeout: 90_000 });
    for (const number of [numberA, numberB]) {
      await expect
        .poll(
          async () => {
            await cook.reload();
            return (await kitchenTicket(cook, number).count()) === 1;
          },
          { timeout: REFRESH_TIMEOUT + POLL.kitchen, message: `the kitchen should receive ${number}` },
        )
        .toBe(true);
      const ticket = kitchenTicket(cook, number);
      await expect(ticket.getByText(`Table ${target.label}`, { exact: true })).toBeVisible();
      await expect(ticket.locator("span.badge").nth(1)).toContainText(/Received|Confirmed|Cooking|Ready/);
      await expect(ticket.getByText("৳", { exact: false })).toHaveCount(0);
    }

    // Floor: one visit, two devices joined, both orders with their status badges.
    await ownerPage.reload();
    const tile = floorTile(ownerPage, target.label);
    await expect(tile.getByText(/2 devices joined/)).toBeVisible();
    await expect(tile.getByText(numberA, { exact: true })).toBeVisible();
    await expect(tile.getByText(numberB, { exact: true })).toBeVisible();

    await closeSession(ownerPage, target, "Closed manually");
    await kitchen.close();
    await owner.close();
    await first.close();
    await second.close();
  });
});
