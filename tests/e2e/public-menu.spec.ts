import { expect, test } from "@playwright/test";

import { closeDb, readActiveCategories, readItemWithPaidAddon, readPublicItems, readSettings } from "./support/db";
import { describeHours, isOpenNow, money, percentLabel, type OpeningRule } from "./support/expectations";
import { toPoisa } from "./support/money";

/**
 * The public menu is the restaurant's shop window, and every word in it is
 * supposed to come out of the database. A spec that only checked "a page loaded"
 * would pass against a template frozen with invented copy, so this reads the
 * settings row and the menu rows first and demands that the screen agree with
 * them — name, hours, open-or-closed, category list, price formatting and the
 * customisations a dish actually carries.
 */

test.afterAll(async () => {
  await closeDb();
});

test("home page renders the restaurant's own identity, hours and open state", async ({ page }) => {
  const settings = await readSettings();
  const rules = settings.openingHours as unknown as OpeningRule[];
  // Decided once, from the settings row, before the page is asked. If the clock
  // crosses the door on its own the test says so rather than guessing again.
  const instant = new Date();
  const open = isOpenNow(rules, settings.timezone, instant);

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: settings.name, exact: true })).toBeVisible();

  // The hero badge and the header badge are two renderings of one setting.
  await expect(page.getByText(open ? "Open now" : "Closed right now", { exact: true })).toBeVisible();
  await expect(page.locator("header").getByText(open ? "Open now" : "Closed", { exact: true })).toBeVisible();

  await expect(page.getByText("Opening hours", { exact: true })).toBeVisible();
  await expect(page.getByText(describeHours(rules), { exact: true })).toBeVisible();

  // An unrecorded detail must read as unrecorded, never as an invented one.
  const address = [settings.addressLine1, settings.addressLine2, settings.city].filter(Boolean).join(", ");
  await expect(page.getByText(address || "Address not recorded yet — check the contact page", { exact: true })).toBeVisible();

  // The restaurant's own money symbol, not a hardcoded ৳.
  expect(settings.currencySymbol).toBeTruthy();
  await expect(page.getByRole("link", { name: "See the menu" })).toBeVisible();
});

test("menu page lists the published categories and prices every dish in taka and poisa", async ({ page }) => {
  const [settings, categories, items] = await Promise.all([readSettings(), readActiveCategories(), readPublicItems()]);
  expect(categories.length, "the seeded menu has categories to list").toBeGreaterThan(0);
  expect(items.length).toBeGreaterThan(0);

  await page.goto("/menu");

  const categoryNav = page.getByRole("navigation", { name: "Menu categories" });
  for (const category of categories) {
    await expect(categoryNav.getByRole("link", { name: category.name, exact: false })).toBeVisible();
  }

  for (const item of items.slice(0, 8)) {
    const card = page.locator("li").filter({ has: page.getByRole("link", { name: item.name, exact: true }) }).first();
    await expect(card.getByText(item.name, { exact: true })).toBeVisible();
    const price = card.locator(".price").first();
    const rendered = (await price.innerText()).trim();
    // The exact string the restaurant's own formatter produces for that integer...
    expect(rendered, `${item.name} price label`).toBe(money(item.pricePoisa, settings.currencySymbol));
    // ...in the configured currency, and it must decode back to the stored poisa.
    expect(rendered.startsWith(settings.currencySymbol), `${item.name} carries the restaurant's symbol`).toBe(true);
    expect(toPoisa(rendered), `${item.name} amount`).toBe(item.pricePoisa);
  }

  // The charges note is the settings row talking, not a fixed percentage.
  if (settings.serviceChargeBps > 0) {
    await expect(
      page.getByText(`A service charge of ${percentLabel(settings.serviceChargeBps)}% is added to the food subtotal.`, {
        exact: false,
      }),
    ).toBeVisible();
  }
});

test("a dish page shows the customisation options and paid extras the menu really offers", async ({ page }) => {
  const [item, settings] = await Promise.all([readItemWithPaidAddon(), readSettings()]);
  const symbol = settings.currencySymbol;
  const paid = item.groups.flatMap((group) => group.options.filter((option) => option.priceDeltaPoisa > 0));
  expect(paid.length, "the chosen dish carries at least one paid extra").toBeGreaterThan(0);

  await page.goto(`/menu/${item.slug}`);

  await expect(page.getByRole("heading", { level: 1, name: item.name, exact: true })).toBeVisible();
  await expect(page.getByText(`${money(item.pricePoisa, symbol)} each`, { exact: false })).toBeVisible();

  for (const group of item.groups) {
    const fieldset = page.getByRole("group", { name: group.name, exact: false });
    await expect(fieldset).toBeVisible();
    for (const option of group.options) {
      await expect(fieldset.getByRole(group.single ? "radio" : "checkbox", { name: option.name, exact: false })).toBeVisible();
      if (option.priceDeltaPoisa > 0) {
        await expect(fieldset.getByText(`+${money(option.priceDeltaPoisa, symbol)}`, { exact: false })).toBeVisible();
      }
    }
  }

  // Adding to the cart is a promise, not an order — the page must say so.
  await expect(page.getByText("the total there is the restaurant", { exact: false })).toBeVisible();
});
