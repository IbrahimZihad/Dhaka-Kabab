import type { UserRole } from "@prisma/client";
import { ROLE_PERMISSIONS, type Permission } from "@/lib/auth/rbac";

/**
 * A plain-English reading of the permission arrays that live in
 * `src/lib/auth/rbac.ts`.
 *
 * Nothing here grants anything. Every entry is keyed by a real `Permission`, so
 * the compiler refuses this file the moment a permission is added to or removed
 * from `PERMISSIONS`, and the words below are only ever a description of what the
 * route handlers already enforce. The staff endpoints return that same
 * `ROLE_PERMISSIONS` object, which is what `capabilitiesFor` reads here — so a
 * role can never be shown as able to do something the API would refuse, or as
 * unable to do something it would allow.
 */

/** The roles this screen lists. A `CUSTOMER` is not a staff account. */
export const STAFF_ROLE_VALUES: UserRole[] = ["OWNER", "MANAGER", "CASHIER", "KITCHEN"];

type CapabilityGroup = "menu" | "floor" | "orders" | "bookings" | "money" | "customers" | "messages" | "staff";

const GROUP_ORDER: CapabilityGroup[] = [
  "menu",
  "floor",
  "orders",
  "bookings",
  "money",
  "customers",
  "messages",
  "staff",
];

const GROUP_LABELS: Record<CapabilityGroup, string> = {
  menu: "Menu and prices",
  floor: "The floor",
  orders: "Orders",
  bookings: "Bookings",
  money: "Money, reports and the record",
  customers: "Customer accounts",
  messages: "Guest messages",
  staff: "Staff accounts and settings",
};

/** One line per permission, in the words a manager would use on shift. */
const READINGS: Record<Permission, { group: CapabilityGroup; label: string }> = {
  "menu:view:admin": { group: "menu", label: "See the menu as staff see it, including hidden dishes" },
  "menu:manage": { group: "menu", label: "Add, change, price and take dishes off the menu" },
  "category:manage": { group: "menu", label: "Rename and reorder menu sections" },
  "table:view": { group: "floor", label: "Open the floor board and see which table is doing what" },
  "table:manage": { group: "floor", label: "Add tables, change the room and print table codes" },
  "table:session:manage": { group: "floor", label: "Seat a party, move it and close a visit" },
  "order:view:any": { group: "orders", label: "Read any order, not only the ones on their own screen" },
  "order:create:for-customer": { group: "orders", label: "Take an order on a guest's behalf" },
  "order:status:kitchen": { group: "orders", label: "Move an order through the kitchen steps" },
  "order:status:floor": { group: "orders", label: "Move an order from the floor" },
  "order:cancel": { group: "orders", label: "Cancel an order and record the reason" },
  "reservation:view:any": { group: "bookings", label: "Read every booking" },
  "reservation:manage": { group: "bookings", label: "Create, change and cancel bookings" },
  "bill:view": { group: "money", label: "Read bills" },
  "bill:manage": { group: "money", label: "Raise and finalize bills" },
  "bill:void": { group: "money", label: "Void a bill, with a reason on the record" },
  "payment:record": { group: "money", label: "Record a payment taken at the counter" },
  "payment:view": { group: "money", label: "See the payments behind a bill" },
  "payment:refund": { group: "money", label: "Refund money the restaurant has already received" },
  "customer:view": { group: "customers", label: "Read customer accounts and their order history" },
  "customer:manage": { group: "customers", label: "Change a customer account and its staff notes" },
  "chat:view": { group: "messages", label: "Read the guest message inbox" },
  "staff:manage": { group: "staff", label: "Create staff accounts and change their roles and passwords" },
  "settings:manage": { group: "staff", label: "Change opening hours, charges, payments and contact details" },
  "report:view": { group: "money", label: "Read the sales reports" },
  "audit:view": { group: "money", label: "Read the audit log" },
  "kitchen:view": { group: "orders", label: "Open the kitchen display" },
};

export type CapabilitySection = {
  group: CapabilityGroup;
  label: string;
  items: { permission: Permission; label: string }[];
};

/**
 * The role's abilities, grouped, straight from `ROLE_PERMISSIONS[role]` and in
 * that array's own order. A role with none of these returns nothing at all.
 */
export function capabilitiesFor(role: UserRole): CapabilitySection[] {
  const granted = ROLE_PERMISSIONS[role];
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    items: granted
      .filter((permission) => READINGS[permission].group === group)
      .map((permission) => ({ permission, label: READINGS[permission].label })),
  })).filter((section) => section.items.length > 0);
}

/** How many of the panel's permissions the role holds — counted, never asserted. */
export function permissionCount(role: UserRole): number {
  return ROLE_PERMISSIONS[role].length;
}

/** The whole list, so a sentence can say "27 in all" without hardcoding it. */
export function totalPermissionCount(): number {
  return ROLE_PERMISSIONS.OWNER.length;
}
