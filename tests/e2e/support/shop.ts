import { expect, type Locator, type Page } from "@playwright/test";

import { takaLabel, toPoisa } from "./money";

/**
 * How a guest actually reaches the app: the public menu, the customiser for a dish
 * with required choices, the quick-add button for one without, then the cart and the
 * checkout. Selectors come from the roles, labels and text these components really
 * render — never from a class that exists only for styling.
 */

export type ChosenOption = {
  /** The option exactly as the menu offered it, e.g. "Extra lamb". */
  name: string;
  /** Its advertised delta, in poisa; at least one is positive, which is the point. */
  deltaPoisa: number;
};

export type CustomisedDish = {
  name: string;
  slug: string;
  /** The menu price of the dish, in poisa, as the item page printed it. */
  basePoisa: number;
  options: ChosenOption[];
  /** Base plus every chosen delta: what the restaurant's own pricing rebuilds. */
  unitPoisa: number;
  /** True when the customiser turned an incomplete dish away before accepting it. */
  requiredChoiceEnforced: boolean;
};

const DISH_PATH = /\/menu\/[a-z0-9-]+$/i;
/**
 * A price delta as the app renders it. The customiser writes "+৳ 220" and the cart
 * drops the symbol to write "+ 220", so the sign, the symbol and the spacing all vary
 * while the grouped Taka figure never does.
 */
const DELTA_PATTERN = /[+−]\s*(?:৳\s*)?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/g;

/** Reads an option's label, e.g. "Extra lamb +৳ 220", into a name and a delta. */
function readOption(text: string): ChosenOption {
  const match = text.match(DELTA_PATTERN);
  const deltaPoisa = match ? (match[0].trimStart().startsWith("+") ? toPoisa(match[0]) : -toPoisa(match[0])) : 0;
  return { name: text.replace(DELTA_PATTERN, "").trim(), deltaPoisa };
}

/** The fieldset whose legend opens with this group name, by index. */
async function legendIndexOf(fieldsets: Locator, groupName: string): Promise<number> {
  const count = await fieldsets.count();
  for (let index = 0; index < count; index += 1) {
    const legend = (await fieldsets.nth(index).locator("legend").innerText()).trim();
    if (legend.startsWith(groupName)) return index;
  }
  throw new Error(`The customiser asked for "${groupName}", but no such group is on the page.`);
}

/**
 * Opens a dish that cannot be added until a required choice is made, makes those
 * choices — preferring the ones the menu prices higher — and puts the dish in the
 * cart. If the customiser turns an incomplete dish away, that refusal is recorded and
 * the missing group is filled, exactly as a guest would have to.
 */
export async function chooseCustomisedDish(page: Page): Promise<CustomisedDish> {
  await page.goto("/menu");
  await expect(page.getByRole("heading", { level: 1, name: "Our menu" })).toBeVisible();

  const entry = page.getByRole("link", { name: "Choose & add" }).first();
  await expect(entry, "the menu should offer a dish that needs choices").toBeVisible();
  const href = await entry.getAttribute("href");
  expect(href, "a dish needing choices links to its own page").toMatch(DISH_PATH);

  await entry.click();
  await page.waitForURL(DISH_PATH, { timeout: 90_000 });

  const name = (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
  const customiser = page.locator("div.card").filter({ hasText: "Order this dish" }).first();
  const basePoisa = toPoisa(await customiser.locator("p.hint").filter({ hasText: /each/i }).first().innerText());

  const fieldsets = customiser.locator("fieldset");
  const groupCount = await fieldsets.count();
  expect(groupCount, `${name} should offer at least one group of choices`).toBeGreaterThan(0);

  const legends = await fieldsets.locator("legend").allInnerTexts();
  expect(
    legends.some((legend) => legend.includes("(required)")),
    `${name} should have a required group to satisfy`,
  ).toBe(true);

  const chosen: ChosenOption[] = [];

  const pickFrom = async (index: number, slots: number[]): Promise<void> => {
    const fieldset = fieldsets.nth(index);
    const options = fieldset.locator("label:has(input)");
    const total = await options.count();
    expect(total, `group ${index} should list options`).toBeGreaterThan(0);
    for (const slot of slots) {
      const option = options.nth(slot % total);
      const control = option.locator("input");
      if (await control.isChecked()) continue;
      await control.check();
      await expect(control, "the choice should stick").toBeChecked();
      chosen.push(readOption((await option.innerText()).replace(/\s+/g, " ").trim()));
    }
  };

  for (let index = 0; index < groupCount; index += 1) {
    const legend = (await fieldsets.nth(index).locator("legend").innerText()).trim();
    const required = legend.includes("(required)");
    const options = fieldsets.nth(index).locator("label:has(input)");
    const total = await options.count();

    // Prefer what costs extra, so the cart really carries a price delta the server
    // has to rebuild. Optional groups are opened only after the required ones are
    // satisfied, so a multi-select required group is never left short.
    let pick = -1;
    for (let option = 0; option < total; option += 1) {
      if (/\+\s*৳/.test((await options.nth(option).innerText()).replace(/\s+/g, " "))) {
        pick = option;
        break;
      }
    }
    if (pick === -1 && !required) continue;
    await pickFrom(index, [pick === -1 ? 0 : pick]);
  }

  const unitOf = (): number => basePoisa + chosen.reduce((total, option) => total + option.deltaPoisa, 0);
  expect(
    chosen.some((option) => option.deltaPoisa > 0),
    `no choice offered on ${name} carried a positive price delta`,
  ).toBe(true);

  const add = customiser.getByRole("button", { name: "Add to order" });
  let requiredChoiceEnforced = false;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    // The customiser's running figure is guest-side arithmetic; the server rebuilds
    // it at submit time, which the specs compare against separately.
    await expect(customiser.locator("p.price").first()).toContainText(takaLabel(unitOf()));

    await add.click();
    const refusal = customiser.locator("p.notice-error");
    if ((await refusal.count()) === 0) break;

    const message = (await refusal.innerText()).trim();
    const shortfall = message.match(/choose (\d+) or more for (.+)\./);
    const missing = message.match(/choose one option for (.+)\./);
    expect(shortfall || missing, `unrecognised refusal from the customiser: "${message}"`).toBeTruthy();
    requiredChoiceEnforced = true;

    const index = await legendIndexOf(fieldsets, (shortfall?.[2] ?? missing?.[2] ?? "").trim());
    await pickFrom(index, Array.from({ length: shortfall ? Number(shortfall[1]) : 1 }, (_, slot) => slot));
  }

  await page.getByRole("link", { name: "Added — view your order" }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/cart$/);

  return {
    name,
    slug: (href ?? "").replace(/^\/menu\//, ""),
    basePoisa,
    options: chosen,
    unitPoisa: unitOf(),
    requiredChoiceEnforced,
  };
}

/** A dish with nothing to choose: the menu's own one-tap "Add" button. */
export async function addQuickDish(page: Page): Promise<{ name: string; poisa: number }> {
  await page.goto("/menu");
  const adder = page.getByRole("button", { name: /^Add .+ for / }).first();
  await expect(adder, "the menu should offer a one-tap Add for a dish with no required choices").toBeVisible();

  const label = (await adder.getAttribute("aria-label") ?? "").trim();
  const match = label.match(/^Add (.+) for (.+)$/);
  expect(match, `unexpected quick-add label "${label}"`).toBeTruthy();
  const name = (match as RegExpMatchArray)[1];
  const poisa = toPoisa((match as RegExpMatchArray)[2]);

  await adder.click();
  await expect(adder).toContainText("Added");
  return { name, poisa };
}

export function cartLine(page: Page, dishName: string): Locator {
  return page.locator("ul.card li").filter({ has: page.getByRole("link", { name: dishName, exact: true }) }).first();
}

/** The deltas the cart shows for itself, as poisa, sorted for comparison. */
export async function cartLineDeltas(line: Locator): Promise<number[]> {
  const text = await line.locator("p.hint").filter({ hasText: /^with/ }).first().innerText();
  return Array.from(text.matchAll(DELTA_PATTERN))
    .map((match) => (match[0].trimStart().startsWith("+") ? toPoisa(match[0]) : -toPoisa(match[0])))
    .sort((left, right) => left - right);
}

/** The cart's own "before charges" figure: a staleness check, never an invoice. */
export async function cartSubtotalPoisa(page: Page): Promise<number> {
  const block = page.locator("div.card").filter({ hasText: "Your food, before charges" }).first();
  return toPoisa(await block.locator("span.price").first().innerText());
}

export async function emptyCart(page: Page): Promise<void> {
  await page.goto("/cart");
  const remover = page.getByRole("button", { name: "Remove" });
  let guard = 0;
  while ((await remover.count()) > 0 && guard < 20) {
    await remover.first().click();
    guard += 1;
  }
  await expect(page.getByRole("heading", { level: 2, name: "Your order is empty" })).toBeVisible();
}

/** Takes the cart to the checkout screen. */
export async function goCheckout(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Review and place order" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole("heading", { level: 1, name: "Place your order" })).toBeVisible();
}

/**
 * Collects the guest's own details and places the order for collection at the
 * counter. The takeaway channel is chosen explicitly, even though it is the default
 * for an unseated visitor, because "which channel did the server record?" is what the
 * spec asserts.
 */
export async function placeTakeawayOrder(
  page: Page,
  details: { name: string; mobile: string },
): Promise<{ token: string }> {
  await page.getByLabel("Takeaway — collect from the counter").check();
  await page.locator("#ck-name").fill(details.name);
  await page.locator("#ck-phone").fill(details.mobile);
  await page.getByRole("button", { name: "Place the order" }).click();
  await page.waitForURL(/\/track\/[A-Za-z0-9]{8,64}$/, { timeout: 90_000 });
  return { token: new URL(page.url()).pathname.split("/").pop() as string };
}
