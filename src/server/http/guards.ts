import { AppError } from "@/lib/errors";
import { assertPermission, type Permission } from "@/lib/auth/rbac";
import { getCurrentUserFromRequest, type AuthenticatedUser } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/api";
import type { UserRole } from "@prisma/client";

/**
 * Shared guards for route handlers. Every protected endpoint resolves the caller
 * here rather than trusting anything in the request body, so "the button was
 * hidden" is never mistaken for access control.
 */

export async function apiUser(request: Request): Promise<AuthenticatedUser> {
  const user = await getCurrentUserFromRequest(request);
  if (!user) throw new AppError("UNAUTHORIZED", "Please sign in to continue.");
  return user;
}

export async function requireApiPermission(
  request: Request,
  permission: Permission,
): Promise<AuthenticatedUser> {
  const user = await apiUser(request);
  assertPermission(user, permission);
  return user;
}

/** A signed-in customer, for "my orders" style endpoints. */
export async function apiCustomer(request: Request): Promise<AuthenticatedUser> {
  const user = await apiUser(request);
  if (user.role !== "CUSTOMER") {
    throw new AppError("FORBIDDEN", "This endpoint is for customer accounts.");
  }
  return user;
}

export async function requireRole(request: Request, roles: UserRole[]): Promise<AuthenticatedUser> {
  const user = await apiUser(request);
  if (!roles.includes(user.role)) throw new AppError("FORBIDDEN", "Your role may not use this endpoint.");
  return user;
}

/**
 * Mutations: origin first, then identity. A cross-site form post never reaches a
 * permission check, and a request without an Origin header (curl, gateway
 * callbacks) is judged on its own merits by the handler.
 */
export async function mutationUser(request: Request, permission: Permission): Promise<AuthenticatedUser> {
  assertSameOrigin(request);
  return requireApiPermission(request, permission);
}

export function actorOf(user: AuthenticatedUser, ip?: string) {
  return { userId: user.id, role: user.role, ip };
}
