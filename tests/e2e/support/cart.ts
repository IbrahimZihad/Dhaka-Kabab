import { expect, type Page } from "@playwright/test";

import type { UiItem } from "./db";
import { money } from "./expectations";

/**
 * Filling the guest's own list, through the screens a phone shows.
 *
 * The customiser is the only place a guest decides what goes on a dish, and it
 * refuses an incomplete required choice, so a spec that wants a line on the table
 * has to satisfy every blocking group — and will deliberately pick the extra that
 * costs money, because that is the line the restaurant has to price for itself.
 */

export type ChosenExtra = { name: string; priceDeltaPoisa: number };

/**
 * Adds `item` to the cart from its own page, choosing one option in every group
 * that blocks the dish and at least one option that costs more.
 * Returns the chosen extras and the unit price the menu advertised — which is all
 * the browser is allowed to claim; the kitchen's figure is rebuilt from the base.
 */
export async function addDishWithPaidExtra(page: Page, item: UiItem): Promise<{ extras: ChosenExtra[]; unitPoisa: number }> {
  await page.goto(`/menu/${item.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: item.name, exact: true })).toBeVisible();

  const paidGroup = item.groups.find((group) => group.options.some((option) => option.priceDeltaPoisa > 0));
  if (!paidGroup) throw new Error(`${item.name} has no group with a paid extra.`);
  const paidOption = paidGroup.options.find((option) => option.priceDeltaPoisa > 0);
  if (!paidOption) throw new Error(`${item.name} has no purchasable extra.`);

  const extras: ChosenExtra[] = [];
  for (const group of item.groups) {
    // Only a group that blocks the order, or the one holding the paid extra,
    // needs a tap; an optional free choice left alone is the guest's business.
    if (!group.blocking && group.id !== paidGroup.id) continue;
    const option = group.id === paidGroup.id ? paidOption : group.options[0];
    if (!option) throw new Error(`${group.name} on ${item.name} offers nothing selectable.`);
    const fieldset = page.getByRole("group", { name: group.name, exact: false });
    await fieldset.getByRole(group.single ? "radio" : "checkbox", { name: option.name, exact: false }).check();
    if (option.priceDeltaPoisa > 0) extras.push({ name: option.name, priceDeltaPoisa: option.priceDeltaPoisa });
  }

  await page.getByRole("button", { name: "Add to order" }).click();
  await expect(page.getByRole("link", { name: "Added — view your order" })).toBeVisible();

  return { extras, unitPoisa: item.pricePoisa + extras.reduce((total, extra) => total + extra.priceDeltaPoisa, 0) };
}

/** One tap on the menu page: a dish with nothing to choose. */
export async function quickAddDish(page: Page, item: { name: string; pricePoisa: number }, symbol: string): Promise<void> {
  const adder = page.getByRole("button", { name: `Add ${item.name} for ${money(item.pricePoisa, symbol)}`, exact: true });
  await adder.click();
  // The button keeps its `aria-label` as its accessible name, so the confirmation is
  // in its text: "Add" becomes "Added" for a moment and the guest's cart gains a line.
  await expect(adder).toContainText("Added");
}

/**
 * The line the table screen writes for one order, as the guest reads it:
 * `৳ 1,200 food · service ৳ 120 · VAT ৳ 66` plus the grand total beside it.
 */
export function orderTotalsBlock(page: Page, orderNumber: string) {
  return page.locator("li").filter({ has: page.getByText(orderNumber, { exact: true }) }).first();
}

export function parseSessionTotals(text: string): { subtotalPoisa: number; serviceChargePoisa: number; vatPoisa: number } {
  const match = /^(.+?) food · service (.+?) · VAT (.+)$/.exec(text.replace(/\s+/g, " ").trim());
  if (!match) throw new Error(`The table screen did not break the charges down: "${text}"`);
  return {
    subtotalPoisa: takaToPoisa(match[1]),
    serviceChargePoisa: takaToPoisa(match[2]),
    vatPoisa: takaToPoisa(match[3]),
  };
}

function takaToPoisa(text: string): number {
  const digits = text.match(/\d[\d,]*(?:\.\d{1,2})?/);
  if (!digits) throw new Error(`No amount in "${text}"`);
  return Math.round(Number(digits[0].replace(/,/g, "")) * 100);
}
