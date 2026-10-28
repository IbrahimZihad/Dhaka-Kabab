import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/server/services/settings.service";
import { sendEmail, emailTransportStatus } from "@/server/services/email.service";
import type { NotificationStatus, NotificationType, UserRole } from "@prisma/client";

/**
 * Notifications are written to the database first, then delivered. A row only
 * ever reads SENT when an SMTP server accepted the message; when there is no
 * transport, or delivery is switched off, the row is SKIPPED with the reason
 * recorded — so the admin panel can never show a green tick for mail that was
 * never sent.
 */

const STAFF_AUDIENCE: Partial<Record<NotificationType, UserRole[]>> = {
  ORDER_CREATED: ["OWNER", "MANAGER", "KITCHEN", "CASHIER"],
  ORDER_READY: ["OWNER", "MANAGER", "CASHIER"],
  ORDER_STATUS_CHANGED: ["OWNER", "MANAGER"],
  RESERVATION_CREATED: ["OWNER", "MANAGER", "CASHIER"],
  RESERVATION_CONFIRMED: ["OWNER", "MANAGER"],
  RESERVATION_CANCELLED: ["OWNER", "MANAGER"],
  RESERVATION_REMINDER: ["OWNER", "MANAGER"],
  RESERVATION_NO_SHOW: ["OWNER", "MANAGER"],
  PAYMENT_SUCCEEDED: ["OWNER", "MANAGER"],
  PAYMENT_FAILED: ["OWNER", "MANAGER"],
  BILL_SETTLED: ["OWNER", "MANAGER"],
  BILL_REQUESTED: ["OWNER", "MANAGER", "CASHIER"],
  CHAT_ESCALATION: ["OWNER", "MANAGER", "CASHIER"],
};

export type QueueNotificationInput = {
  type: NotificationType;
  subject: string;
  bodyText: string;
  /** Direct recipient, usually the customer. */
  toEmail?: string | null;
  toName?: string | null;
  /** Fan out to the staff roles mapped for this notification type. */
  staffAudience?: boolean;
  relatedKind?: string | null;
  relatedId?: string | null;
};

export type QueueResult = { email: number; inApp: number; skipped: number };

/**
 * Best-effort by design: a notification that cannot be written must never undo
 * an order, a booking or a payment.
 */
export async function queueNotification(input: QueueNotificationInput): Promise<QueueResult> {
  const empty: QueueResult = { email: 0, inApp: 0, skipped: 0 };
  try {
    const transport = await emailTransportStatus();
    const recipients: { email: string; name: string }[] = [];
    const seen = new Set<string>();

    const customerEmail = input.toEmail?.trim().toLowerCase();
    if (customerEmail && isEmail(customerEmail)) {
      recipients.push({ email: customerEmail, name: input.toName?.trim() || "Guest" });
      seen.add(customerEmail);
    }

    let staffRecipients: { email: string; name: string }[] = [];
    if (input.staffAudience) {
      const roles = STAFF_AUDIENCE[input.type] ?? ["OWNER", "MANAGER"];
      staffRecipients = await activeStaffEmails(roles);
    }
    for (const recipient of staffRecipients) {
      const key = recipient.email.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        recipients.push(recipient);
      }
    }

    const sendable = transport.configured && transport.enabled;
    let email = 0;
    for (const recipient of recipients) {
      await prisma.notification.create({
        data: {
          type: input.type,
          channel: "EMAIL",
          toAddress: recipient.email,
          subject: input.subject.slice(0, 300),
          bodyText: input.bodyText.slice(0, 4000),
          status: sendable ? "QUEUED" : "SKIPPED",
          lastError: sendable ? null : transport.reason ?? "Email transport unavailable.",
          relatedKind: input.relatedKind ?? null,
          relatedId: input.relatedId ?? null,
        },
      });
      email += 1;
    }

    // Staff always get an in-app copy, even with no mail configured, so nothing
    // a kitchen or manager needs to see is silently dropped.
    let inApp = 0;
    if (input.staffAudience) {
      await prisma.notification.create({
        data: {
          type: input.type,
          channel: "IN_APP",
          toAddress: `roles:${(STAFF_AUDIENCE[input.type] ?? ["OWNER", "MANAGER"]).join(",")}`,
          subject: input.subject.slice(0, 300),
          bodyText: input.bodyText.slice(0, 4000),
          status: "SENT",
          sentAt: new Date(),
          relatedKind: input.relatedKind ?? null,
          relatedId: input.relatedId ?? null,
        },
      });
      inApp += 1;
    }
    const skipped = sendable ? 0 : email;

    if (sendable && email > 0) {
      // Fire-and-forget: delivery retries are the queue's job, not the request's.
      void processNotificationQueue(10).catch((error) => console.error("[notification-queue]", error));
    }
    return { email, inApp, skipped };
  } catch (error) {
    console.error("[notification-queue] enqueue failed", error);
    return empty;
  }
}

async function activeStaffEmails(roles: UserRole[]): Promise<{ email: string; name: string }[]> {
  const staff = await prisma.user.findMany({
    where: { role: { in: roles }, isActive: true },
    select: { email: true, name: true },
  });
  return staff.filter((person) => isEmail(person.email)).map((person) => ({ email: person.email, name: person.name }));
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Deliver queued mail. Claiming a row moves it to SENDING, so a second worker —
 * or a retried request — cannot send the same message twice.
 */
export async function processNotificationQueue(limit = 20) {
  const transport = await emailTransportStatus();
  const claimed: string[] = [];
  const candidates = await prisma.notification.findMany({
    where: { status: "QUEUED", channel: "EMAIL" },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true },
  });

  for (const candidate of candidates) {
    const won = await prisma.notification.updateMany({
      where: { id: candidate.id, status: "QUEUED" },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });
    if (won.count === 1) claimed.push(candidate.id);
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const id of claimed) {
    const row = await prisma.notification.findUnique({ where: { id } });
    if (!row) continue;
    if (!transport.configured || !transport.enabled || !transport.from) {
      await prisma.notification.update({
        where: { id },
        data: { status: "SKIPPED", lastError: transport.reason ?? "Email unavailable." },
      });
      skipped += 1;
      continue;
    }
    const result = await sendEmail({ to: row.toAddress, subject: row.subject, text: row.bodyText });
    if (result.ok) {
      await prisma.notification.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date(), lastError: null },
      });
      sent += 1;
    } else {
      await prisma.notification.update({
        where: { id },
        data: { status: row.attempts >= 3 ? "FAILED" : "QUEUED", lastError: result.reason },
      });
      failed += 1;
    }
  }

  return { sent, failed, skipped, attempted: claimed.length };
}

/** Re-queue everything that failed or was skipped because transport was missing. */
export async function retryNotifications(ids?: string[]) {
  const where = ids ? { id: { in: ids } } : { status: { in: ["FAILED", "SKIPPED"] satisfies NotificationStatus[] }, channel: "EMAIL" as const };
  const reset = await prisma.notification.updateMany({
    where,
    data: { status: "QUEUED", attempts: 0, lastError: null },
  });
  const processed = await processNotificationQueue(Math.max(10, reset.count));
  return { requeued: reset.count, ...processed };
}

export async function listNotifications(
  filters: { status?: NotificationStatus; type?: NotificationType; relatedId?: string },
  pagination: { skip: number; take: number },
) {
  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.relatedId ? { relatedId: filters.relatedId } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        type: true,
        channel: true,
        toAddress: true,
        subject: true,
        status: true,
        attempts: true,
        lastError: true,
        relatedKind: true,
        relatedId: true,
        sentAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return { rows, total, byStatus: Object.fromEntries(counts.map((group) => [group.status, group._count._all])) };
}

export async function notificationHealth() {
  const [settings, transport] = await Promise.all([getSettings(), emailTransportStatus()]);
  const pending = await prisma.notification.count({ where: { status: { in: ["QUEUED", "SENDING"] } } });
  const failed = await prisma.notification.count({ where: { status: "FAILED" } });
  return {
    smtpConfigured: transport.configured,
    enabledInSettings: settings.emailNotificationsEnabled,
    sendAs: transport.from,
    reason: transport.reason,
    pending,
    failed,
    aiConfigured: Boolean(env.ai),
  };
}
