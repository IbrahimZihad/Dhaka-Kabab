import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { randomToken } from "@/lib/ids";
import { hashPassword } from "@/lib/auth/password";
import { revokeSessions } from "@/lib/auth/session";
import { publicUser, type PublicUser } from "@/server/services/auth.service";
import type { StaffInput } from "@/server/validation/auth";
import type { UserRole } from "@prisma/client";

/**
 * Staff accounts. Only an owner may create or modify another owner, and the
 * last active owner cannot be demoted or deactivated — a restaurant must always
 * have somebody who can change settings.
 */

export function generateTempPassword(): string {
  const base = randomToken(12);
  // randomToken is alphanumeric; add a digit and an uppercase letter so the
  // strength rules are satisfied whatever the dice rolled.
  return `${base.slice(0, 8)}A7${base.slice(8, 12)}`;
}

export async function listStaff(
  filters: { role?: UserRole; isActive?: boolean; search?: string },
  pagination: { skip: number; take: number },
) {
  const where = {
    role: filters.role ?? { not: "CUSTOMER" as const },
    ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" as const } },
            { email: { contains: filters.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ role: "asc" }, { name: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { ordersCreated: true, paymentsTaken: true, auditLogs: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return { staff: rows, total };
}

export async function getStaffById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      sessions: { select: { id: true, expiresAt: true }, take: 20 },
      _count: { select: { ordersCreated: true, paymentsTaken: true, refundsIssued: true } },
    },
  });
  if (!user) throw new AppError("NOT_FOUND", "Staff account not found.");
  return user;
}

export type CreateStaffResult = { user: PublicUser; tempPassword: string | null };

/**
 * `password` is optional: when the caller omits it we mint one, return it exactly
 * once for the creating manager to hand over, and never store or log it.
 */
export async function createStaff(
  input: StaffInput,
  actor: { userId: string; role: UserRole; ip?: string },
): Promise<CreateStaffResult> {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError("CONFLICT", "That email already belongs to an account.", { email: ["Already registered."] });
  if (input.role === "OWNER" && actor.role !== "OWNER") {
    throw new AppError("FORBIDDEN", "Only an owner can create another owner account.");
  }

  const tempPassword = input.password ?? generateTempPassword();
  const user = await prisma.user.create({
    data: {
      email,
      name: input.name,
      phone: input.phone ?? null,
      role: input.role,
      isActive: input.isActive,
      passwordHash: await hashPassword(tempPassword),
    },
  });

  await writeAudit({
    actorUserId: actor.userId,
    action: "staff.create",
    entityType: "User",
    entityId: user.id,
    after: { email: user.email, role: user.role, isActive: user.isActive },
    ip: actor.ip,
  });

  return { user: publicUser(user), tempPassword: input.password ? null : tempPassword };
}

export async function updateStaff(
  id: string,
  patch: Partial<Omit<StaffInput, "password">> & { password?: undefined },
  actor: { userId: string; role: UserRole; ip?: string },
): Promise<PublicUser> {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new AppError("NOT_FOUND", "Staff account not found.");
  if (target.role === "CUSTOMER") throw new AppError("VALIDATION", "This is a customer account; edit it from Customers.");
  if (target.role === "OWNER" && actor.role !== "OWNER") {
    throw new AppError("FORBIDDEN", "Only an owner can change an owner account.");
  }
  if (patch.role === "OWNER" && actor.role !== "OWNER") {
    throw new AppError("FORBIDDEN", "Only an owner can promote someone to owner.");
  }

  const losesOwner = target.role === "OWNER" && ((patch.role && patch.role !== "OWNER") || patch.isActive === false);
  if (losesOwner) {
    const otherOwners = await prisma.user.count({ where: { role: "OWNER", isActive: true, id: { not: id } } });
    if (otherOwners === 0) {
      throw new AppError("CONFLICT", "This is the last active owner account. Create another owner first.");
    }
  }

  if (patch.email) {
    const clash = await prisma.user.findUnique({ where: { email: patch.email.toLowerCase() } });
    if (clash && clash.id !== id) throw new AppError("CONFLICT", "Another account already uses that email.");
  }

  const data = {
    ...(patch.name ? { name: patch.name } : {}),
    ...(patch.email ? { email: patch.email.toLowerCase() } : {}),
    ...(patch.phone === undefined ? {} : { phone: patch.phone ?? null }),
    ...(patch.role ? { role: patch.role } : {}),
    ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
  };
  const updated = await prisma.user.update({ where: { id }, data });

  // A deactivated or re-rostered account must stop working immediately, not at
  // the next cookie expiry.
  if (patch.isActive === false || (patch.role && patch.role !== target.role)) {
    await revokeSessions(id);
  }

  await writeAudit({
    actorUserId: actor.userId,
    action: "staff.update",
    entityType: "User",
    entityId: id,
    before: { role: target.role, isActive: target.isActive, email: target.email },
    after: { role: updated.role, isActive: updated.isActive, email: updated.email },
    ip: actor.ip,
  });
  return publicUser(updated);
}

/** Staff are never hard-deleted: their actions stay attributable in the audit log. */
export async function deactivateStaff(id: string, actor: { userId: string; role: UserRole; ip?: string }): Promise<PublicUser> {
  return updateStaff(id, { isActive: false }, actor);
}

export async function staffActivity(userId: string, limit = 50) {
  return prisma.auditLog.findMany({
    where: { actorUserId: userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
  });
}
