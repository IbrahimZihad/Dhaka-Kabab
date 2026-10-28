import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyCanonicalSettings,
  cleanupFixtures,
  createFixtureCategory,
  createFixtureDineInOrder,
  createFixtureItem,
  createFixtureVisit,
  expectDatabaseUnderTest,
  expectRefusal,
  findResidue,
  fixtureStaffActor,
  prisma,
  track,
} from "./support";
import {
  applyPaymentToBill,
  buildReceipt,
  finalizeBill,
  getBillById,
  openBillForSession,
  refreshBillLines,
} from "@/server/services/billing.service";

/**
 * Settlement maths on bills, focused on the edges a happy-path finalize does not
 * reach. The canonical settings bill every visit at 10% service and 5% VAT with
 * no cash rounding, so each figure below is a fixed integer, never a float.
 *
 * `billing.test.ts` already pins the ordinary consolidation / finalize / settle /
 * void flow; this file adds the three rules that flow does not exercise: a
 * discount larger than the food bill is clamped instead of turning it into a
 * credit, a bill discounted to exactly zero is reported as nothing owed, and an
 * OPEN bill is a live mirror that picks up an order the table adds after the bill
 * was first raised.
 */

const KEBAB_PRICE = 400_00; // a single kebab is the ৳400 line the tests discount
const NAAN_PRICE = 100_00;

let staff: { userId: string; role: string };
let kebab: Awaited<ReturnType<typeof createFixtureItem>>;
let naan: Awaited<ReturnType<typeof createFixtureItem>>;

/** One kebab on its own visit, its session's bill raised to OPEN. */
async function openBill(label: string) {
  const visit = await createFixtureVisit(label);
  const { order } = await createFixtureDineInOrder(visit, kebab.id, 1, { keyPrefix: label });
  const bill = await openBillForSession(visit.sessionId, staff);
  track("bills", bill.id);
  return { visit, order, bill };
}

beforeAll(async () => {
  expect(await expectDatabaseUnderTest()).toBeTruthy();
  await applyCanonicalSettings();
  staff = await fixtureStaffActor();
  const category = await createFixtureCategory("Grill");
  kebab = await createFixtureItem(category.id, "Seekh Kebab", KEBAB_PRICE);
  naan = await createFixtureItem(category.id, "Naan", NAAN_PRICE);
});

afterAll(async () => {
  await cleanupFixtures();
  expect(await findResidue()).toEqual([]);
});

describe("discounts that run past the food bill", () => {
  it("clamps a discount larger than the subtotal and charges on the net, never the gross", async () => {
    const { bill } = await openBill("Over-discount");

    // ৳400 of food, a ৳1,00,399 discount thrown at it. The net cannot go below zero,
    // so the discount is clamped to the subtotal and the service/VAT — which are
    // computed on the net — fall to zero. Had they been computed on the ৳400 gross,
    // service would be ৳40 and VAT ৳20 on a bill the guest owes nothing on.
    const finalized = await finalizeBill(bill.id, { discountPoisa: KEBAB_PRICE + 999_999 }, staff);

    // Nothing is owed on the clamped bill, so finalizing it closes it: an OPEN or
    // FINALIZED ৳0 bill would sit on the outstanding list forever, since no payment
    // can ever be recorded against a zero balance.
    expect(finalized.status).toBe("SETTLED");
    expect(finalized.subtotalPoisa).toBe(KEBAB_PRICE);
    expect(finalized.discountPoisa).toBe(KEBAB_PRICE); // clamped, not the ৳1,00,399 asked for
    expect(finalized.serviceChargePoisa).toBe(0); // net is zero, so no charge on a phantom gross
    expect(finalized.vatPoisa).toBe(0);
    expect(finalized.totalPoisa).toBe(0);
    expect(finalized.discountPoisa).toBeLessThanOrEqual(finalized.subtotalPoisa);
  });

  it("reports a fully-discounted ৳0 bill as owed nothing, and refuses to collect a penny more", async () => {
    const { bill } = await openBill("Zero-owed");

    const finalized = await finalizeBill(bill.id, { discountPoisa: KEBAB_PRICE }, staff);
    expect(finalized.totalPoisa).toBe(0);

    const receipt = await buildReceipt(bill.id);
    expect(receipt.totalPoisa).toBe(0);
    expect(receipt.outstandingPoisa).toBe(0); // never a debt, never negative
    expect(receipt.overpaidPoisa).toBe(0);

    // The bill is closed out: a cashier cannot even attempt to take money, because
    // there is nothing outstanding. Refusing here is what keeps a ৳0 bill from
    // silently drifting to a negative balance.
    const error = await expectRefusal(
      () => applyPaymentToBill(bill.id, 1, { method: "CASH", actorUserId: staff.userId }),
      "VALIDATION",
      "collecting on a ৳0 bill",
    );
    expect(error.message).toMatch(/more than the outstanding/i);
    expect((await getBillById(bill.id)).paidPoisa).toBe(0);
  });

  it("settles a fully-discounted bill's orders as PAID, not left UNPAID", async () => {
    // A bill discounted to exactly ৳0 owes nothing, so the orders it covers must be
    // marked PAID — the rule `derivePaymentStatus` encodes (`totalPoisa <= 0` -> "PAID",
    // src/lib/billing-math.ts:91, unit-asserted at tests/unit/billing-math.test.ts:413).
    // No payment can ever say so on its own: `applyPaymentToBill` rejects ৳0 amounts
    // (billing.service.ts:215) and refuses to overpay a ৳0 outstanding balance
    // (billing.service.ts:222). So `finalizeBill` has to derive the status itself, and
    // close the bill as SETTLED rather than leaving a settled table on the outstanding
    // list. This test was pinned as `.skip` against the source while that was missing.
    const { order, bill } = await openBill("Discounted-paid");
    const finalized = await finalizeBill(bill.id, { discountPoisa: KEBAB_PRICE }, staff);

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.paymentStatus).toBe("PAID");
    expect(finalized.status).toBe("SETTLED");
    expect(finalized.settledAt).not.toBeNull();
    expect((await getBillById(bill.id)).totalPoisa).toBe(0);
  });
});

describe("an open bill mirrors the live visit", () => {
  it("picks up an order the table adds after the bill was first raised", async () => {
    const visit = await createFixtureVisit("Open-refresh");
    await createFixtureDineInOrder(visit, kebab.id, 1, { keyPrefix: "kebab" });

    const bill = await openBillForSession(visit.sessionId, staff);
    track("bills", bill.id);
    // ৳400 food + ৳40 service + ৳20 VAT, one order, before anything else lands.
    expect(bill.subtotalPoisa).toBe(400_00);
    expect(bill.totalPoisa).toBe(460_00);
    expect(await prisma.billItem.count({ where: { billId: bill.id } })).toBe(1);

    // The table adds a second order to the same visit while the bill is still OPEN.
    await createFixtureDineInOrder(visit, naan.id, 1, { keyPrefix: "naan" });
    const refreshed = await refreshBillLines(bill.id);

    expect(refreshed.subtotalPoisa).toBe(500_00);
    expect(refreshed.serviceChargePoisa).toBe(50_00);
    expect(refreshed.vatPoisa).toBe(25_00);
    expect(refreshed.totalPoisa).toBe(575_00);
    expect(await prisma.billItem.count({ where: { billId: bill.id } })).toBe(2);
    expect(await prisma.billOrder.count({ where: { billId: bill.id } })).toBe(2);
  });
});
