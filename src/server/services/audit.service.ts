import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Audit trail reads. Rows are append-only and deliberately keep actor names even
 * after an account is deactivated, so a review can always answer "who did this".
 */

export type AuditFilters = {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
};

export async function listAuditLogs(filters: AuditFilters, pagination: { skip: number; take: number }) {
  const where = {
    ...(filters.action ? { action: { startsWith: filters.action } } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorType: true,
        actorLabel: true,
        createdAt: true,
        beforeJson: true,
        afterJson: true,
        metaJson: true,
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { logs: rows, total };
}

/** Everything recorded against one order, bill, payment or table. */
export async function auditTrailFor(entityType: string, entityId: string, limit = 100) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, limit)),
    select: {
      id: true,
      action: true,
      actorType: true,
      actorLabel: true,
      createdAt: true,
      beforeJson: true,
      afterJson: true,
      metaJson: true,
      actor: { select: { name: true, email: true, role: true } },
    },
  });
}

/** Distinct action prefixes, so the UI can offer filters without hardcoding them. */
export async function auditActionSummary(window: { from: Date; to: Date }) {
  const rows = await prisma.$queryRaw<{ action: string; count: bigint }[]>(
    Prisma.sql`
      SELECT action, count(*)::bigint AS count
      FROM audit_logs
      WHERE "createdAt" >= ${window.from} AND "createdAt" < ${window.to}
      GROUP BY action
      ORDER BY count DESC
      LIMIT 60`,
  );
  return rows.map((row) => ({ action: row.action, count: Number(row.count) }));
}
