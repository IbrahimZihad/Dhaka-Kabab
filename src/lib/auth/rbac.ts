import type { UserRole } from "@prisma/client";
import { AppError } from "@/lib/errors";
import type { AuthenticatedUser } from "@/lib/auth/session";

/**
 * Every protected action names a permission. Roles map to permission sets.
 * Route handlers and pages call `requirePermission` — hiding a button is never
 * the control.
 */
export const PERMISSIONS = [
  "menu:view:admin",
  "menu:manage",
  "category:manage",
  "table:view",
  "table:manage",
  "table:session:manage",
  "order:view:any",
  "order:create:for-customer",
  "order:status:kitchen",
  "order:status:floor",
  "order:cancel",
  "reservation:view:any",
  "reservation:manage",
  "bill:view",
  "bill:manage",
  "bill:void",
  "payment:record",
  "payment:view",
  "payment:refund",
  "customer:view",
  "customer:manage",
  "staff:manage",
  "settings:manage",
  "report:view",
  "audit:view",
  "kitchen:view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const KITCHEN: Permission[] = ["kitchen:view", "order:view:any", "order:status:kitchen"];

const CASHIER: Permission[] = [
  "order:view:any",
  "order:status:floor",
  "order:create:for-customer",
  "table:view",
  "table:session:manage",
  "reservation:view:any",
  "bill:view",
  "bill:manage",
  "payment:record",
  "payment:view",
  "customer:view",
];

const MANAGER: Permission[] = [
  ...CASHIER,
  "menu:view:admin",
  "menu:manage",
  "category:manage",
  "table:manage",
  "order:cancel",
  "reservation:manage",
  "customer:manage",
  "report:view",
  "audit:view",
  "kitchen:view",
  "bill:void",
];

const OWNER: Permission[] = ALL;

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER,
  MANAGER,
  CASHIER,
  KITCHEN,
  CUSTOMER: [],
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(user: AuthenticatedUser | null, permission: Permission): void {
  if (!user) throw new AppError("UNAUTHORIZED", "Please sign in to continue.");
  if (!roleHasPermission(user.role, permission)) {
    throw new AppError("FORBIDDEN", `Your role (${user.role}) may not perform this action.`);
  }
}

/** Guard for pages: returns the user or throws so the caller can redirect. */
export async function requirePermission(
  user: AuthenticatedUser | null,
  permission: Permission,
): Promise<AuthenticatedUser> {
  assertPermission(user, permission);
  return user as AuthenticatedUser;
}

export function isStaff(user: AuthenticatedUser | null): boolean {
  return user !== null && user.role !== "CUSTOMER";
}

/** Kitchen screens must not reveal money or customer identity. */
export function canViewKitchenFinancials(role: UserRole): boolean {
  return role === "OWNER" || role === "MANAGER" || role === "CASHIER";
}

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  KITCHEN: "Kitchen staff",
  CUSTOMER: "Customer",
};
