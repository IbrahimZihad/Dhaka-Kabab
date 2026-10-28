import { prisma, type Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { writeAudit } from "@/lib/audit";
import { randomToken, payloadFingerprint } from "@/lib/ids";
import { formatPoisa } from "@/lib/money";
import { zonedParts } from "@/lib/time";
import { getSettings } from "@/server/services/settings.service";
import { nextDocumentNumber } from "@/server/services/counters";
import {
  applyPaymentToBill,
  recordRefundOnBill,
} from "@/server/services/billing.service";
import { resolveProvider } from "@/server/services/providers";
import { simulatedProof } from "@/server/services/providers/simulated";
import type { PaymentProvider } from "@/server/services/providers/payment-provider";
import { queueNotification } from "@/server/services/notification.service";
import type { PaymentMethod, PaymentRecordStatus } from "@prisma/client";

/**
 * Payments. A record is only ever SUCCEEDED because a provider verified it:
 * counter payments are verified by the staff member who took the cash (and are
 * attributed to their user id), online payments by the gateway's validation
 * response. The customer's return URL changes nothing.
 */

export type NewPendingPayment = {
  billId: string;
  amountPoisa: number;
  method: PaymentMethod;
  provider: string;
  reference: string;
  isDemo: boolean;
};

const TERMINAL: PaymentRecordStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED"];

function paymentReference(timeZone: string, at = new Date()): string {
  const date = zonedParts(at, timeZone).dateKey.replaceAll("-", "");
  return `PAY${date.slice(2)}${randomToken(9).toUpperCase()}`;
}

/**
 * Staff-confirmed payment taken at the counter. The actor is stored so the money
 * is always attributable to a person, and the bill rolls forward atomically.
 */
export async function recordCounterPayment(input: {
  billId?: string;
  orderId?: string;
  method: PaymentMethod;
  amountPoisa: number;
  reference?: string;
  note?: string;
  actor: { userId: string; ip?: string };
}) {
  if (input.method === "ONLINE_GATEWAY") {
    throw new AppError("VALIDATION", "Online payments are captured by the gateway, not recorded at the counter.");
  }
  const settings = await getSettings();
  let orderOnlySettled = false;

  return prisma.$transaction(async (tx) => {
    const target = await resolveTarget(input.billId, input.orderId, tx);
    const outstanding = Math.max(0, target.totalPoisa - target.paidPoisa);
    if (input.amountPoisa > outstanding) {
      throw new AppError(
        "VALIDATION",
        `That is more than the outstanding ${formatPoisa(outstanding, { symbol: settings.currencySymbol })}. Record the exact amount taken, or refund the difference.`,
      );
    }

    const payment = await tx.payment.create({
      data: {
        reference: input.reference?.trim() || paymentReference(settings.timezone),
        billId: target.billId,
        orderId: target.orderId ?? null,
        method: input.method,
        status: "SUCCEEDED",
        amountPoisa: input.amountPoisa,
        currency: settings.currencyCode,
        provider: "counter",
        takenByUserId: input.actor.userId,
        verifiedAt: new Date(),
        failureReason: input.note ?? null,
        isDemo: false,
      },
    });

    const applied = target.billId
      ? await applyPaymentToBill(target.billId, input.amountPoisa, {
          method: input.method,
          actorUserId: input.actor.userId,
          client: tx,
        })
      : null;

    if (target.orderId && !target.billId) {
      const settled = input.amountPoisa >= target.totalPoisa - target.paidPoisa;
      await tx.order.update({
        where: { id: target.orderId },
        data: { paymentStatus: settled ? "PAID" : "PARTIAL" },
      });
      orderOnlySettled = settled;
    }

    await writeAudit({
      actorUserId: input.actor.userId,
      action: "payment.record",
      entityType: "Payment",
      entityId: payment.id,
      after: { amountPoisa: input.amountPoisa, method: input.method, bill: target.billNumber },
      ip: input.actor.ip,
    });

    const settled = applied?.settled ?? orderOnlySettled;
    const outstandingPoisa = applied?.outstandingPoisa ?? Math.max(0, target.totalPoisa - target.paidPoisa - input.amountPoisa);

    await queueNotification({
      type: settled ? "BILL_SETTLED" : "PAYMENT_SUCCEEDED",
      subject: settled ? `Bill ${target.billNumber} settled` : `Payment received on ${target.billNumber}`,
      bodyText: `${formatPoisa(input.amountPoisa, { symbol: settings.currencySymbol })} received by ${input.method}. ${formatPoisa(
        outstandingPoisa,
        { symbol: settings.currencySymbol },
      )} outstanding.`,
      relatedKind: "Bill",
      relatedId: target.billId ?? target.orderId,
      staffAudience: true,
    });

    return { payment, settled, outstandingPoisa, billNumber: target.billNumber };
  });
}

type BillTarget = {
  billId: string | null;
  orderId: string | null;
  billNumber: string;
  totalPoisa: number;
  paidPoisa: number;
};

async function resolveTarget(billId: string | undefined, orderId: string | undefined, client: Db): Promise<BillTarget> {
  if (billId) {
    const bill = await client.bill.findUnique({ where: { id: billId }, include: { order: { select: { id: true } } } });
    if (!bill) throw new AppError("NOT_FOUND", "Bill not found.");
    if (bill.status === "VOIDED") throw new AppError("CONFLICT", "This bill was voided.");
    return {
      billId: bill.id,
      orderId: bill.orderId,
      billNumber: bill.number,
      totalPoisa: bill.totalPoisa,
      paidPoisa: bill.paidPoisa,
    };
  }
  const order = await client.order.findUnique({
    where: { id: orderId },
    include: {
      bills: {
        where: { bill: { status: { not: "VOIDED" } } },
        include: { bill: true },
        orderBy: { bill: { createdAt: "desc" } },
      },
      standaloneBills: { where: { status: { not: "VOIDED" } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) throw new AppError("NOT_FOUND", "Order not found.");
  const coveringBill = order.bills[0]?.bill ?? order.standaloneBills[0] ?? null;
  if (coveringBill) {
    return {
      billId: coveringBill.id,
      orderId: order.id,
      billNumber: coveringBill.number,
      totalPoisa: coveringBill.totalPoisa,
      paidPoisa: coveringBill.paidPoisa,
    };
  }
  return {
    billId: null,
    orderId: order.id,
    billNumber: order.orderNumber,
    totalPoisa: order.totalPoisa,
    paidPoisa: order.paymentStatus === "PAID" ? order.totalPoisa : 0,
  };
}

/**
 * Open a gateway transaction. The pending row is written *before* the redirect
 * exists, so a notification arriving immediately after the hand-off already has
 * something to match against.
 */
export async function initiateGatewayPayment(input: {
  billId: string;
  amountPoisa?: number;
  customer: { name: string; email: string; phone: string };
  returnUrl: string;
  /** Absent for a guest self-serve hand-off — no staff member took the payment. */
  actor?: { userId?: string; ip?: string };
}) {
  const settings = await getSettings();
  const provider = await resolveProvider();
  const bill = await prisma.bill.findUnique({ where: { id: input.billId }, include: { items: true, session: { include: { table: true } } } });
  if (!bill) throw new AppError("NOT_FOUND", "Bill not found.");
  if (bill.status === "VOIDED") throw new AppError("CONFLICT", "This bill was voided.");

  const outstanding = Math.max(0, bill.totalPoisa - bill.paidPoisa);
  const amountPoisa = input.amountPoisa ?? outstanding;
  if (amountPoisa <= 0) throw new AppError("CONFLICT", "This bill is already paid in full.");
  if (amountPoisa > outstanding) throw new AppError("VALIDATION", "That is more than the outstanding balance.");
  if (!settings.enablePartialPayments && amountPoisa !== outstanding) {
    throw new AppError("VALIDATION", "Partial online payments are disabled for this restaurant.");
  }

  const reference = paymentReference(settings.timezone);
  const pending = await prisma.payment.create({
    data: {
      reference,
      billId: bill.id,
      orderId: bill.orderId,
      method: "ONLINE_GATEWAY",
      status: "PENDING",
      amountPoisa,
      currency: settings.currencyCode,
      provider: provider.id,
      takenByUserId: input.actor?.userId ?? null,
      isDemo: provider.isDemo,
      gatewayPayload: { initiatedAt: new Date().toISOString(), mode: provider.mode, outstandingPoisa: outstanding },
    },
  });

  const handoff = await provider.init({
    reference,
    amountPoisa,
    currency: settings.currencyCode,
    description: `${settings.name} ${bill.number}${bill.session ? ` table ${bill.session.table.label}` : ""}`,
    customer: input.customer,
    returnUrl: input.returnUrl,
    failUrl: input.returnUrl,
    cancelUrl: input.returnUrl,
    callbackUrl: `${env.appUrl}/api/payments/gateway/callback`,
  });

  await prisma.payment.update({
    where: { id: pending.id },
    data: { gatewayPayload: { ...handoff.form, initiatedAt: pending.createdAt.toISOString(), mode: handoff.mode, isDemo: handoff.isDemo } },
  });

  await writeAudit({
    actorUserId: input.actor?.userId ?? null,
    action: "payment.gateway.init",
    entityType: "Payment",
    entityId: pending.id,
    after: { amountPoisa, provider: provider.id, mode: provider.mode, isDemo: provider.isDemo },
    ip: input.actor?.ip,
  });

  return {
    paymentId: pending.id,
    reference,
    actionUrl: handoff.actionUrl,
    httpMethod: handoff.httpMethod,
    form: handoff.form ?? {},
    notice: handoff.notice,
    isDemo: handoff.isDemo,
    providerLabel: provider.label,
    completionProof: handoff.completionProof,
    amountPoisa,
    currency: settings.currencyCode,
  };
}

/**
 * Strips the simulated-completion proof from a hand-off before it is sent to a
 * browser. Whoever holds it can write an "approved" notification, so it stays
 * server-side and the development payment page asks us to complete the payment
 * instead (`POST /api/payments/simulated/complete`).
 */
export function publicHandoff<T extends { completionProof?: string }>(result: T): Omit<T, "completionProof"> {
  const { completionProof: _proof, ...rest } = result;
  void _proof;
  return rest;
}

/**
 * A guest at a table paying their own share from their phone. The caller proves
 * nothing but possession of the participant token, so the bill must already be
 * FINALIZED — an open bill can still grow underneath them, and a guest must never
 * be charged against a moving total.
 */
export async function initiateGuestGatewayPayment(input: {
  participantToken: string;
  amountPoisa?: number;
  customer: { name: string; email: string; phone: string };
  ip?: string;
}) {
  const guest = await prisma.tableSessionGuest.findUnique({
    where: { participantToken: input.participantToken },
    include: {
      session: {
        include: {
          table: { select: { label: true } },
          bills: { where: { status: { in: ["OPEN", "FINALIZED", "SETTLED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!guest) throw new AppError("NOT_FOUND", "This table link is no longer active. Please ask staff for help.");
  if (guest.session.status !== "ACTIVE") throw new AppError("SESSION_CLOSED", "This table was already settled.");

  const bill = guest.session.bills[0];
  if (!bill) throw new AppError("NOT_FOUND", "There is no bill for this table yet. Ask staff to bring the bill.");
  if (bill.status === "OPEN") {
    throw new AppError("CONFLICT", "The bill for this table is not finalized yet, so the total can still change. Please ask staff for the bill first.");
  }
  if (bill.status === "SETTLED") throw new AppError("CONFLICT", "This bill is already paid in full.");

  return initiateGatewayPayment({
    billId: bill.id,
    amountPoisa: input.amountPoisa,
    customer: input.customer,
    // No table token in the return URL: a third-party gateway must not be handed
    // the code that opens this table's ordering session.
    returnUrl: `${env.appUrl}/order`,
    actor: { ip: input.ip },
  });
}

/**
 * Completes a simulated hand-off from the server, so the development payment
 * page never has to hold a proof. The notification is built here and run through
 * the same verification, idempotency and audit path as a real gateway callback —
 * nothing about the money logic is special-cased for the demo.
 *
 * Refused outright in production: a button that pretends money moved has no
 * place on a live till, however the provider is configured.
 */
export async function completeSimulatedPayment(input: {
  reference: string;
  outcome: "APPROVED" | "DECLINED" | "ABANDONED";
}) {
  if (env.isProduction) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "The simulated payment page is switched off in production.");
  }

  const payment = await prisma.payment.findUnique({
    where: { reference: input.reference },
    select: { id: true, reference: true, amountPoisa: true, provider: true, isDemo: true, status: true },
  });
  if (!payment) throw new AppError("NOT_FOUND", "No payment matches that reference.");
  if (payment.provider !== "simulated" || !payment.isDemo) {
    throw new AppError("VALIDATION", "This payment was handed to a real gateway and must be completed there.");
  }

  const provider = await resolveProvider();
  if (provider.id !== "simulated") {
    throw new AppError("CONFLICT", "The simulated gateway is no longer the enabled provider.");
  }

  const url = new URL(`${env.appUrl}/api/payments/gateway/callback`);
  url.searchParams.set("dk_ref", payment.reference);
  url.searchParams.set("dk_amount", (payment.amountPoisa / 100).toFixed(2));
  url.searchParams.set("dk_outcome", input.outcome);
  url.searchParams.set("dk_proof", simulatedProof(payment.reference));

  return handleGatewayCallback(new Request(url.toString()), provider);
}

/**
 * What the development gateway page shows about a payment: enough to recognise
 * the bill it is paying, and nothing that lets the page decide the outcome.
 */
export async function simulatedPaymentView(reference: string) {
  if (env.isProduction) return null;
  const payment = await prisma.payment.findUnique({
    where: { reference },
    select: {
      id: true,
      reference: true,
      amountPoisa: true,
      currency: true,
      provider: true,
      isDemo: true,
      status: true,
      createdAt: true,
      bill: {
        select: {
          id: true,
          number: true,
          totalPoisa: true,
          paidPoisa: true,
          session: { select: { table: { select: { label: true } } } },
        },
      },
    },
  });
  if (!payment || payment.provider !== "simulated") return null;
  const settings = await getSettings();
  return {
    reference: payment.reference,
    status: payment.status,
    amountPoisa: payment.amountPoisa,
    amount: formatPoisa(payment.amountPoisa, { symbol: settings.currencySymbol }),
    billNumber: payment.bill?.number ?? null,
    billTotal: payment.bill ? formatPoisa(payment.bill.totalPoisa, { symbol: settings.currencySymbol }) : null,
    billOutstanding: payment.bill
      ? formatPoisa(Math.max(0, payment.bill.totalPoisa - payment.bill.paidPoisa), { symbol: settings.currencySymbol })
      : null,
    tableLabel: payment.bill?.session?.table.label ?? null,
    currencySymbol: settings.currencySymbol,
  };
}

/**
 * Handle a gateway notification. Idempotent by design: the same body arriving
 * twice is acknowledged without moving money twice, and a second *different*
 * body that would change a terminal outcome is refused.
 */
export async function handleGatewayCallback(request: Request, providerOverride?: PaymentProvider) {
  const provider = providerOverride ?? (await resolveProvider());
  const notification = await provider.readNotification(request);
  const reference = notification.tran_id ?? notification.dk_ref ?? notification.val_tran_id;
  if (!reference) throw new AppError("VALIDATION", "Gateway notification had no transaction reference.");

  const payment = await prisma.payment.findUnique({
    where: { reference },
    include: { bill: { select: { id: true, number: true, totalPoisa: true } } },
  });
  if (!payment) throw new AppError("NOT_FOUND", "No pending payment matches this notification.");

  const fingerprint = payloadFingerprint(notification);
  const eventKey = `${payment.id}:${fingerprint}`;
  const duplicateBody = await prisma.paymentEvent.findUnique({ where: { eventKey } });
  if (duplicateBody) {
    return { status: payment.status, duplicate: true as const, paymentId: payment.id };
  }

  const settings = await getSettings();
  let verification;
  try {
    verification = await provider.verify(notification, {
      reference,
      amountPoisa: payment.amountPoisa,
      currency: payment.currency,
    });
  } catch (error) {
    await prisma.paymentEvent
      .create({ data: { paymentId: payment.id, eventKey, kind: "rejected", payload: redactNotification(notification) } })
      .catch(() => undefined);
    if (error instanceof AppError && error.code === "PAYMENT_UNVERIFIED") {
      await prisma.payment.update({ where: { id: payment.id }, data: { failureReason: error.message } });
    }
    throw error;
  }

  // A settled record is immutable: a later notification that disagrees is logged
  // and refused rather than rewriting the financial history.
  if (TERMINAL.includes(payment.status) && payment.status !== verification.status) {
    await prisma.paymentEvent
      .create({ data: { paymentId: payment.id, eventKey, kind: "ignored", payload: redactNotification(verification.raw) } })
      .catch(() => undefined);
    throw new AppError(
      "CONFLICT",
      `This payment was already ${payment.status.toLowerCase()}; a ${verification.status.toLowerCase()} notification for it was refused.`,
    );
  }

  const outcome = await prisma.$transaction(async (tx) => {
    try {
      await tx.paymentEvent.create({
        data: { paymentId: payment.id, eventKey, kind: verification.status.toLowerCase(), payload: redactNotification(verification.raw) },
      });
    } catch (error) {
      // Two identical notifications racing: the loser records nothing further.
      if (isDuplicateKeyError(error)) return null;
      throw error;
    }

    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (TERMINAL.includes(fresh.status)) return { payment: fresh, firstCapture: false };

    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: verification.status,
        gatewayTxnId: verification.gatewayTxnId,
        verifiedAt: verification.status === "SUCCEEDED" ? new Date() : fresh.verifiedAt,
        failureReason: verification.reason,
        gatewayPayload: redactNotification(verification.raw),
        callbackFingerprint: fresh.callbackFingerprint ?? fingerprint,
        isDemo: verification.isDemo,
      },
    });
    return { payment: updatedPayment, firstCapture: fresh.status === "PENDING" && verification.status === "SUCCEEDED" };
  });

  if (!outcome) return { status: payment.status, duplicate: true as const, paymentId: payment.id };

  if (outcome.firstCapture && payment.billId) {
    const applied = await applyPaymentToBill(payment.billId, verification.amountPoisa, {
      method: "ONLINE_GATEWAY",
      // The capture is verified, so the money has already moved; recording it is
      // safer than refusing the notification.
      captureVerifiedSurplus: true,
    });
    await queueNotification({
      type: applied.settled ? "BILL_SETTLED" : "PAYMENT_SUCCEEDED",
      subject: `${provider.label} payment of ${formatPoisa(verification.amountPoisa, { symbol: settings.currencySymbol })} received`,
      bodyText: `${payment.bill?.number ?? "Invoice"} ${applied.settled ? "is settled" : "has a payment recorded"}.${
        verification.isDemo ? " This was a simulated or sandbox transaction — no real money moved." : ""
      }`,
      relatedKind: "Bill",
      relatedId: payment.billId,
      staffAudience: true,
      toEmail: verification.isDemo ? undefined : payment.bill ? settings.emailPublic || undefined : undefined,
    });
    await writeAudit({
      actorUserId: null,
      action: "payment.gateway.verified",
      entityType: "Payment",
      entityId: payment.id,
      after: { status: "SUCCEEDED", amountPoisa: verification.amountPoisa, provider: provider.id, isDemo: verification.isDemo },
    });
  } else if (verification.status !== "PENDING" && !outcome.firstCapture) {
    await writeAudit({
      actorUserId: null,
      action: `payment.gateway.${verification.status.toLowerCase()}`,
      entityType: "Payment",
      entityId: payment.id,
      after: { status: verification.status, reason: verification.reason },
    });
  }

  return { status: outcome.payment.status, duplicate: false as const, paymentId: payment.id, isDemo: verification.isDemo };
}

/** Credentials never persist, even when a gateway echoes them back to us. */
const NEVER_STORED = new Set(["verify_key", "verify_sign", "verify_payload", "secret_key", "api_key", "store_id", "dk_proof", "sig"]);

function redactNotification(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => !NEVER_STORED.has(key.toLowerCase()))
      .map(([key, value]) => [key, String(value).slice(0, 200)]),
  );
}

/**
 * Refund against a verified payment. Counter refunds are recorded as completed
 * because the staff member physically handed the cash back; a live gateway
 * refund stays PENDING until that gateway confirms it.
 */
export async function refundPayment(input: {
  paymentId: string;
  amountPoisa: number;
  reason: string;
  actor: { userId: string; role: string; ip?: string };
}) {
  const settings = await getSettings();
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    include: { bill: true, refunds: true },
  });
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");
  if (payment.status !== "SUCCEEDED") throw new AppError("CONFLICT", "Only a verified payment can be refunded.");
  if (input.amountPoisa <= 0) throw new AppError("VALIDATION", "Refund amount must be greater than zero.");

  const alreadyRefunded = payment.refunds
    .filter((refund) => refund.status !== "FAILED")
    .reduce((total, refund) => total + refund.amountPoisa, 0);
  if (alreadyRefunded + input.amountPoisa > payment.amountPoisa) {
    throw new AppError(
      "VALIDATION",
      `Only ${formatPoisa(payment.amountPoisa - alreadyRefunded, { symbol: settings.currencySymbol })} of this payment is still refundable.`,
    );
  }

  const number = await nextDocumentNumber("refund", { timeZone: settings.timezone });
  const refund = await prisma.refund.create({
    data: {
      number,
      paymentId: payment.id,
      billId: payment.billId,
      amountPoisa: input.amountPoisa,
      currency: payment.currency,
      reason: input.reason,
      status: payment.provider === "counter" ? "COMPLETED" : "PENDING",
      isDemo: payment.isDemo,
    },
  });

  if (payment.provider !== "counter" && !payment.isDemo) {
    // A live gateway refund must be confirmed by that gateway before we may show
    // the customer their money came back, so the record stays PENDING.
    await writeAudit({
      actorUserId: input.actor.userId,
      action: "refund.pending_gateway",
      entityType: "Refund",
      entityId: refund.id,
      after: { provider: payment.provider, amountPoisa: input.amountPoisa },
      ip: input.actor.ip,
    });
    return {
      refund,
      applied: false as const,
      message: `Refund queued with ${payment.provider}. It stays pending until the gateway confirms it.`,
    };
  }

  const completed = await prisma.$transaction(async (tx) => {
    const settled = await tx.refund.update({
      where: { id: refund.id },
      data: { status: "COMPLETED", processedByUserId: input.actor.userId, processedAt: new Date(), gatewayRefundId: payment.isDemo ? "SIMULATED" : null },
    });
    if (payment.billId) await recordRefundOnBill(payment.billId, input.amountPoisa, tx);
    const remaining = await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { refunds: true } });
    const totalRefunded = remaining.refunds
      .filter((entry) => entry.status === "COMPLETED")
      .reduce((total, entry) => total + entry.amountPoisa, 0);
    if (totalRefunded >= remaining.amountPoisa) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
      if (remaining.orderId) await tx.order.update({ where: { id: remaining.orderId }, data: { paymentStatus: "REFUNDED" } });
    }
    return settled;
  });

  await writeAudit({
    actorUserId: input.actor.userId,
    action: "refund.record",
    entityType: "Refund",
    entityId: refund.id,
    before: { refundedPoisa: alreadyRefunded },
    after: { refundedPoisa: alreadyRefunded + input.amountPoisa, reason: input.reason },
    ip: input.actor.ip,
  });

  return { refund: completed, applied: true as const };
}

export async function getPaymentStatus(reference: string) {
  const payment = await prisma.payment.findUnique({
    where: { reference },
    select: {
      id: true,
      reference: true,
      status: true,
      amountPoisa: true,
      currency: true,
      provider: true,
      isDemo: true,
      verifiedAt: true,
      failureReason: true,
      createdAt: true,
      bill: { select: { id: true, number: true, totalPoisa: true, paidPoisa: true, status: true } },
    },
  });
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");
  return payment;
}

export async function listPayments(
  filters: { status?: PaymentRecordStatus; provider?: string; billId?: string; from?: Date; to?: Date },
  pagination: { skip: number; take: number },
) {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.provider) where.provider = filters.provider;
  if (filters.billId) where.billId = filters.billId;
  if (filters.from || filters.to) {
    where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) };
  }
  const [payments, total, refunded] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        bill: { select: { number: true } },
        takenBy: { select: { name: true, email: true } },
        refunds: { select: { amountPoisa: true, status: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.refund.aggregate({ where: { status: "COMPLETED" }, _sum: { amountPoisa: true } }),
  ]);
  return { payments, total, refundedPoisa: refunded._sum.amountPoisa ?? 0 };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
