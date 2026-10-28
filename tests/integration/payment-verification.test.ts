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
  runTag,
  track,
  uniqueEmail,
  uniquePhone,
} from "./support";
import {
  applyPaymentToBill,
  finalizeBill,
  getBillById,
  openBillForSession,
} from "@/server/services/billing.service";
import {
  completeSimulatedPayment,
  handleGatewayCallback,
  initiateGatewayPayment,
  recordCounterPayment,
} from "@/server/services/payment.service";
import { createSimulatedProvider, simulatedProof } from "@/server/services/providers/simulated";

/**
 * Payment verification. The rule under test is the one promised in the system
 * overview and written at the top of `payment.service.ts`: a redirect, an
 * initiation, or an unverifiable notification never marks money moved. Only a
 * provider-verified capture does, and the boundary figures (PARTIAL vs PAID)
 * must hold to the poisa.
 *
 * Canonical settings put one dish at a ৳500 line: subtotal 50000, +10% service
 * 5000, +5% VAT 2500, total 57500. Every figure below is written against those.
 */

const KEBAB_PRICE = 500_00;
const BILL_TOTAL = 575_00;

let staff: { userId: string; role: string };
let kebab: Awaited<ReturnType<typeof createFixtureItem>>;

/** A finalized dine-in bill for one dish, plus the visit and order behind it. */
async function finalizedBill(label: string) {
  const visit = await createFixtureVisit(label);
  const { order } = await createFixtureDineInOrder(visit, kebab.id, 1, { keyPrefix: label });
  const bill = await openBillForSession(visit.sessionId, staff);
  track("bills", bill.id);
  const finalized = await finalizeBill(bill.id, {}, staff);
  return { visit, order, finalized };
}

function gatewayRequest(params: Record<string, string>): Request {
  const url = new URL("http://localhost:3000/api/payments/gateway/callback");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url.toString());
}

beforeAll(async () => {
  expect(await expectDatabaseUnderTest()).toBeTruthy();
  await applyCanonicalSettings();
  staff = await fixtureStaffActor();
  const category = await createFixtureCategory("Grill");
  kebab = await createFixtureItem(category.id, "Seekh Kebab", KEBAB_PRICE);
});

afterAll(async () => {
  await cleanupFixtures();
  expect(await findResidue()).toEqual([]);
});

describe("gateway hand-off never settles on its own", () => {
  it("an initiated gateway payment is PENDING and moves no money until verified", async () => {
    const { order, finalized } = await finalizedBill("Hand-off");

    const initiated = await initiateGatewayPayment({
      billId: finalized.id,
      customer: { name: `Payer ${runTag}`, email: uniqueEmail("payer"), phone: uniquePhone() },
      returnUrl: "http://localhost:3000/order",
      actor: { userId: staff.userId },
    });

    const pending = await prisma.payment.findUniqueOrThrow({ where: { reference: initiated.reference } });
    expect(pending.status).toBe("PENDING");
    expect(pending.method).toBe("ONLINE_GATEWAY");
    expect(pending.amountPoisa).toBe(BILL_TOTAL);
    expect(initiated.completionProof).toBeTruthy();

    // The customer following the redirect changes nothing about the money state.
    const afterInit = await getBillById(finalized.id);
    expect(afterInit.paidPoisa).toBe(0);
    expect(afterInit.status).toBe("FINALIZED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("UNPAID");

    // Only the verified callback — the same path a real gateway posts to — settles it.
    const done = await completeSimulatedPayment({ reference: initiated.reference, outcome: "APPROVED" });
    expect(done.status).toBe("SUCCEEDED");

    const settledBill = await prisma.bill.findUniqueOrThrow({ where: { id: finalized.id } });
    expect(settledBill.paidPoisa).toBe(BILL_TOTAL);
    expect(settledBill.status).toBe("SETTLED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
  });

  it("a callback that fails signature verification is refused and leaves the money untouched", async () => {
    const { order, finalized } = await finalizedBill("Bad-signature");
    const initiated = await initiateGatewayPayment({
      billId: finalized.id,
      customer: { name: `Payer ${runTag}`, email: uniqueEmail("payer"), phone: uniquePhone() },
      returnUrl: "http://localhost:3000/order",
    });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { reference: initiated.reference } });

    const amountField = (payment.amountPoisa / 100).toFixed(2);

    // Wrong proof.
    const forged = await expectRefusal(
      () =>
        handleGatewayCallback(
          gatewayRequest({ dk_ref: initiated.reference, dk_amount: amountField, dk_outcome: "APPROVED", dk_proof: "0".repeat(64) }),
          createSimulatedProvider(),
        ),
      "PAYMENT_UNVERIFIED",
      "forged proof",
    );
    expect(forged.status).toBe(402);

    // Absent proof.
    await expectRefusal(
      () =>
        handleGatewayCallback(
          gatewayRequest({ dk_ref: initiated.reference, dk_amount: amountField, dk_outcome: "APPROVED" }),
          createSimulatedProvider(),
        ),
      "PAYMENT_UNVERIFIED",
      "missing proof",
    );

    // Neither refusal moved a single poisa.
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: finalized.id } })).paidPoisa).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("UNPAID");
  });

  it("a callback naming an unknown transaction id is refused and cannot touch a real bill", async () => {
    const { finalized } = await finalizedBill("Unknown-txn");
    await initiateGatewayPayment({
      billId: finalized.id,
      customer: { name: `Payer ${runTag}`, email: uniqueEmail("payer"), phone: uniquePhone() },
      returnUrl: "http://localhost:3000/order",
    });

    const ghost = `PAYUNKNOWN${runTag}`.slice(0, 24);
    await expectRefusal(
      () =>
        handleGatewayCallback(
          gatewayRequest({ dk_ref: ghost, dk_amount: "575.00", dk_outcome: "APPROVED", dk_proof: simulatedProof(ghost) }),
          createSimulatedProvider(),
        ),
      "NOT_FOUND",
      "unknown transaction id",
    );

    expect(await prisma.payment.count({ where: { reference: ghost } })).toBe(0);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: finalized.id } })).paidPoisa).toBe(0);
  });
});

describe("counter payment boundaries", () => {
  it("walks a bill UNPAID -> PARTIAL -> PAID and never reads a partial as paid", async () => {
    const { order, finalized } = await finalizedBill("Counter-boundaries");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("UNPAID");

    const partial = await recordCounterPayment({
      billId: finalized.id,
      method: "CASH",
      amountPoisa: 200_00,
      actor: { userId: staff.userId },
    });
    expect(partial.settled).toBe(false);
    expect(partial.outstandingPoisa).toBe(375_00);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PARTIAL");
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: finalized.id } })).status).toBe("FINALIZED");

    const rest = await recordCounterPayment({
      billId: finalized.id,
      method: "CASH",
      amountPoisa: 375_00,
      actor: { userId: staff.userId },
    });
    expect(rest.settled).toBe(true);
    expect(rest.outstandingPoisa).toBe(0);
    const settled = await prisma.bill.findUniqueOrThrow({ where: { id: finalized.id } });
    expect(settled.paidPoisa).toBe(BILL_TOTAL);
    expect(settled.status).toBe("SETTLED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
  });

  it("refuses a counter overpayment and never drives the balance negative on a verified surplus", async () => {
    const { finalized } = await finalizedBill("Overpay");

    const error = await expectRefusal(
      () => recordCounterPayment({ billId: finalized.id, method: "CASH", amountPoisa: 600_00, actor: { userId: staff.userId } }),
      "VALIDATION",
      "counter overpayment",
    );
    expect(error.message).toMatch(/more than the outstanding/i);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: finalized.id } })).paidPoisa).toBe(0);
    expect(await prisma.payment.count({ where: { billId: finalized.id } })).toBe(0);

    // A *verified* capture larger than the invoice is the one allowed overpayment:
    // the money already moved, so it is applied and reported — never netted to a
    // negative outstanding.
    const surplus = await applyPaymentToBill(finalized.id, 700_00, {
      method: "ONLINE_GATEWAY",
      captureVerifiedSurplus: true,
    });
    expect(surplus.settled).toBe(true);
    expect(surplus.outstandingPoisa).toBe(0);
    expect(surplus.overpaidPoisa).toBe(125_00);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: finalized.id } })).paidPoisa).toBe(700_00);
  });
});
