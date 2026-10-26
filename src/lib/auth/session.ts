import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { UserRole } from "@prisma/client";

export const SESSION_COOKIE = "dk_session";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  sessionId: string;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.authSecret);
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isStaffRole(role: UserRole): boolean {
  return role !== "CUSTOMER";
}

/**
 * Creates a database session row plus the signed cookie that points at it.
 * The row exists so a staff account can be revoked immediately (deactivate or
 * role change deletes sessions) without waiting for the token to expire.
 */
export async function startSession(
  user: { id: string; email: string; name: string; role: UserRole },
  request?: { ip?: string },
): Promise<{ cookie: string; maxAge: number }> {
  const sessionId = randomBytes(24).toString("hex");
  const maxAge = env.sessionMaxAgeSeconds;
  const expiresAt = new Date(Date.now() + maxAge * 1000);

  await prisma.session.create({
    data: {
      id: hashToken(sessionId),
      userId: user.id,
      expiresAt,
      ipHash: request?.ip ? hashToken(request.ip) : null,
    },
  });

  const jwt = await new SignJWT({ sub: user.id, sid: hashToken(sessionId), role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secretKey());

  return { cookie: jwt, maxAge };
}

/** Writes the session cookie on the current request's cookie store (server actions). */
export async function setSessionCookie(jwt: string, maxAge: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Resolves the cookie to a live user. Returns null for anonymous visitors. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveToken(token);
}

export async function resolveToken(token: string): Promise<AuthenticatedUser | null> {
  let payload: { sub?: string; sid?: string };
  try {
    const verified = await jwtVerify(token, secretKey());
    payload = verified.payload as { sub?: string; sid?: string };
  } catch {
    return null;
  }
  if (!payload.sub || !payload.sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { select: { id: true, email: true, name: true, role: true, isActive: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    sessionId: session.id,
  };
}

export async function getCurrentUserFromRequest(request: Request): Promise<AuthenticatedUser | null> {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return resolveToken(header.slice(7));
  return getCurrentUser();
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHORIZED", "Please sign in to continue.");
  return user;
}

/** Revokes every session belonging to a user (used on logout, deactivation, password change). */
export async function revokeSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}

export async function destroyCurrentSession(user: AuthenticatedUser): Promise<void> {
  await prisma.session.deleteMany({ where: { id: user.sessionId } });
  await clearSessionCookie();
}
