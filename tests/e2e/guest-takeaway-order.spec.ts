import { expect, test } from "@playwright/test";

import { expectPoisa, runTag, testMobile, toPoisa } from "./support/money";
import {
  cartLine,
  cartLineDeltas,
  cartSubtotalPoisa,
  chooseCustomisedDish,
  goCheckout,
  placeTakeawayOrder,
} from "./support/shop";

/**
 * Scenario 1 — a guest orders a takeaway through the public site and lands on a
 * tracking page that tells the truth.
 *
 * What "end to end" means here, in the app's own words: the menu builds a choice, the
 * cart is a scratch list, the checkout hands the dishes to the kitchen, and the
 * restaurant prices the order. Payment is deliberately not part of this journey; the
 * checkout says so out loud ("Nothing is charged here") and the tracking page never
 * claims otherwise. The simulated gateway this installation runs on is driven end to
 * end in `simulated-gateway-payment.spec.ts`, through the only door the product
 * actually has for online payment: a finalized table bill. The gap between those two
 * is reported as a finding.
 */
test.describe.serial("guest takeaway order, end to end", () => {
  test("menu → required customisation → server-priced cart → counter collection → live tracking", async ({
    page,
  }) => {
    const tag = runTag();
    const guestName = `E2e Counter ${tag}`;
    const mobile = testMobile(tag);

    const dish = await chooseCustomisedDish(page);
    const priced = dish.options.filter((option) => option.deltaPoisa !== 0);
    expect(priced.length, "at least one chosen option should be priced").toBeGreaterThan(0);

    // ------------------------------------------------------------------ the cart
    const line = cartLine(page, dish.name);
    await expect(line, "the cart should hold the dish by name").toBeVisible();

    // The cart shows the menu price and the chosen options apart from each other: it
    // is a reminder of a dish, not an invoice.
    const eachHint = line.locator("p.hint").filter({ hasText: /each/i }).first();
    await expect(eachHint).toContainText(priced[0].name);
    expectPoisa(toPoisa(await eachHint.innerText()), dish.basePoisa, "the per-dish menu price in the cart");

    expect(
      await cartLineDeltas(line),
      "the cart should show every priced option's own delta",
    ).toEqual(priced.map((option) => option.deltaPoisa).sort((left, right) => left - right));

    expectPoisa(toPoisa(await line.locator("span.price").first().innerText()), dish.unitPoisa, "the cart line total");
    expectPoisa(await cartSubtotalPoisa(page), dish.unitPoisa, "the cart subtotal");

    // -------------------------------------------------------------- the checkout
    await goCheckout(page);
    await expect(page.getByText("Nothing is charged here", { exact: false })).toBeVisible();
    await expectPoisa(
      toPoisa(
        await page
          .locator("div.card")
          .filter({ hasText: "Food subtotal" })
          .first()
          .innerText(),
      ),
      dish.unitPoisa,
      "the subtotal the checkout shows before anything is sent",
    );

    const placed = await placeTakeawayOrder(page, { name: guestName, mobile });

    // ---------------------------------------------------------------- the tracking
    expect(placed.token, "the tracking link must carry the order's own token").toMatch(/^[A-Za-z0-9]{8,64}$/);
    await expect(page).toHaveURL(new RegExp(`/track/${placed.token}$`));

    const card = page.locator("article.card").first();
    const heading = card.getByRole("heading", { level: 2, name: /^Order / });
    await expect(heading, "the confirmation should name the order the kitchen received").toBeVisible({
      timeout: 60_000,
    });
    const orderNumber = (await heading.innerText()).replace(/^Order\s+/, "").trim();
    expect(orderNumber, "an order number should be shown").toMatch(/[A-Za-z0-9-]{4,}/);

    await expect(card.getByText("Takeaway collection", { exact: false })).toBeVisible();
    await expect(card.getByText(dish.name, { exact: false }).first()).toBeVisible();
    await expect(card.getByText(priced[0].name, { exact: false }).first()).toBeVisible();

    // A status the restaurant actually set. `autoConfirmOrders` means a new order is
    // with the kitchen immediately, and the guest label for CONFIRMED is "Confirmed".
    const badge = card.locator("span.badge").first();
    const status = (await badge.innerText()).trim();
    expect(["Waiting for the kitchen", "Confirmed", "On the grill", "Ready", "Served", "Finished"]).toContain(status);
    expect(status, "a freshly placed order should already carry a real status").toBe("Confirmed");

    // The server rebuilt the money: its food figure equals the priced dish, and the
    // total is larger because the restaurant adds its own charges on top.
    const foodRow = card.locator("dl > div").filter({ hasText: /^Food/ }).first();
    const totalRow = card.locator("dl > div").filter({ hasText: /^Total/ }).first();
    const foodPoisa = toPoisa(await foodRow.innerText());
    const totalPoisa = toPoisa(await totalRow.innerText());
    expectPoisa(foodPoisa, dish.unitPoisa, "the order's food subtotal, rebuilt by the server");
    expect(totalPoisa, "charges must be added on top of the food").toBeGreaterThan(foodPoisa);

    // Honest state: nothing on the order itself says the guest has paid.
    await expect(card.getByText(/paid|card|gateway/i)).toHaveCount(0);
  });
});
