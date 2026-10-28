import { expect, test, type Page } from "@playwright/test";

import { runTag, testMobile } from "./support/money";

/**
 * Scenario 3 — a booking is verified by the restaurant, not by the form.
 *
 * The app's own claim is on the page: "Booking is a request, not a hold", and the free
 * times are only the ones the database could prove were free. So the suite never
 * invents a slot: it asks the same availability endpoint the form asks, books a slot
 * the server offered, and then shows that the room the booking consumed cannot be
 * booked again — as a disabled button carrying the server's reason, and as a refusal
 * from the endpoint itself.
 */

type Slot = { time: string; available: boolean; reason?: string };
type Availability = { dateKey: string; slots: Slot[]; closed: boolean; maxPartySize: number };

function localDateKey(offsetDays: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offsetDays);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

async function availabilityFor(page: Page, dateKey: string, partySize: number): Promise<Availability> {
  const answer = await page.request.get(
    `/api/reservations/availability?dateKey=${encodeURIComponent(dateKey)}&partySize=${partySize}`,
  );
  expect(answer.ok(), `the availability check for ${dateKey} should answer`).toBe(true);
  const body = (await answer.json()) as { data: Availability };
  return body.data;
}

/** A future day and a time that the server itself offered for the whole room. */
async function findRoomSizedSlot(
  page: Page,
): Promise<{ dateKey: string; time: string; partySize: number }> {
  const horizon = Math.min(14, Math.max(2, Number(process.env.E2E_RESERVATION_HORIZON ?? 10)));
  for (let offset = 2; offset <= horizon; offset += 1) {
    const dateKey = localDateKey(offset);
    const opening = await availabilityFor(page, dateKey, 2);
    if (opening.closed || opening.maxPartySize < 1) continue;

    const fullRoom = await availabilityFor(page, dateKey, opening.maxPartySize);
    const offered = fullRoom.slots.find((slot) => slot.available);
    if (offered) return { dateKey, time: offered.time, partySize: opening.maxPartySize };
  }
  throw new Error(
    "No day inside the booking window offered a slot that could seat the whole room, so this spec cannot prove " +
      "the room can be consumed. Try a different service day or check the table capacities.",
  );
}

test.describe.serial("reservations are server-verified", () => {
  test("a offered slot books, and the consumed room refuses the next party", async ({ page }) => {
    const tag = runTag();
    const guestName = `E2e Booking ${tag}`;
    const mobile = testMobile(tag);

    await page.goto("/reservations");
    await expect(page.getByRole("heading", { level: 1, name: "Book a table" })).toBeVisible({ timeout: 90_000 });

    const slot = await findRoomSizedSlot(page);

    // Fill the form the way a guest does, and let it refuse a bad number first.
    await page.locator("#rs-party").fill(String(slot.partySize));
    await page.locator("#rs-date").fill(slot.dateKey);

    const chosenSlot = page.getByRole("button", { name: new RegExp(`^${slot.time}$`) });
    await expect(chosenSlot, "the server should offer the slot it just reported as free").toBeEnabled({
      timeout: 60_000,
    });
    await page.locator("#rs-name").fill(guestName);
    await page.locator("#rs-phone").fill("12345");
    await chosenSlot.click();
    // The form will not submit at all until the guest has read the policy: the button
    // stays disabled, so ticking it is what makes the bad number an actual attempt.
    await page.locator("label.card").filter({ hasText: "I understand this is a" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request this table" }).click();
    await expect(page.getByText("Enter a Bangladeshi mobile number", { exact: false })).toBeVisible();
    await expect(page, "an invalid number must not reach the booking").toHaveURL(/\/reservations$/);

    await page.locator("#rs-phone").fill(mobile);
    await page.getByRole("button", { name: "Request this table" }).click();

    await page.waitForURL(/\/reserve\/confirm\?token=/, { timeout: 90_000 });
    const params = new URL(page.url()).searchParams;
    const code = params.get("code");
    expect(code, "the confirmation page needs the booking code in its link").toBeTruthy();

    await expect(page.getByRole("heading", { level: 1, name: "Your booking request" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: `Booking ${code}` })).toBeVisible();

    // Honest status: a request awaits a manager, and the page must not dress it up as
    // a confirmed table.
    const panel = page.locator("div.card, section.card").filter({ hasText: `Booking ${code}` }).first();
    await expect(panel.getByText(/pending|awaiting/i).first()).toBeVisible();
    await expect(panel.getByText(/^confirmed$/i)).toHaveCount(0);
    await expect(panel).toContainText(slot.time);

    // ------------------------------------------------------------------ the refusal
    // The room is gone at that time, so the server withdraws the slot it offered a
    // minute ago. Nothing about the successful booking changed to make that true.
    await page.goto("/reservations");
    await page.locator("#rs-party").fill(String(slot.partySize));
    await page.locator("#rs-date").fill(slot.dateKey);
    const sameSlot = page.getByRole("button", { name: new RegExp(`^${slot.time}`) });
    await expect(sameSlot, "the booked time should no longer be clickable").toBeDisabled({ timeout: 60_000 });
    await expect(sameSlot).toContainText(/\(/, { timeout: 10_000 });
    const reason = (await sameSlot.innerText()).replace(slot.time, "").trim();
    expect(reason, "the disabled slot should carry the server's reason").toMatch(/Fully booked|seats left/);

    // And the endpoint refuses the same request outright — a smaller party, same hour,
    // when the earlier booking already holds every seat.
    const refusal = await page.request.post("/api/reservations", {
      data: {
        customerName: `E2e Refused ${tag}`,
        phone: testMobile(`${tag}x`),
        email: "",
        dateKey: slot.dateKey,
        time: slot.time,
        partySize: 1,
        policyAccepted: true,
      },
    });
    expect(refusal.ok(), "the restaurant must not accept a booking it cannot seat").toBe(false);
    const body = (await refusal.json()) as { ok: false; error: { code: string; message: string } };
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message, "the refusal should explain the room, not fail silently").toMatch(/cannot seat/i);

    // The original request is untouched by the refusal.
    await page.goto(`/reserve/confirm?token=${encodeURIComponent(params.get("token") as string)}&code=${code}`);
    await expect(page.getByRole("heading", { level: 2, name: `Booking ${code}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: /E2e Refused/ })).toHaveCount(0);
  });
});
