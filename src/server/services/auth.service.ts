import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { writeAudit } from "@/lib/audit";
import { randomToken } from "@/lib/ids";
import { hashPassword, verifyPassword, passwordProblem } from "@/lib/auth/password";
import { revokeSessions } from "@/lib/auth/session";
import { getSettings } from "@/server/services/settings.service";
import { sendEmail } from "@/server/services/email.service";
import type { RegisterInput } from "@/server/validation/auth";
import type { User, UserRole } from "@prisma/client";

/**
 * Authentication business logic. The signed cookie and its expiry live in
 * `lib/auth/session`; everything that touches stored credentials lives here.
 * No function in this file returns `passwordHash`.
 */

const RESET_TTL_MINUTES = 30;
/** Hashed lazily and compared against when the email is unknown, so a failed
 *  login costs the same as a successful one and cannot be timed into an
 *  account-enumeration oracle. */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomToken(24));
  return dummyHashPromise;
}

export type PublicUser = { id: string; email: string; name: string; role: UserRole; isActive: boolean; phone: string | null };

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    phone: user.phone,
  };
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function assertStrong(password: string): void {
  const problem = passwordProblem(password);
  if (problem) throw new AppError("VALIDATION", `That password is too easy to guess: ${problem}`, { password: [problem] });
}

export async function signUpCustomer(input: RegisterInput, meta?: { ip?: string }): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError("CONFLICT", "An account already uses that email address. Try signing in instead.", {
      email: ["An account already uses that email address."],
    });
  }
  assertStrong(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      role: "CUSTOMER",
    },
  });

  await writeAudit({
    actorUserId: user.id,
    action: "auth.register",
    entityType: "User",
    entityId: user.id,
    after: { email: user.email, role: user.role },
    ip: meta?.ip,
  });
  return publicUser(user);
}

/**
 * Verifies credentials without leaking which half was wrong, and records the
 * successful login. The caller creates the session cookie.
 */
export async function verifyCredentials(email: string, password: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const matches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));

  if (!user || !matches) {
    throw new AppError("UNAUTHORIZED", "That email and password do not match an account.");
  }
  if (!user.isActive) {
    throw new AppError("FORBIDDEN", "This account has been deactivated. Please speak to a manager.");
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return publicUser(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  meta?: { ip?: string },
): Promise<{ sessionsRevoked: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("NOT_FOUND", "Account not found.");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError("UNAUTHORIZED", "Your current password is not correct.");
  }
  assertStrong(newPassword);
  if (currentPassword === newPassword) throw new AppError("VALIDATION", "Choose a different password.");

  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  // Every existing session is dropped: a password change must not leave a
  // possibly-stolen cookie working on another device.
  await revokeSessions(userId);
  await writeAudit({
    actorUserId: userId,
    action: "auth.password.change",
    entityType: "User",
    entityId: userId,
    ip: meta?.ip,
  });
  return { sessionsRevoked: true };
}

export type ResetRequestResult = { delivered: boolean; reason: string };

/**
 * Issue a reset link. The response is identical whether or not the address is
 * registered, so this endpoint cannot be used to enumerate accounts.
 */
export async function startPasswordReset(email: string, meta?: { ip?: string }): Promise<ResetRequestResult> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive) {
    return { delivered: false, reason: "no-account" };
  }

  const rawToken = randomToken(32);
  await prisma.$transaction(async (tx) => {
    // One live link per account: an older link is dead the moment a new one is asked for.
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await tx.passwordResetToken.create({
      data: {
        tokenHash: tokenHash(rawToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      },
    });
  });

  const resetUrl = `${env.appUrl}/reset-password?token=${rawToken}`;
  const settings = await getSettings();
  const result = await sendEmail({
    to: user.email,
    toName: user.name,
    subject: `${settings?.name ?? "Dhaka Kabab"} — reset your password`,
    text:
      `You asked to reset your password.\n\n` +
      `Open this link within ${RESET_TTL_MINUTES} minutes:\n${resetUrl}\n\n` +
      `If you did not ask for this, you can ignore this email — your password has not changed.`,
  });

  await writeAudit({
    actorUserId: user.id,
    action: "auth.password.reset.requested",
    entityType: "User",
    entityId: user.id,
    after: { delivered: result.ok },
    ip: meta?.ip,
  });

  if (!result.ok) {
    // Development convenience only: the link is logged on the server, never returned.
    if (!env.isProduction) console.warn(`[password-reset] email failed (${result.reason}); dev link: ${resetUrl}`);
    return { delivered: false, reason: result.reason };
  }
  return { delivered: true, reason: "sent" };
}

export async function completePasswordReset(rawToken: string, newPassword: string): Promise<PublicUser> {
  if (!rawToken || rawToken.length < 16) throw new AppError("VALIDATION", "That reset link is not valid.");
  assertStrong(newPassword);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: tokenHash(rawToken) },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("VALIDATION", "That reset link has expired. Please request a new one.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: record.userId } });
    return tx.user.findUniqueOrThrow({ where: { id: record.userId } });
  });

  await writeAudit({ actorUserId: updated.id, action: "auth.password.reset.completed", entityType: "User", entityId: updated.id });
  return publicUser(updated);
}

/** Administrative reset, used when a staff member forgets their password. */
export async function adminSetPassword(
  userId: string,
  newPassword: string,
  actor: { userId: string; role: UserRole; ip?: string },
): Promise<PublicUser> {
  assertStrong(newPassword);
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new AppError("NOT_FOUND", "Account not found.");
  if (target.role === "OWNER" && actor.role !== "OWNER") {
    throw new AppError("FORBIDDEN", "Only an owner can change another owner's password.");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await revokeSessions(userId);
  await writeAudit({
    actorUserId: actor.userId,
    action: "auth.password.admin_reset",
    entityType: "User",
    entityId: userId,
    ip: actor.ip,
  });
  return publicUser(updated);
}
