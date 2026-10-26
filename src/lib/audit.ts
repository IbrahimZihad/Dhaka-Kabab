import { createHash } from "node:crypto";
import { prisma, type Db } from "@/lib/db";
import type { AuditActorType, Prisma } from "@prisma/client";

const SECRET_KEYS = /password|passwd|secret|token|apikey|api_key|authorization|cookie|cardnumber|cvv|hash/i;

/** Recursive redaction so an audit entry can never carry a credential or a PAN. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? "[redacted]" : redact(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

export type AuditInput = {
  db?: Db;
  actorUserId?: string | null;
  actorType?: AuditActorType;
  actorLabel?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string | null;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  const client = input.db ?? prisma;
  try {
    await client.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorType: input.actorType ?? (input.actorUserId ? "USER" : "SYSTEM"),
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeJson: input.before === undefined ? undefined : (redact(input.before) as Prisma.InputJsonValue),
        afterJson: input.after === undefined ? undefined : (redact(input.after) as Prisma.InputJsonValue),
        metaJson: input.meta === undefined ? undefined : (redact(input.meta) as Prisma.InputJsonValue),
        ipHash: input.ip ? createHash("sha256").update(input.ip).digest("hex").slice(0, 32) : null,
      },
    });
  } catch (error) {
    // Auditing must never break the business operation it describes.
    console.error("[audit] write failed", input.action, error instanceof Error ? error.message : error);
  }
}
