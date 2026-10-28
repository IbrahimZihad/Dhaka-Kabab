import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { closeDb, countReservationsByName, readReservationByCode, readSettings, readTotalSeats } from "./support/db";
import { offeredSlotTimes, shiftDateKey, weekdayOfDateKey, zonedClock, zonedDateKey, type OpeningRule } from "./support/expectations";
import { runTag, testMobile } from "./support/money";
import { guestContext } from "./support/staff";

/**
 * Booking a table, measured against what the restaurant actually serves.
 *
 * The slot grid is the one part of the public site that promises something the
 * building has to keep, so these specs never invent a time: they ask the app which
 * slots it offers, check that list against the opening hours read straight out of
 * the settings, book one, then jam the room full and watch the next guest be
 * refused — by the grid, by the server, and without a phantom booking appearing.
 */

type Slot = { time: string; available: boolean; reason?: string };
type Availability = { dateKey: string; slots: Slot[]; closed: boolean; maxPartySize: number };
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

test.afterAll(async () => {
  await closeDb();
});

/** The settings' opening rules, filtered the way the booking service filters them. */
function rulesOf(raw: unknown): OpeningRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (rule): rule is OpeningRule =>
      !!rule &&
      typeof rule === "object" &&
      Array.isArray((rule as OpeningRule).days) &&
      typeof (rule as OpeningRule).opens === "string" &&
      typeof (rule as OpeningRule).closes === "string",
  );
}

async function fetchAvailability(request: APIRequestContext, dateKey: string, partySize: number): Promise<Availability> {
  const response = await request.get(`/api/reservations/availability?dateKey=${dateKey}&partySize=${partySize}`);
  const body = (await response.json()) as Envelope<Availability>;
  if (!response.ok() || !body.ok || !body.data) {
    throw new Error(`Availability for ${dateKey} / ${partySize} guests failed (${response.status()}): ${body.error?.message ?? "no body"}`);
  }
  return body.data;
}

/**
 * The first date, from tomorrow out to the booking horizon, that has a slot free
 * for this party. Nothing here assumes a particular day or time is bookable — the
 * app is asked, because a run the night before may have left a booking behind.
 */
async function bookableSlot(request: APIRequestContext, timeZone: string, partySize: number) {
  const today = zonedDateKey(new Date(), timeZone);
  const horizon = 20;
  for (let offset = 1; offset <= horizon; offset += 1) {
    const dateKey = shiftDateKey(today, offset);
    const availability = await fetchAvailability(request, dateKey, partySize);
    const slot = availability.slots.find((entry) => entry.available);
    if (slot) return { dateKey, time: slot.time, availability };
  }
  throw new Error(`Nothing seats ${partySize} guests in the next ${horizon} days — the floor cannot be booked at all.`);
}

/** The "Free times" card, so slot buttons are read from the grid and nowhere else. */
function slotGrid(page: Page) {
  return page.locator("div.card").filter({ hasText: "Free times" });
}

test("a guest books a slot the restaurant genuinely serves, and the booking lands as a request", async ({ request, browser }) => {
  const settings = await readSettings();
  const rules = rulesOf(settings.openingHours);
  const { dateKey, time, availability } = await bookableSlot(request, settings.timezone, 2);
  const tag = runTag();
  const name = `E2E Booking ${tag}`;

  const offered = offeredSlotTimes(rules, weekdayOfDateKey(dateKey), {
    slotMinutes: settings.reservationSlotMinutes,
    durationMinutes: settings.reservationDurationMinutes,
  });
  expect(offered.length, `the opening hours offer at least one seating window on ${dateKey}`).toBeGreaterThan(0);
  expect(offered, "the app only ever offers a time its own hours produce").toContain(time);

  // The grid the form draws must be the grid the hours describe, to the minute.
  expect(
    availability.slots.map((slot) => slot.time),
    "the availability endpoint agrees with the opening hours",
  ).toEqual(offered);

  const context = await guestContext(browser);
  const bookingPage = await context.newPage();
  try {
    await bookingPage.goto("/reservations");
    await expect(bookingPage.getByRole("heading", { level: 1, name: "Book a table", exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(bookingPage.getByText("Bookings open up to", { exact: false })).toBeVisible();

    await bookingPage.locator("#rs-party").fill("2");
    await bookingPage.locator("#rs-date").fill(dateKey);

    const grid = slotGrid(bookingPage);
    const slotButton = grid.getByRole("button", { name: time, exact: true });
    await expect(slotButton).toBeVisible({ timeout: 60_000 });
    await expect(slotButton).toBeEnabled();
    await slotButton.click();

    await bookingPage.locator("#rs-name").fill(name);
    await bookingPage.locator("#rs-phone").fill(testMobile(tag));
    await bookingPage.getByRole("checkbox", { name: /I understand this is a/ }).check();

    await bookingPage.getByRole("button", { name: "Request this table" }).click();
    await bookingPage.waitForURL(/\/reserve\/confirm/, { timeout: 60_000 });

    const code = new URL(bookingPage.url()).searchParams.get("code") ?? "";
    expect(code, "the confirmation link carries the booking code").toBeTruthy();

    await expect(bookingPage.getByRole("heading", { level: 2, name: `Booking ${code}`, exact: true })).toBeVisible({ timeout: 60_000 });
    // Honest, and only honest: a request is not a confirmed table.
    await expect(bookingPage.getByText("We have your request. A manager has not confirmed it yet.", { exact: false })).toBeVisible();
    await expect(bookingPage.getByText("pending", { exact: true })).toBeVisible();
    await expect(bookingPage.getByText("2 guests", { exact: true })).toBeVisible();

    const reservation = await readReservationByCode(code);
    expect(reservation.status).toBe("PENDING");
    expect(reservation.customerName).toBe(name);
    expect(reservation.partySize).toBe(2);
    expect(reservation.policyAccepted).toBe(true);
    expect(reservation.createdVia).toBe("WEB");
    expect(reservation.durationMinutes).toBe(settings.reservationDurationMinutes);
    expect(zonedDateKey(reservation.startsAt, settings.timezone), "booked for the day the guest picked").toBe(dateKey);
    const clock = zonedClock(reservation.startsAt, settings.timezone);
    expect(`${String(Math.floor(clock.minutes / 60)).padStart(2, "0")}:${String(clock.minutes % 60).padStart(2, "0")}`).toBe(time);
    expect(reservation.tables.length, "the room allocated a table").toBeGreaterThan(0);

    await expect(bookingPage.getByText(reservation.tables[0].table.label, { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a booking that takes the whole room makes the same slot unavailable to the next guest", async ({ page, request }) => {
  const settings = await readSettings();
  const seats = await readTotalSeats();
  if (seats > 60) {
    throw new Error(
      `This room seats ${seats} guests, more than one public booking may ask for, so no single booking can jam it. ` +
        "Run this spec against a floor of 60 seats or fewer, or block the tables from the staff floor board instead.",
    );
  }
  const roomSeats = seats;
  const tag = runTag();
  const crowd = `E2E Full Room ${tag}`;
  const nextGuest = `E2E Priced Out ${tag}`;

  const { dateKey, time } = await bookableSlot(request, settings.timezone, roomSeats);

  // Fill every seat at this slot, through the same public door a guest uses.
  const takeover = await request.post("/api/reservations", {
    data: {
      customerName: crowd,
      phone: testMobile(tag),
      email: "",
      dateKey,
      time,
      partySize: roomSeats,
      policyAccepted: true,
    },
  });
  const takeoverBody = (await takeover.json()) as Envelope<{ code: string; publicToken: string; tables: string[] }>;
  expect(takeover.status(), `the whole-room booking was accepted: ${JSON.stringify(takeoverBody)}`).toBe(201);
  const token = takeoverBody.data?.publicToken ?? "";
  expect(token.length, "the booking came back with its own link").toBeGreaterThan(7);
  expect(takeoverBody.data?.tables.length, "every table in the room went to this party").toBeGreaterThan(0);

  try {
    // The grid knows: the same slot no longer fits two people.
    const after = await fetchAvailability(request, dateKey, 2);
    const now = after.slots.find((slot) => slot.time === time);
    expect(now, `${time} is still listed on ${dateKey}`).toBeTruthy();
    expect(now?.available, `${time} is no longer offered`).toBe(false);
    expect(now?.reason, "and the grid says why").toBeTruthy();

    await page.goto("/reservations");
    await page.locator("#rs-party").fill("2");
    await page.locator("#rs-date").fill(dateKey);
    const blocked = slotGrid(page).getByRole("button", { name: new RegExp(`^${time}`) });
    await expect(blocked).toBeVisible({ timeout: 60_000 });
    await expect(blocked).toBeDisabled();
    await expect(blocked).toContainText(now?.reason ?? "booked");

    // And asking the server directly is refused in the guest's words, not with a
    // silent "we'll sort it out later".
    const clash = await request.post("/api/reservations", {
      data: {
        customerName: nextGuest,
        phone: testMobile(`${tag}x`),
        email: "",
        dateKey,
        time,
        partySize: 2,
        policyAccepted: true,
      },
    });
    const clashBody = (await clash.json()) as Envelope<unknown>;
    expect(clash.status(), "a party with nowhere to sit is refused").toBe(409);
    expect(clashBody.error?.code).toBe("CONFLICT");
    expect(clashBody.error?.message, "and the reason is legible").toContain("We cannot seat 2 guests at that time.");

    expect(await countReservationsByName(nextGuest), "a refused booking writes no row").toBe(0);
  } finally {
    // Give the room back: a run must not leave the restaurant fully booked for the
    // next one, and the guest's own link is the only credential that can.
    const release = await request.post("/api/reservations/cancel", {
      data: { token, reason: "End-to-end run cleanup" },
    });
    expect(release.status(), "the whole-room booking is released again").toBe(200);
    const freed = await fetchAvailability(request, dateKey, 2);
    expect(freed.slots.find((slot) => slot.time === time)?.available, "cancelling put the seats back on offer").toBe(true);
  }
});

test("the grid never offers a time the kitchen is not serving", async ({ page, request }) => {
  const settings = await readSettings();
  const rules = rulesOf(settings.openingHours);
  const today = zonedDateKey(new Date(), settings.timezone);
  const dateKey = shiftDateKey(today, 1);
  const weekday = weekdayOfDateKey(dateKey);
  const availability = await fetchAvailability(request, dateKey, 2);

  await page.goto("/reservations");
  await page.locator("#rs-party").fill("2");
  await page.locator("#rs-date").fill(dateKey);
  const grid = slotGrid(page);
  await expect(grid.locator("button").first()).toBeVisible({ timeout: 60_000 });

  const shown = (await grid.locator("button").allInnerTexts())
    .map((text) => /^\d{2}:\d{2}/.exec(text.trim())?.[0])
    .filter((time): time is string => Boolean(time));

  const rule = rules.find((entry) => entry.days.includes(weekday));
  if (!rule) {
    // A closed day has to say so rather than show an empty or, worse, a full grid.
    expect(shown, "a closed day offers no slot").toEqual([]);
    await expect(page.getByText("We are closed on that day.", { exact: true })).toBeVisible();
    return;
  }

  expect(availability.closed, "the endpoint does not call an open day closed").toBe(false);
  expect(shown, "every button on the grid came from the hours").toEqual(
    offeredSlotTimes(rules, weekday, {
      slotMinutes: settings.reservationSlotMinutes,
      durationMinutes: settings.reservationDurationMinutes,
    }),
  );

  const toMinutes = (label: string) => Number(label.slice(0, 2)) * 60 + Number(label.slice(3, 5));
  const opens = toMinutes(rule.opens);
  const closes = toMinutes(rule.closes);
  for (const time of shown) {
    const start = toMinutes(time);
    expect(start, `${time} is not before opening`).toBeGreaterThanOrEqual(opens);
    expect(
      start + settings.reservationDurationMinutes,
      `the whole seating window after ${time} fits inside ${rule.opens}-${rule.closes}`,
    ).toBeLessThanOrEqual(closes);
  }

  // The hour before the doors open is not on the sheet, either as a button or as a
  // claim from the endpoint.
  if (opens >= 30) {
    const outside = `${String(Math.floor((opens - 30) / 60)).padStart(2, "0")}:00`;
    expect(shown, `no slot in the quiet hour ${outside}`).not.toContain(outside);
    expect(availability.slots.map((slot) => slot.time), "the endpoint does not offer it either").not.toContain(outside);
  }
});
