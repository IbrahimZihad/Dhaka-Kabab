import { prisma, type Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { computeTotals, derivePaymentStatus } from "@/lib/billing-math";
import { formatPoisa } from "@/lib/money";
import { getSettings } from "@/server/services/settings.service";
import { nextDocumentNumber } from "@/server/services/counters";
import { queueNotification } from "@/server/services/notification.service";
import type { BillStatus, PaymentMethod } from "@prisma/client";

/**
 * Bills. An OPEN bill mirrors its session's orders and can be refreshed. A bill is
 * frozen into a financial document — its own line copies, a configuration snapshot
 * and, once nothing is owed, a SETTLED status — and a bill that has taken money, or
 * was voided, is never rewritten. The one thing a finalized bill with no money on it
 * can still do is grow, because a table that orders a second round after the bill was
 * drawn up must not be able to eat unbilled.
 */

export type BillDetail = Awaited<ReturnType<typeof getBillById>>;

/** How long a table's bill request stays "already asked" before it may notify again. */
const BILL_REQUEST_REPEAT_MS = 180_000;

async function chargeSettings(client: Db = prisma) {
  const settings = await getSettings(client);
  return {
    serviceChargeBps: settings.serviceChargeBps,
    vatBps: settings.vatBps,
    vatOnServiceCharge: settings.vatOnServiceCharge,
    roundingStepPoisa: settings.roundingStepPoisa,
    timezone: settings.timezone,
    currencyCode: settings.currencyCode,
  };
}

/**
 * Finds the session's open bill, creating one on first use. Orders already
 * settled on another bill are never pulled back in.
 */
export async function getOrCreateOpenBill(sessionId: string, client: Db = prisma) {
  const existing = await client.bill.findFirst({
    where: { sessionId, status: { in: ["OPEN", "FINALIZED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  const settings = await getSettings(client);
  const session = await client.tableSession.findUnique({ where: { id: sessionId }, include: { table: true } });
  if (!session) throw new AppError("NOT_FOUND", "Table session not found.");
  const number = await nextDocumentNumber("bill", { timeZone: settings.timezone, client });
  return client.bill.create({
    data: { number, sessionId, createdByUserId: null, snapshot: undefined },
  });
}

/**
 * Rebuilds an OPEN bill's lines from its session's orders. Cancelling an order
 * calls this so the balance stays truthful. A bill that nobody has paid yet can
 * still be re-raised by a caller that passes `preserveFinalized: false`, which is
 * how a table's late order reaches the bill already on the screen; a bill that has
 * taken money, or was voided, is an issued document and nothing rewrites it.
 */
export async function refreshBillLines(
  billId: string,
  client: Db = prisma,
  options: { preserveFinalized?: boolean; discountPoisa?: number } = {},
) {
  const bill = await client.bill.findUnique({
    where: { id: billId },
    include: { orders: { include: { order: { include: { items: true } } } }, session: { include: { orders: true } } },
  });
  if (!bill) throw new AppError("NOT_FOUND", "Bill not found.");
  const issued = bill.status === "VOIDED" || bill.status === "SETTLED" || bill.paidPoisa > 0 || bill.refundedPoisa > 0;
  if (issued || (bill.status !== "OPEN" && options.preserveFinalized !== false)) {
    return client.bill.findUniqueOrThrow({ where: { id: billId }, include: { items: true, payments: true } });
  }

  const charges = await chargeSettings(client);
  const candidateIds = bill.sessionId
    ? (bill.session?.orders ?? []).map((order) => order.id)
    : bill.orderId
      ? [bill.orderId]
      : [];
  const sourceOrders = await client.order.findMany({
    where: { id: { in: candidateIds }, status: { not: "CANCELLED" } },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });

  // Link every live order once; unlink anything cancelled since the last refresh.
  const liveIds = new Set(sourceOrders.map((order) => order.id));
  const linkedIds = new Set(bill.orders.map((link) => link.orderId));
  for (const order of sourceOrders) {
    if (!linkedIds.has(order.id)) await client.billOrder.create({ data: { billId: bill.id, orderId: order.id } });
  }
  const stale = [...linkedIds].filter((id) => !liveIds.has(id));
  if (stale.length > 0) {
    await client.billOrder.deleteMany({ where: { billId: bill.id, orderId: { in: stale } } });
  }

  // Line copies are rebuilt from the linked orders. Rebuilding, rather than
  // appending, is what keeps a cancelled order from lingering on an open bill.
  await client.billItem.deleteMany({ where: { billId: bill.id } });
  for (const order of sourceOrders) {
    for (const item of order.items) {
      await client.billItem.create({
        data: {
          billId: bill.id,
          orderItemId: item.id,
          orderNumber: order.orderNumber,
          description: item.nameSnapshot,
          optionsSnapshot: item.optionsSnapshot as object[],
          unitPricePoisa: item.unitPricePoisa,
          quantity: item.quantity,
          lineTotalPoisa: item.lineTotalPoisa,
        },
      });
    }
  }

  const lines = await client.billItem.findMany({ where: { billId: bill.id }, orderBy: { createdAt: "asc" } });
  const deliveryFeePoisa = sourceOrders.reduce((total, order) => total + order.deliveryFeePoisa, 0);
  const totals = computeTotals({
    lines: lines.map((line) => ({ lineTotalPoisa: line.lineTotalPoisa })),
    discountPoisa: options.discountPoisa ?? bill.discountPoisa ?? 0,
    serviceChargeBps: charges.serviceChargeBps,
    vatBps: charges.vatBps,
    vatOnServiceCharge: charges.vatOnServiceCharge,
    roundingStepPoisa: charges.roundingStepPoisa,
    deliveryFeePoisa,
  });

  const paid = await paidOnBill(bill.id, client);

  return client.bill.update({
    where: { id: bill.id },
    data: {
      subtotalPoisa: totals.subtotalPoisa,
      discountPoisa: totals.discountPoisa,
      serviceChargePoisa: totals.serviceChargePoisa,
      vatPoisa: totals.vatPoisa,
      totalPoisa: totals.totalPoisa,
      paidPoisa: paid,
    },
  });
}

async function paidOnBill(billId: string, client: Db = prisma): Promise<number> {
  const settled = await client.payment.aggregate({
    where: { billId, status: "SUCCEEDED" },
    _sum: { amountPoisa: true },
  });
  const refunded = await client.payment.aggregate({
    where: { billId, status: "REFUNDED" },
    _sum: { amountPoisa: true },
  });
  return (settled._sum.amountPoisa ?? 0) - (refunded._sum.amountPoisa ?? 0);
}

export async function finalizeBill(
  billId: string,
  input: { discountPoisa?: number },
  actor: { userId: string; role: string; ip?: string },
) {
  const before = await prisma.bill.findUnique({ where: { id: billId } });
  if (!before) throw new AppError("NOT_FOUND", "Bill not found.");
  if (before.status === "VOIDED") throw new AppError("CONFLICT", "A voided bill cannot be finalized.");

  const bill = await prisma.$transaction(async (tx) => {
    await refreshBillLines(billId, tx, { discountPoisa: input.discountPoisa });
    const charges = await chargeSettings(tx);
    const fresh = await tx.bill.findUniqueOrThrow({
      where: { id: billId },
      include: { items: true, payments: true, orders: true },
    });

    // Finalizing decides whether the bill is already paid. A bill discounted to
    // nothing owes nothing, and no payment can ever arrive to say so — `applyPaymentToBill`
    // refuses a zero amount — so this is the only place that can close it. Re-finalizing
    // a bill that has already taken its money must not un-settle it either.
    const settled = fresh.totalPoisa <= 0 || fresh.paidPoisa >= fresh.totalPoisa;
    const snapshot = {
      takenAt: new Date().toISOString(),
      charges,
      lineCount: fresh.items.length,
      currency: charges.currencyCode,
    };
    const finalized = await tx.bill.update({
      where: { id: billId },
      data: {
        status: settled ? "SETTLED" : "FINALIZED",
        finalizedAt: fresh.finalizedAt ?? new Date(),
        settledAt: settled ? (fresh.settledAt ?? new Date()) : fresh.settledAt,
        snapshot,
      },
    });

    const orderIds = fresh.orders.map((link) => link.orderId);
    if (orderIds.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: { paymentStatus: derivePaymentStatus({ totalPoisa: fresh.totalPoisa, paidPoisa: fresh.paidPoisa }) },
      });
    }
    return finalized;
  });

  // The bill is now on the table, so its outstanding request is answered.
  if (bill.sessionId) {
    await prisma.tableSession.update({ where: { id: bill.sessionId }, data: { billRequestedAt: null } });
  }

  await writeAudit({
    actorUserId: actor.userId,
    action: "bill.finalize",
    entityType: "Bill",
    entityId: billId,
    before: { subtotalPoisa: before.subtotalPoisa, totalPoisa: before.totalPoisa },
    after: { subtotalPoisa: bill.subtotalPoisa, totalPoisa: bill.totalPoisa },
    meta: { discountPoisa: bill.discountPoisa },
    ip: actor.ip,
  });
  return bill;
}

/**
 * Attach a verified payment amount to the bill and roll the covered orders'
 * payment status forward. Called by both counter payments and gateway capture.
 */
export async function applyPaymentToBill(
  billId: string,
  amountPoisa: number,
  options: { method: PaymentMethod; captureVerifiedSurplus?: boolean; actorUserId?: string | null; client?: Db } = {
    method: "CASH",
  },
) {
  const client = options.client ?? prisma;
  const settings = await getSettings(client);
  const bill = await client.bill.findUnique({ where: { id: billId }, include: { orders: true, session: true } });
  if (!bill) throw new AppError("NOT_FOUND", "Bill not found.");
  if (bill.status === "VOIDED") throw new AppError("CONFLICT", "This bill was voided and cannot accept payments.");
  if (amountPoisa <= 0) throw new AppError("VALIDATION", "Payment amount must be greater than zero.");

  // Overpayment is refused for counter money: taking more than is owed puts the
  // restaurant quietly into debt, and the refund path exists to record that.
  // A *verified* gateway capture is the one exception — the guest's money has
  // already moved and cannot be un-taken here, so it is applied and reported.
  const outstanding = Math.max(0, bill.totalPoisa - bill.paidPoisa);
  if (amountPoisa > outstanding && !options.captureVerifiedSurplus) {
    throw new AppError(
      "VALIDATION",
      `That is more than the outstanding ${formatPoisa(outstanding, { symbol: settings.currencySymbol })} on this bill.`,
    );
  }

  const paidPoisa = bill.paidPoisa + amountPoisa;
  const settled = paidPoisa >= bill.totalPoisa;
  const status: BillStatus = settled ? "SETTLED" : bill.status === "OPEN" ? "OPEN" : "FINALIZED";

  const updated = await client.bill.update({
    where: { id: billId },
    data: { paidPoisa, status, settledAt: settled ? new Date() : bill.settledAt },
  });

  const orderIds = bill.orders.map((link) => link.orderId);
  if (orderIds.length > 0) {
    await client.order.updateMany({
      where: { id: { in: orderIds } },
      data: { paymentStatus: derivePaymentStatus({ totalPoisa: updated.totalPoisa, paidPoisa }) },
    });
  }
  if (settled && bill.sessionId) {
    // Settling does not close the visit; staff confirm the guests have left.
    await client.tableSession.updateMany({ where: { id: bill.sessionId, status: "ACTIVE" }, data: { notes: null } });
  }
  return {
    bill: updated,
    settled,
    outstandingPoisa: Math.max(0, updated.totalPoisa - updated.paidPoisa),
    /** Money taken beyond the invoice; it is owed back and shows on the receipt. */
    overpaidPoisa: Math.max(0, updated.paidPoisa - updated.totalPoisa),
  };
}

export async function recordRefundOnBill(billId: string, amountPoisa: number, client: Db = prisma) {
  const bill = await client.bill.findUnique({ where: { id: billId } });
  if (!bill) throw new AppError("NOT_FOUND", "Bill not found.");
  const refundedPoisa = bill.refundedPoisa + amountPoisa;
  const paidPoisa = Math.max(0, bill.paidPoisa - amountPoisa);
  return client.bill.update({
    where: { id: billId },
    data: { refundedPoisa, paidPoisa, status: paidPoisa === 0 && bill.status === "SETTLED" ? "FINALIZED" : bill.status },
  });
}

export async function voidBill(
  billId: string,
  reason: string,
  actor: { userId: string; role: string; ip?: string },
) {
  if (!["OWNER", "MANAGER"].includes(actor.role)) {
    throw new AppError("FORBIDDEN", "Only a manager or owner can void a finalized bill.");
  }
  const bill = await prisma.bill.findUnique({ where: { id: billId }, include: { payments: true } });
  if (!bill) throw new AppError("NOT_FOUND", "Bill not found.");
  if (bill.status === "VOIDED") return bill;
  const taken = bill.payments.filter((payment) => payment.status === "SUCCEEDED").reduce((total, payment) => total + payment.amountPoisa, 0);
  if (taken > 0) {
    throw new AppError("CONFLICT", "This bill has verified payments. Refund them before voiding the bill.");
  }

  const voided = await prisma.bill.update({
    where: { id: billId },
    data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason },
  });
  await writeAudit({
    actorUserId: actor.userId,
    action: "bill.void",
    entityType: "Bill",
    entityId: billId,
    before: { status: bill.status, totalPoisa: bill.totalPoisa },
    after: { status: "VOIDED" },
    meta: { reason },
    ip: actor.ip,
  });
  return voided;
}

export async function getBillById(billId: string, client: Db = prisma) {
  const bill = await client.bill.findUnique({
    where: { id: billId },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      orders: { include: { order: { select: { orderNumber: true, createdAt: true, status: true, type: true } } } },
      payments: { orderBy: { createdAt: "asc" } },
      refunds: { orderBy: { createdAt: "asc" } },
      session: { include: { table: { select: { label: true, number: true } } } },
      order: { select: { orderNumber: true, contactName: true, contactPhone: true, type: true } },
    },
  });
  if (!bill) throw new AppError("NOT_FOUND", "Bill not found.");
  return bill;
}

export async function listBills(filters: { status?: BillStatus; from?: Date; to?: Date; search?: string }, pagination: { skip: number; take: number }) {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) };
  }
  if (filters.search) {
    where.OR = [
      { number: { contains: filters.search, mode: "insensitive" } },
      { session: { table: { label: { contains: filters.search.toUpperCase(), mode: "insensitive" } } } },
    ];
  }
  const [bills, total] = await Promise.all([
    prisma.bill.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        session: { select: { code: true, table: { select: { label: true } } } },
        order: { select: { orderNumber: true, contactName: true } },
        payments: { where: { status: "SUCCEEDED" }, select: { amountPoisa: true, method: true } },
      },
    }),
    prisma.bill.count({ where }),
  ]);
  return { bills, total };
}

/**
 * Everything a receipt needs, resolved once. The restaurant identity comes from
 * settings at print time; the money comes from the bill's stored snapshot.
 */
export async function buildReceipt(billId: string, client: Db = prisma) {
  const [bill, settings] = await Promise.all([getBillById(billId, client), getSettings(client)]);
  const outstanding = Math.max(0, bill.totalPoisa - bill.paidPoisa);
  const snapshotCharges =
    bill.snapshot && typeof bill.snapshot === "object" && "charges" in (bill.snapshot as Record<string, unknown>)
      ? (bill.snapshot as { charges?: { serviceChargeBps?: number; vatBps?: number; takenAt?: string; roundingStepPoisa?: number } }).charges
      : undefined;

  const roundedAway = roundedAdjustment(bill, settings.roundingStepPoisa);

  return {
    number: bill.number,
    status: bill.status,
    issuedAt: bill.finalizedAt ?? bill.createdAt,
    table: bill.session?.table.label ?? null,
    sessionCode: bill.session?.code ?? null,
    orders: bill.orders.map((link) => link.order.orderNumber),
    customer: bill.order?.contactName ?? null,
    items: bill.items.map((item) => ({
      description: item.description,
      orderNumber: item.orderNumber,
      quantity: item.quantity,
      unitPricePoisa: item.unitPricePoisa,
      lineTotalPoisa: item.lineTotalPoisa,
      options: Array.isArray(item.optionsSnapshot) ? (item.optionsSnapshot as { optionName?: string; groupName?: string }[]) : [],
    })),
    subtotalPoisa: bill.subtotalPoisa,
    discountPoisa: bill.discountPoisa,
    serviceChargePoisa: bill.serviceChargePoisa,
    vatPoisa: bill.vatPoisa,
    roundingAdjustmentPoisa: roundedAway,
    totalPoisa: bill.totalPoisa,
    paidPoisa: bill.paidPoisa,
    refundedPoisa: bill.refundedPoisa,
    outstandingPoisa: outstanding,
    /** Positive only when the guest paid more than the invoice, i.e. is owed money. */
    overpaidPoisa: Math.max(0, bill.paidPoisa - bill.totalPoisa),
    currencySymbol: settings.currencySymbol,
    currencyCode: settings.currencyCode,
    payments: bill.payments.map((payment) => ({
      reference: payment.reference,
      method: payment.method,
      status: payment.status,
      amountPoisa: payment.amountPoisa,
      verifiedAt: payment.verifiedAt,
      provider: payment.provider,
      gatewayTxnId: payment.gatewayTxnId,
      isDemo: payment.isDemo,
    })),
    refunds: bill.refunds.map((refund) => ({
      number: refund.number,
      amountPoisa: refund.amountPoisa,
      reason: refund.reason,
      status: refund.status,
      processedAt: refund.processedAt,
    })),
    restaurant: {
      header: settings.receiptHeader,
      name: settings.name,
      addressLine1: settings.addressLine1,
      addressLine2: settings.addressLine2,
      city: settings.city,
      phone: settings.phonePrimary,
      footer: settings.receiptFooter,
      timezone: settings.timezone,
    },
    chargeBasis: snapshotCharges ?? { serviceChargeBps: settings.serviceChargeBps, vatBps: settings.vatBps },
    isDemo: bill.isDemo,
  };
}

/**
 * The rounding line on a receipt is derived, not stored: recompute the pre-round
 * figure from the stored components so the printed arithmetic always adds up.
 */
function roundedAdjustment(bill: BillDetail, roundingStepPoisa: number): number {
  if (roundingStepPoisa <= 1) return 0;
  // serviceChargePoisa and vatPoisa were each computed then rounded once, so the
  // only remaining adjustment is the total's step rounding.
  const beforeRounding = bill.subtotalPoisa - bill.discountPoisa + bill.serviceChargePoisa + bill.vatPoisa;
  return bill.totalPoisa - beforeRounding;
}

export async function openBillForSession(sessionId: string, actor: { userId: string; role: string; ip?: string }) {
  const settings = await getSettings();
  const session = await prisma.tableSession.findUnique({ where: { id: sessionId }, include: { table: true } });
  if (!session) throw new AppError("NOT_FOUND", "Table session not found.");
  const bill = await getOrCreateOpenBill(sessionId);
  // A bill nobody has paid yet may still be re-raised, because a table that orders
  // a second round after the bill was drawn up must not be able to eat unbilled.
  // `refreshBillLines` refuses to touch one that has taken money or was voided.
  const refreshed = await refreshBillLines(bill.id, prisma, { preserveFinalized: false });
  if (bill.status !== "OPEN") return refreshed;
  await writeAudit({
    actorUserId: actor.userId,
    action: "bill.open",
    entityType: "Bill",
    entityId: bill.id,
    meta: { table: session.table.label, currency: settings.currencyCode },
    ip: actor.ip,
  });
  return refreshed;
}

/**
 * A guest at a table tapped "Ask for the bill". Nothing about the bill changes —
 * this only puts a request in front of the floor staff, and it is deliberately
 * not a payment action.
 */
export async function requestBillForSession(participantToken: string) {
  const guest = await prisma.tableSessionGuest.findUnique({
    where: { participantToken },
    include: {
      session: {
        include: {
          table: true,
          bills: { where: { status: { in: ["OPEN", "FINALIZED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!guest) throw new AppError("NOT_FOUND", "This table link is no longer active. Please ask staff for help.");
  if (guest.session.status !== "ACTIVE") {
    throw new AppError("SESSION_CLOSED", "This table was already settled.");
  }

  const bill = guest.session.bills[0] ?? null;
  const outstanding = bill ? Math.max(0, bill.totalPoisa - bill.paidPoisa) : 0;
  const settings = await getSettings();

  // Staff have not come yet, so a second tap from the same table is the same
  // request. One notification per table per few minutes keeps the queue readable.
  const alreadyAsked =
    guest.session.billRequestedAt !== null &&
    Date.now() - guest.session.billRequestedAt.getTime() < BILL_REQUEST_REPEAT_MS;

  if (!alreadyAsked) {
    await prisma.tableSession.update({
      where: { id: guest.session.id },
      data: { billRequestedAt: new Date() },
    });
    await queueNotification({
      type: "BILL_REQUESTED",
      subject: `Table ${guest.session.table.label} asked for the bill`,
      bodyText: bill
        ? `Session ${guest.session.code}, bill ${bill.number}: ${formatPoisa(outstanding, { symbol: settings.currencySymbol })} outstanding.`
        : `Session ${guest.session.code}: the table has no bill yet.`,
      staffAudience: true,
      relatedKind: "TableSession",
      relatedId: guest.session.id,
    });
  }

  return {
    table: guest.session.table.label,
    billNumber: bill?.number ?? null,
    outstandingPoisa: outstanding,
    duplicate: alreadyAsked,
  };
}
