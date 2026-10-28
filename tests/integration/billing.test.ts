import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyCanonicalSettings,
  cleanupFixtures,
  createFixtureCategory,
  createFixtureItem,
  createFixtureTable,
  expectDatabaseUnderTest,
  expectRefusal,
  findResidue,
  fixtureStaffActor,
  joinFixtureTable,
  openFixtureSession,
  prisma,
  runTag,
  track,
  uniqueKey,
} from "./support";
import { cancelOrder, createOrder } from "@/server/services/order.service";
import { closeSession } from "@/server/services/table.service";
import {
  applyPaymentToBill,
  buildReceipt,
  finalizeBill,
  getBillById,
  getOrCreateOpenBill,
  openBillForSession,
  refreshBillLines,
  requestBillForSession,
  voidBill,
} from "@/server/services/billing.service";
import { recordCounterPayment } from "@/server/services/payment.service";
import { billVoidSchema } from "@/server/validation/billing";
import type { OrderCreateInput } from "@/server/validation/order";
import type { MenuItem } from "@prisma/client";

/**
 * Bills. The contract under test is the one written at the top of
 * `billing.service.ts`: an OPEN bill mirrors the visit, a bill that has taken money
 * or was voided is an issued document that nothing rewrites, and no order of the
 * visit is counted twice.
 *
 * Each scenario raises its own table, session and bill: bills are per-visit, and
 * the assertions are about one visit's arithmetic.
 */

const KEBAB_PRICE = 350_00;
const NAAN_PRICE = 50_00;

/** Order A: 2 kebabs. Order B: 2 naans. Together they are the visit's bill. */
const TWO_KEBAB = 700_00;
const TWO_NAAN = 100_00;
const VISIT_SUBTOTAL = TWO_KEBAB + TWO_NAAN;
const VISIT_SERVICE = 80_00;
const VISIT_VAT = 40_00;
const VISIT_TOTAL = 920_00;

let actor: { userId: string; role: string };
let manager: { userId: string; role: string };
let kebab: MenuItem;
let naan: MenuItem;

type Visit = {
  table: Awaited<ReturnType<typeof createFixtureTable>>;
  sessionId: string;
  participantToken: string;
};

async function newVisit(label: string): Promise<Visit> {
  const table = await createFixtureTable(4);
  const session = await openFixtureSession(table.id, 2);
  const joined = await joinFixtureTable(table.publicToken, `${label} ${runTag}`);
  return { table, sessionId: session.id, participantToken: joined.participantToken };
}

async function orderAt(visit: Visit, lines: { menuItemId: string; quantity: number }[]) {
  const input: OrderCreateInput = {
    type: "DINE_IN",
    tableToken: visit.table.publicToken,
    participantToken: visit.participantToken,
    items: lines.map((line) => ({ ...line, options: [], instructions: null })),
    idempotencyKey: uniqueKey("bill"),
  };
  const { order } = await createOrder(input, { customerId: null });
  track("orders", order.id);
  return order;
}

/** The two-order visit every total below is written against. */
async function raisedBill(label: string) {
  const visit = await newVisit(label);
  const first = await orderAt(visit, [{ menuItemId: kebab.id, quantity: 2 }]);
  const second = await orderAt(visit, [{ menuItemId: naan.id, quantity: 2 }]);
  const bill = await openBillForSession(visit.sessionId, actor);
  track("bills", bill.id);
  return { visit, first, second, bill };
}

beforeAll(async () => {
  expect(await expectDatabaseUnderTest()).toBeTruthy();
  await applyCanonicalSettings();
  actor = await fixtureStaffActor();
  manager = { userId: actor.userId, role: "MANAGER" };

  const category = await createFixtureCategory("Grill");
  kebab = await createFixtureItem(category.id, "Seekh Kebab", KEBAB_PRICE);
  naan = await createFixtureItem(category.id, "Naan", NAAN_PRICE);
});

afterAll(async () => {
  await cleanupFixtures();
  expect(await findResidue()).toEqual([]);
});

describe("bill consolidation", () => {
  it("counts each order of the visit exactly once", async () => {
    const { visit, first, second, bill } = await raisedBill("Consolidate");

    expect(bill.status).toBe("OPEN");
    expect(bill.sessionId).toBe(visit.sessionId);
    expect(bill.subtotalPoisa).toBe(VISIT_SUBTOTAL);
    expect(bill.serviceChargePoisa).toBe(VISIT_SERVICE);
    expect(bill.vatPoisa).toBe(VISIT_VAT);
    expect(bill.totalPoisa).toBe(VISIT_TOTAL);
    expect(bill.paidPoisa).toBe(0);

    const links = await prisma.billOrder.findMany({ where: { billId: bill.id } });
    expect(links.map((link) => link.orderId).sort()).toEqual([first.id, second.id].sort());
    expect(new Set(links.map((link) => link.orderId)).size).toBe(links.length);

    const lines = await prisma.billItem.findMany({ where: { billId: bill.id }, orderBy: { createdAt: "asc" } });
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.lineTotalPoisa).sort()).toEqual([TWO_NAAN, TWO_KEBAB].sort());
    expect(lines.map((line) => line.orderNumber).sort()).toEqual([first.orderNumber, second.orderNumber].sort());
    // Nothing is charged twice: the lines are the orders' own snapshots.
    expect(lines.reduce((total, line) => total + line.lineTotalPoisa, 0)).toBe(VISIT_SUBTOTAL);
  });

  it("stays the same bill when the table asks for it again", async () => {
    const { bill } = await raisedBill("Repeat");

    const again = await openBillForSession(bill.sessionId ?? "", actor);

    expect(again.id).toBe(bill.id);
    expect(again.totalPoisa).toBe(VISIT_TOTAL);
    expect(await prisma.bill.count({ where: { sessionId: bill.sessionId ?? "" } })).toBe(1);
    expect(await prisma.billOrder.count({ where: { billId: bill.id } })).toBe(2);
    expect(await prisma.billItem.count({ where: { billId: bill.id } })).toBe(2);
  });

  it("drops a cancelled order out of the open bill inside the same call", async () => {
    const { visit, first, second, bill } = await raisedBill("Cancel");

    await cancelOrder(second.id, "Guest changed their mind", { userId: actor.userId, role: "CASHIER" });

    const after = await getBillById(bill.id);
    expect(after.subtotalPoisa).toBe(TWO_KEBAB);
    expect(after.serviceChargePoisa).toBe(70_00);
    expect(after.vatPoisa).toBe(35_00);
    expect(after.totalPoisa).toBe(805_00);
    expect(after.orders.map((link) => link.orderId)).toEqual([first.id]);
    expect(after.items).toHaveLength(1);
    expect(visit.sessionId).toBe(bill.sessionId);
  });

  it("does not pull a cancelled order back when the bill is refreshed again", async () => {
    const { second, bill } = await raisedBill("Stay out");
    await cancelOrder(second.id, "Wrong table", { userId: actor.userId, role: "CASHIER" });

    const refreshed = await refreshBillLines(bill.id);
    expect(refreshed.totalPoisa).toBe(805_00);
    expect(await prisma.billOrder.count({ where: { billId: bill.id, orderId: second.id } })).toBe(0);
  });
});

describe("bill finalization", () => {
  it("snapshots the charges, the line count and the currency it was priced in", async () => {
    const { visit, bill } = await raisedBill("Snapshot");

    const asked = await requestBillForSession(visit.participantToken);
    expect(asked.billNumber).toBe(bill.number);
    expect(asked.duplicate).toBe(false);

    const finalized = await finalizeBill(bill.id, { discountPoisa: 100_00 }, manager);

    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.finalizedAt).toBeInstanceOf(Date);
    // Charges land on the discounted net, never on the gross.
    expect(finalized.subtotalPoisa).toBe(VISIT_SUBTOTAL);
    expect(finalized.discountPoisa).toBe(100_00);
    expect(finalized.serviceChargePoisa).toBe(70_00);
    expect(finalized.vatPoisa).toBe(35_00);
    expect(finalized.totalPoisa).toBe(805_00);

    const snapshot = finalized.snapshot as {
      takenAt: string;
      lineCount: number;
      currency: string;
      charges: { serviceChargeBps: number; vatBps: number; vatOnServiceCharge: boolean; roundingStepPoisa: number; currencyCode: string };
    };
    expect(snapshot.lineCount).toBe(2);
    expect(snapshot.currency).toBe("BDT");
    expect(snapshot.charges).toEqual({
      serviceChargeBps: 1000,
      vatBps: 500,
      vatOnServiceCharge: false,
      roundingStepPoisa: 1,
      timezone: "Asia/Dhaka",
      currencyCode: "BDT",
    });
    expect(Number.isNaN(Date.parse(snapshot.takenAt))).toBe(false);

    // The bill request is answered by bringing the bill, not by a second tap.
    expect(await prisma.tableSession.findUniqueOrThrow({ where: { id: visit.sessionId } }).then((row) => row.billRequestedAt)).toBeNull();
    const repeated = await requestBillForSession(visit.participantToken);
    expect(repeated.outstandingPoisa).toBe(805_00);
  });

  it("refuses to re-price a finalized bill when a further order arrives", async () => {
    const { visit, bill } = await raisedBill("Grow");
    await finalizeBill(bill.id, {}, manager);

    await orderAt(visit, [{ menuItemId: kebab.id, quantity: 3 }]);

    const untouched = await refreshBillLines(bill.id);
    expect(untouched.totalPoisa).toBe(VISIT_TOTAL);
    expect(await prisma.billItem.count({ where: { billId: bill.id } })).toBe(2);
    expect(await prisma.billOrder.count({ where: { billId: bill.id } })).toBe(2);

    // The visit still resolves to that same frozen document.
    expect((await getOrCreateOpenBill(bill.sessionId ?? "")).id).toBe(bill.id);
  });

  it("re-raises a finalized bill that has taken no money, so a second round is billed", async () => {
    const { visit, bill } = await raisedBill("Open again");
    await finalizeBill(bill.id, {}, manager);
    await orderAt(visit, [{ menuItemId: kebab.id, quantity: 3 }]);

    // One live bill per visit, and a bill nobody has paid is not yet an issued
    // document: the table ordered again after staff drew the bill up, and the only
    // way to charge for it in this model is for the same bill to grow. Refusing to
    // re-price here would let the second round eat unbilled.
    const reopened = await openBillForSession(visit.sessionId, actor);
    expect(reopened.id).toBe(bill.id);
    expect(reopened.totalPoisa).toBeGreaterThan(VISIT_TOTAL);
    expect(await prisma.billItem.count({ where: { billId: bill.id } })).toBe(3);
  });

  it("freezes a bill once money has been taken against it", async () => {
    const { visit, bill } = await raisedBill("Paid, then another round");
    await finalizeBill(bill.id, {}, manager);
    await applyPaymentToBill(bill.id, 500_00, { method: "CASH", actorUserId: actor.userId });

    await orderAt(visit, [{ menuItemId: kebab.id, quantity: 3 }]);
    const after = await openBillForSession(visit.sessionId, actor);

    // The receipt the guest was already given cannot change underneath them:
    // lines, total and the count of what was billed stay exactly as they were.
    expect(after.id).toBe(bill.id);
    expect(after.totalPoisa).toBe(VISIT_TOTAL);
    expect(after.paidPoisa).toBe(500_00);
    expect(await prisma.billItem.count({ where: { billId: bill.id } })).toBe(2);
    expect(await prisma.billOrder.count({ where: { billId: bill.id } })).toBe(2);
  });

  it("refuses to finalize a voided bill", async () => {
    const { bill } = await raisedBill("Void first");
    await voidBill(bill.id, "Priced on the wrong table", manager);

    const error = await expectRefusal(() => finalizeBill(bill.id, {}, manager), "CONFLICT", "finalizing a voided bill");
    expect(error.message).toMatch(/voided bill cannot be finalized/i);
  });
});

describe("settled and voided bills", () => {
  it("rolls orders forward to PARTIAL and then SETTLED as money arrives", async () => {
    const { visit, first, second, bill } = await raisedBill("Settle");
    await finalizeBill(bill.id, {}, manager);

    const partial = await applyPaymentToBill(bill.id, 500_00, { method: "CASH", actorUserId: actor.userId });
    expect(partial.settled).toBe(false);
    expect(partial.bill.status).toBe("FINALIZED");
    expect(partial.outstandingPoisa).toBe(420_00);
    for (const order of [first, second]) {
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PARTIAL");
    }

    const settled = await applyPaymentToBill(bill.id, 420_00, { method: "CASH", actorUserId: actor.userId });
    expect(settled.settled).toBe(true);
    expect(settled.bill.status).toBe("SETTLED");
    expect(settled.outstandingPoisa).toBe(0);
    expect(settled.bill.paidPoisa).toBe(VISIT_TOTAL);
    for (const order of [first, second]) {
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
    }
    expect(visit.sessionId).toBe(bill.sessionId);
  });

  it("refuses more money than a settled bill is owed", async () => {
    const { bill } = await raisedBill("Overpay");
    await finalizeBill(bill.id, {}, manager);
    await applyPaymentToBill(bill.id, VISIT_TOTAL, { method: "CASH", actorUserId: actor.userId });

    const error = await expectRefusal(
      () => applyPaymentToBill(bill.id, 1, { method: "CASH", actorUserId: actor.userId }),
      "VALIDATION",
      "paying a settled bill again",
    );
    expect(error.message).toMatch(/outstanding ৳ 0\b/);

    await expectRefusal(() => applyPaymentToBill(bill.id, 0, { method: "CASH" }), "VALIDATION", "zero payment");
  });

  it("closes a visit whose bill owes nothing without leaving its orders unpaid", async () => {
    const { visit, first, second, bill } = await raisedBill("Comp and close");

    // The whole food bill is compos off an OPEN bill: net zero, so the service
    // charge and VAT computed on that net fall to zero and nothing is owed.
    const discounted = await refreshBillLines(bill.id, prisma, { discountPoisa: VISIT_SUBTOTAL });
    expect(discounted.totalPoisa).toBe(0);

    await closeSession(visit.sessionId, { reason: "SETTLED" }, manager);

    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("SETTLED");
    // A ৳0 bill can never take a payment, so closing the visit is the only moment
    // these orders can be told they are paid; leaving them UNPAID would keep a
    // settled table on the outstanding list forever.
    for (const order of [first, second]) {
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
    }
  });

  it("cannot be deleted or re-priced once it is settled", async () => {
    const { bill } = await raisedBill("Keep");
    await finalizeBill(bill.id, {}, manager);
    await recordCounterPayment({ billId: bill.id, method: "CASH", amountPoisa: VISIT_TOTAL, actor: { userId: actor.userId } });

    const settled = await getBillById(bill.id);
    expect(settled.status).toBe("SETTLED");
    expect(settled.payments).toHaveLength(1);

    // A settled document survives a refresh: it is not the open mirror any more.
    const refreshed = await refreshBillLines(bill.id);
    expect(refreshed.totalPoisa).toBe(VISIT_TOTAL);
    expect(refreshed.paidPoisa).toBe(VISIT_TOTAL);

    // And the schema itself refuses to drop it out from under the money.
    let deletionRefusal: unknown;
    try {
      await prisma.bill.delete({ where: { id: bill.id } });
    } catch (error) {
      deletionRefusal = error;
    }
    expect(deletionRefusal).toBeInstanceOf(Error);
    expect((deletionRefusal as { code?: string }).code).toBe("P2003");
    expect((deletionRefusal as { meta?: { fieldDetails?: unknown } }).meta?.fieldDetails ?? (deletionRefusal as Error).message).toBeTruthy();
    expect(await prisma.bill.findUnique({ where: { id: bill.id } })).not.toBeNull();
  });

  it("keeps the record and the reason when a manager voids a bill", async () => {
    const { visit, bill } = await raisedBill("Void");

    await expectRefusal(
      () => voidBill(bill.id, "Not my call", { userId: actor.userId, role: "CASHIER" }),
      "FORBIDDEN",
      "cashier voiding a bill",
    );
    expect((await getBillById(bill.id)).status).toBe("OPEN");

    const voided = await voidBill(bill.id, "Guest did not turn up", manager);
    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("Guest did not turn up");
    expect(voided.totalPoisa).toBe(VISIT_TOTAL);

    // Nothing is erased: the lines, the orders and the visit are all still readable.
    const after = await getBillById(bill.id);
    expect(after.items).toHaveLength(2);
    expect(after.orders).toHaveLength(2);
    expect(after.session?.table.label).toBe(visit.table.label);

    await expectRefusal(() => applyPaymentToBill(bill.id, 100, { method: "CASH" }), "CONFLICT", "paying a voided bill");
  });

  it("refuses to void a bill that already holds verified money", async () => {
    const { bill } = await raisedBill("Refund first");
    await finalizeBill(bill.id, {}, manager);
    await recordCounterPayment({ billId: bill.id, method: "CASH", amountPoisa: 200_00, actor: { userId: actor.userId } });

    const error = await expectRefusal(() => voidBill(bill.id, "Mistake", manager), "CONFLICT", "voiding money that moved");
    expect(error.message).toMatch(/refund them before voiding/i);
    expect((await getBillById(bill.id)).status).toBe("FINALIZED");
  });

  it("requires a reason for a void at the published contract", async () => {
    // The API layer is what demands a reason: `voidBill()` stores whatever it is
    // given, so the validator is part of the rule, not a convenience.
    expect(billVoidSchema.safeParse({ reason: "no" }).success).toBe(false);
    expect(billVoidSchema.safeParse({ reason: "Priced on the wrong table" }).success).toBe(true);
  });
});

describe("receipts", () => {
  it("prints arithmetic that adds up from the stored figures", async () => {
    const { visit, first, second, bill } = await raisedBill("Receipt");
    await finalizeBill(bill.id, { discountPoisa: 200_00 }, manager);
    // Part-paid: a receipt has to be truthful about what is still owed.
    await recordCounterPayment({ billId: bill.id, method: "CASH", amountPoisa: 400_00, actor: { userId: actor.userId } });

    const receipt = await buildReceipt(bill.id);

    // 800.00 food − 200.00 discount = 600.00 net, +10% service, +5% VAT on the net.
    expect(receipt.subtotalPoisa).toBe(VISIT_SUBTOTAL);
    expect(receipt.discountPoisa).toBe(200_00);
    expect(receipt.serviceChargePoisa).toBe(60_00);
    expect(receipt.vatPoisa).toBe(30_00);
    expect(receipt.totalPoisa).toBe(690_00);
    expect(receipt.roundingAdjustmentPoisa).toBe(0);
    expect(
      receipt.subtotalPoisa -
        receipt.discountPoisa +
        receipt.serviceChargePoisa +
        receipt.vatPoisa +
        receipt.roundingAdjustmentPoisa,
    ).toBe(receipt.totalPoisa);
    expect(receipt.paidPoisa).toBe(400_00);
    expect(receipt.outstandingPoisa).toBe(290_00);
    expect(receipt.overpaidPoisa).toBe(0);
    expect(receipt.status).toBe("FINALIZED");
    expect(receipt.items).toHaveLength(2);
    expect(receipt.orders.sort()).toEqual([first.orderNumber, second.orderNumber].sort());
    expect(receipt.payments).toEqual([
      expect.objectContaining({ amountPoisa: 400_00, method: "CASH", status: "SUCCEEDED", provider: "counter" }),
    ]);
    // The receipt quotes the charges the bill was finalized under, whatever the
    // restaurant's settings say today.
    expect(receipt.chargeBasis).toEqual(expect.objectContaining({ serviceChargeBps: 1000, vatBps: 500 }));
    expect(receipt.table).toBe(visit.table.label);
    expect(receipt.sessionCode).toBeTypeOf("string");
    expect(receipt.currencyCode).toBe("BDT");
  });

  it("refuses to build a receipt for a bill that does not exist", async () => {
    await expectRefusal(() => buildReceipt("ckf-no-such-bill"), "NOT_FOUND", "receipt for nothing");
  });
});
