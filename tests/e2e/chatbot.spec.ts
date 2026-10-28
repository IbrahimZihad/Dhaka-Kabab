import { expect, test, type Page } from "@playwright/test";

import { closeDb, readChatDish, readPublicItems, readSettings } from "./support/db";
import { describeHours, isOpenNow, money, type OpeningRule } from "./support/expectations";
import { toPoisa } from "./support/money";

/**
 * The guest assistant, held to the restaurant's own records.
 *
 * A chatbot that sounds helpful and invents a price is worse than no chatbot, so
 * these specs do not ask it to be clever. They ask it to be sourced: a dish named
 * by the guest is quoted at the price in the database, the opening hours on screen
 * are the hours in the settings, and a question it genuinely cannot answer — a
 * discount, a big party — comes back with no number in it at all and a person's
 * name. The widget also has to admit out loud when it is answering from records
 * rather than from a language model.
 */

/** The words that make the widget treat a question as a health question. */
const HEALTH_WORDS = /allerg|ingredient|contain|gluten|nut|dairy|milk|egg|spicy|heat|vegan|vegetarian|ham|beef|chicken|fish/i;

test.afterAll(async () => {
  await closeDb();
});

function widget(page: Page) {
  return page.locator('section[aria-label="Questions about the restaurant"]');
}

/** Opens the assistant, asks, and returns the answer bubble's own words. */
async function ask(page: Page, question: string): Promise<string> {
  await page.getByRole("button", { name: "Ask us something" }).click();
  const panel = widget(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Answers come from our own menu and settings.", { exact: false })).toBeVisible();

  await panel.getByLabel("Your question").fill(question);
  await panel.getByRole("button", { name: "Send" }).click();

  const reply = panel.locator("div.notice").last();
  await expect(reply).toBeVisible({ timeout: 60_000 });
  return await reply.innerText();
}

test("the assistant quotes a dish at the price the menu actually carries", async ({ page }) => {
  const settings = await readSettings();
  if (!settings.chatbotEnabled) throw new Error("The assistant is switched off in the restaurant's settings — the widget never appears.");

  const [dish, menu] = await Promise.all([readChatDish(HEALTH_WORDS), readPublicItems()]);
  const priceLine = `${dish.name} — ${money(dish.pricePoisa, settings.currencySymbol)}`;

  await page.goto("/");
  const reply = await ask(page, `How much is ${dish.name}?`);
  expect(reply, `asked about ${dish.name}, the answer quotes it`).toContain(priceLine);

  // Grounded: every amount in the answer is a price that exists on this menu.
  const realPrices = new Set(menu.map((item) => item.pricePoisa));
  realPrices.add(settings.deliveryFeePoisa);
  const quoted = reply.match(/৳\s?[\d,]+(?:\.\d{1,2})?/g) ?? [];
  expect(quoted.length, "the answer gave the guest a number").toBeGreaterThan(0);
  for (const amount of quoted) {
    expect(realPrices, `the assistant quoted ${amount.trim()}, which is not on the menu`).toContain(toPoisa(amount));
  }

  // And it says where the number came from.
  const attribution = widget(page).getByText(/^From: /);
  await expect(attribution).toBeVisible();
  await expect(attribution).toContainText(dish.name);
  expect(await attribution.innerText(), "the answer is labelled with its source kind").toMatch(/ · (menu-data|ai)$/);

  // With no language model behind it, the widget has to say so rather than pass the
  // lookup off as a conversation. An installation that does configure a model takes
  // the other branch, and this line is what tells us it happened.
  if (!/ · ai$/.test(await attribution.innerText())) {
    await expect(widget(page).getByText("Answered from our menu and settings", { exact: false })).toBeVisible();
  }

  // The way to a human is offered without the guest having to ask for it.
  await expect(widget(page).getByRole("button", { name: "Speak to a person instead" })).toBeVisible();
});

test("the opening hours the assistant recites are the hours in the settings", async ({ page }) => {
  const settings = await readSettings();
  const rules = (Array.isArray(settings.openingHours) ? (settings.openingHours as unknown as OpeningRule[]) : []).filter(
    (rule) => Array.isArray(rule.days) && typeof rule.opens === "string" && typeof rule.closes === "string",
  );
  const open = isOpenNow(rules, settings.timezone, new Date());

  await page.goto("/");
  const reply = await ask(page, "What are your opening hours?");

  expect(reply, "the hours sentence is the one the settings describe").toContain(describeHours(rules));
  expect(reply, "and the answer knows whether the doors are open this minute").toContain(open ? "open right now" : "closed right now");
  expect(reply, "an hours question invents no prices").not.toMatch(/৳/);

  const attribution = widget(page).getByText(/^From: /);
  await expect(attribution).toBeVisible();
  expect(await attribution.innerText(), "answered from the restaurant's own settings").toMatch(/ · (settings|ai)$/);
});

test("a question the assistant cannot answer comes back with no number and a person", async ({ page }) => {
  await page.goto("/");
  const reply = await ask(page, "Can you offer a discount for a large party?");

  // Refusal, in plain words, with nothing invented: no amount, no percentage.
  expect(reply, "the assistant invents no figure for a discount").not.toMatch(/৳/);
  expect(reply, "and no percentage either").not.toMatch(/\d/);
  expect(reply.toLowerCase(), "the guest is handed to a human rather than guessed at").toMatch(/manager|team|staff|person/);

  await expect(widget(page).getByRole("button", { name: "Speak to a person instead" })).toBeVisible();
});
