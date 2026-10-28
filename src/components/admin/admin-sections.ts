import type { Permission } from "@/lib/auth/rbac";

/**
 * The panel's sections, in the order a manager works through them. Each entry
 * names the permission the APIs behind it require, so the navigation a member of
 * staff sees is the navigation they can actually use — nothing is hidden and then
 * left clickable-but-forbidden.
 */
export const ADMIN_SECTIONS: { href: string; label: string; blurb: string; permission: Permission | null }[] = [
  { href: "/admin", label: "Overview", blurb: "Today at a glance", permission: null },
  { href: "/admin/floor", label: "Floor", blurb: "Tables, visits and bills", permission: "table:view" },
  { href: "/admin/orders", label: "Orders", blurb: "Everything the kitchen has been sent", permission: "order:view:any" },
  { href: "/admin/reservations", label: "Bookings", blurb: "Reservations and their tables", permission: "reservation:view:any" },
  { href: "/admin/bills", label: "Bills & payments", blurb: "Totals, refunds, receipts", permission: "bill:view" },
  { href: "/admin/menu", label: "Menu", blurb: "Sections, dishes, choices, prices", permission: "menu:view:admin" },
  { href: "/admin/qr", label: "Table codes", blurb: "Print the QR stickers", permission: "table:manage" },
  { href: "/admin/customers", label: "Customers", blurb: "Accounts and order history", permission: "customer:view" },
  { href: "/admin/chat", label: "Chat inbox", blurb: "Questions the assistant could not answer", permission: "chat:view" },
  { href: "/admin/reports", label: "Reports", blurb: "Sales, items, downloads", permission: "report:view" },
  { href: "/admin/staff", label: "Staff", blurb: "Accounts, roles, passwords", permission: "staff:manage" },
  { href: "/admin/settings", label: "Settings", blurb: "Hours, charges, payments, contact", permission: "settings:manage" },
  { href: "/admin/audit", label: "Audit log", blurb: "Who changed what, and when", permission: "audit:view" },
];
