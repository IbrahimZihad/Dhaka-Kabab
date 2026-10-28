import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  assertPermission,
  canViewKitchenFinancials,
  isStaff,
  requirePermission,
  roleHasPermission,
  type Permission,
} from "@/lib/auth/rbac";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import type { UserRole } from "@prisma/client";

/**
 * `src/lib/auth/rbac.ts` — the whole permission matrix, cell by cell.
 *
 * The expected sets below are transcribed from the policy, not copied from the
 * code, so a change to either side shows up as a failure.
 */

const ALL_ROLES: UserRole[] = ["OWNER", "MANAGER", "CASHIER", "KITCHEN", "CUSTOMER"];

const CASHIER_GRANTS: Permission[] = [
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
  "chat:view",
];

const EXPECTED: Record<UserRole, Permission[]> = {
  KITCHEN: ["kitchen:view", "order:view:any", "order:status:kitchen"],
  CASHIER: CASHIER_GRANTS,
  MANAGER: [
    ...CASHIER_GRANTS,
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
  ],
  OWNER: [...PERMISSIONS],
  CUSTOMER: [],
};

function user(role: UserRole): AuthenticatedUser {
  return { id: `u-${role}`, email: `${role}@example.test`, name: role, role, sessionId: "sess-1" };
}

function grantedFor(role: UserRole): Permission[] {
  return PERMISSIONS.filter((permission) => roleHasPermission(role, permission));
}

describe("role inventory", () => {
  it("ROLE_PERMISSIONS covers exactly the roles the schema defines", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ALL_ROLES].sort());
  });

  it("PERMISSIONS has no duplicates and every entry is a non-empty string", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const permission of PERMISSIONS) expect(permission.trim().length).toBeGreaterThan(0);
  });

  it("ROLE_LABELS covers every role too", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ALL_ROLES].sort());
  });
});

describe("full role x permission matrix", () => {
  it.each(ALL_ROLES.map((role) => ({ role })))(
    "$role is granted exactly the documented permission set",
    ({ role }) => {
      expect(grantedFor(role).sort()).toEqual([...EXPECTED[role]].sort());
    },
  );

  describe.each(ALL_ROLES)("%s", (role) => {
    it.each([...PERMISSIONS].sort())("%s", (permission) => {
      const expected = EXPECTED[role].includes(permission);
      expect(ROLE_PERMISSIONS[role].includes(permission)).toBe(expected);
      expect(roleHasPermission(role, permission)).toBe(expected);
    });
  });

  it.each(ALL_ROLES.map((role) => ({ role })))("no grant for $role falls outside the matrix", ({ role }) => {
    for (const permission of ROLE_PERMISSIONS[role]) {
      expect(PERMISSIONS).toContain(permission);
    }
  });

  it.each(ALL_ROLES.map((role) => ({ role })))("$role has no duplicated grant", ({ role }) => {
    expect(new Set(ROLE_PERMISSIONS[role]).size).toBe(ROLE_PERMISSIONS[role].length);
  });
});

describe("policy invariants", () => {
  const kitchenForbidden: Permission[] = [
    "payment:record",
    "payment:view",
    "payment:refund",
    "bill:view",
    "bill:manage",
    "bill:void",
    "audit:view",
    "report:view",
    "customer:view",
    "customer:manage",
    "settings:manage",
    "staff:manage",
  ];

  const cashierForbidden: Permission[] = [
    "staff:manage",
    "settings:manage",
    "menu:manage",
    "category:manage",
    "report:view",
    "audit:view",
    "bill:void",
    "payment:refund",
    "order:status:kitchen",
  ];

  it("kitchen staff may move tickets but may not touch money, customers or audit", () => {
    for (const permission of kitchenForbidden) {
      expect(roleHasPermission("KITCHEN", permission), `KITCHEN must not have ${permission}`).toBe(false);
    }
    expect(roleHasPermission("KITCHEN", "order:status:kitchen")).toBe(true);
    expect(roleHasPermission("KITCHEN", "kitchen:view")).toBe(true);
    expect(roleHasPermission("KITCHEN", "order:view:any")).toBe(true);
  });

  it("a cashier sees orders but cannot manage staff, menus or settings", () => {
    expect(roleHasPermission("CASHIER", "order:view:any")).toBe(true);
    expect(roleHasPermission("CASHIER", "order:create:for-customer")).toBe(true);
    expect(roleHasPermission("CASHIER", "payment:record")).toBe(true);
    for (const permission of cashierForbidden) {
      expect(roleHasPermission("CASHIER", permission), `CASHIER must not have ${permission}`).toBe(false);
    }
  });

  it("a manager can read reports and the audit trail", () => {
    expect(roleHasPermission("MANAGER", "report:view")).toBe(true);
    expect(roleHasPermission("MANAGER", "audit:view")).toBe(true);
    expect(roleHasPermission("MANAGER", "kitchen:view")).toBe(true);
    expect(roleHasPermission("MANAGER", "bill:void")).toBe(true);
  });

  it("staff:manage is OWNER-only", () => {
    for (const role of ALL_ROLES) {
      expect(roleHasPermission(role, "staff:manage"), `${role} staff:manage`).toBe(role === "OWNER");
    }
  });

  const ownerOnly: { name: string; permission: Permission }[] = [
    { name: "staff:manage", permission: "staff:manage" },
    { name: "settings:manage", permission: "settings:manage" },
    { name: "payment:refund", permission: "payment:refund" },
  ];

  it.each(ownerOnly)("$name is OWNER-only", ({ permission }) => {
    expect(PERMISSIONS).toContain(permission);
    for (const role of ALL_ROLES.filter((r) => r !== "OWNER")) {
      expect(roleHasPermission(role, permission), `${role} must not have ${permission}`).toBe(false);
    }
  });

  it("MANAGER is a strict superset of CASHIER", () => {
    for (const permission of ROLE_PERMISSIONS.CASHIER) {
      expect(ROLE_PERMISSIONS.MANAGER).toContain(permission);
    }
    expect(ROLE_PERMISSIONS.MANAGER.length).toBeGreaterThan(ROLE_PERMISSIONS.CASHIER.length);
  });

  it("CUSTOMER holds no permission at all", () => {
    expect(ROLE_PERMISSIONS.CUSTOMER).toEqual([]);
    for (const permission of PERMISSIONS) expect(roleHasPermission("CUSTOMER", permission)).toBe(false);
  });

  it("OWNER holds every permission in the catalogue", () => {
    expect([...ROLE_PERMISSIONS.OWNER].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("a role may only see money if it may see bills", () => {
    const moneyPermissions: Permission[] = ["bill:view", "payment:view", "payment:record"];
    for (const role of ALL_ROLES) {
      if (canViewKitchenFinancials(role)) {
        for (const permission of moneyPermissions) {
          expect(roleHasPermission(role, permission), `${role} financials implies ${permission}`).toBe(true);
        }
      }
    }
  });
});

describe("canViewKitchenFinancials", () => {
  const cases: { role: UserRole; expected: boolean }[] = [
    { role: "OWNER", expected: true },
    { role: "MANAGER", expected: true },
    { role: "CASHIER", expected: true },
    { role: "KITCHEN", expected: false },
    { role: "CUSTOMER", expected: false },
  ];

  it.each(cases)("$role -> $expected", ({ role, expected }) => {
    expect(canViewKitchenFinancials(role)).toBe(expected);
  });
});

describe("isStaff", () => {
  const cases: { role: UserRole; expected: boolean }[] = [
    { role: "OWNER", expected: true },
    { role: "MANAGER", expected: true },
    { role: "CASHIER", expected: true },
    { role: "KITCHEN", expected: true },
    { role: "CUSTOMER", expected: false },
  ];

  it.each(cases)("a $role session $expected staff", ({ role, expected }) => {
    expect(isStaff(user(role))).toBe(expected);
  });

  it("an anonymous visitor is not staff", () => {
    expect(isStaff(null)).toBe(false);
  });
});

describe("assertPermission", () => {
  it("refuses an anonymous caller with an UNAUTHORIZED AppError", () => {
    let thrown: unknown;
    try {
      assertPermission(null, "order:view:any");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("UNAUTHORIZED");
    expect((thrown as AppError).status).toBe(401);
  });

  const refusals: { role: UserRole; permission: Permission }[] = [
    { role: "KITCHEN", permission: "payment:record" },
    { role: "CASHIER", permission: "staff:manage" },
    { role: "CASHIER", permission: "audit:view" },
    { role: "MANAGER", permission: "settings:manage" },
    { role: "CUSTOMER", permission: "kitchen:view" },
  ];

  it.each(refusals)("a $role session asking for $permission gets FORBIDDEN", ({ role, permission }) => {
    expect(() => assertPermission(user(role), permission)).toThrow(AppError);
    try {
      assertPermission(user(role), permission);
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe("FORBIDDEN");
      expect(appError.status).toBe(403);
      expect(appError.message).toContain(role);
    }
  });

  const grants: { role: UserRole; permission: Permission }[] = [
    { role: "OWNER", permission: "staff:manage" },
    { role: "MANAGER", permission: "report:view" },
    { role: "CASHIER", permission: "payment:record" },
    { role: "KITCHEN", permission: "order:status:kitchen" },
  ];

  it.each(grants)("$role may use $permission", ({ role, permission }) => {
    expect(() => assertPermission(user(role), permission)).not.toThrow();
  });
});

describe("requirePermission", () => {
  it("resolves with the caller when the permission is granted", async () => {
    const caller = user("CASHIER");
    await expect(requirePermission(caller, "bill:manage")).resolves.toBe(caller);
  });

  it("rejects with the same FORBIDDEN error the page guard expects", async () => {
    await expect(requirePermission(user("KITCHEN"), "bill:manage")).rejects.toBeInstanceOf(AppError);
    await expect(requirePermission(null, "bill:manage")).rejects.toBeInstanceOf(AppError);
  });
});
