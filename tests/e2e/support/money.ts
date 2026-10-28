import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Money on screen is the app's own formatted string — `৳ 1,380`, with decimals only
 * when a figure is not whole Taka. Specs compare amounts, so they parse rendered
 * text rather than re-implementing `src/lib/money.ts`, and rebuild it the same way
 * when they need to predict what a screen should show.
 */
export function toPoisa(text: string): number {
  const match = text.match(/\d[\d,\s]*(?:\.\d+)?/);
  if (!match) throw new Error(`No amount found in "${text}"`);
  return Math.round(Number(match[0].replace(/[,\s]/g, "")) * 100);
}

/** Mirrors `formatPoisa`: `৳ ` plus grouped Taka, decimals only when there are poisa. */
export function takaLabel(poisa: number): string {
  const takas = Math.floor(Math.abs(poisa) / 100);
  const remainder = Math.abs(poisa) % 100;
  return `৳ ${takas.toLocaleString("en-US")}${remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`}`;
}

/** Anything the app renders as a money figure — used to prove a screen shows none. */
export function moneyText(page: Page | Locator): Locator {
  return page.getByText("৳", { exact: false });
}

export function expectPoisa(actual: number, expected: number, context: string): void {
  expect(actual, `${context}: expected ${expected} poisa, saw ${actual}`).toBe(expected);
}

/** A run tag short enough for a name field and unique enough to find again. */
export function runTag(): string {
  return `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
}

/**
 * A mobile number the app's own pattern accepts (`01[3-9]` plus eight digits),
 * built from the run tag so two runs never collide and no real number is dialled.
 */
export function testMobile(tag: string): string {
  const seed = Number.parseInt(tag.slice(0, 4), 36) || 7;
  const prefix = "3456789"[seed % 7];
  const tail = String(seed % 10_000_000).padStart(8, "0");
  return `01${prefix}${tail}`;
}
