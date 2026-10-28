import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser, isStaffRole } from "@/lib/auth/session";
import { ROLE_LABELS, roleHasPermission } from "@/lib/auth/rbac";
import { ADMIN_SECTIONS } from "@/components/admin/admin-sections";
import { StaffNav } from "@/components/admin/staff-nav";
import { SignOutButton } from "@/components/site/sign-out-button";

/**
 * The frame around every staff screen. It decides what the person may open, and
 * sends a customer back to their own account page rather than showing them an
 * empty panel.
 */
export async function StaffShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isStaffRole(user.role)) redirect("/account");

  const items = ADMIN_SECTIONS.filter((section) => !section.permission || roleHasPermission(user.role, section.permission))
    .map((section) => ({ href: section.href, label: section.label }));

  const canSeeKitchen = roleHasPermission(user.role, "kitchen:view");

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-line bg-paper-raised">
        <div className="shell py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <Link href="/admin" className="text-lg font-bold tracking-tight text-brand">
                Dhaka Kabab
              </Link>
              <span className="label">Staff panel</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="muted">
                {user.name} · {ROLE_LABELS[user.role]}
              </span>
              <Link href="/" className="btn btn-ghost btn-sm">
                Guest site
              </Link>
              <SignOutButton />
            </div>
          </div>
          <div className="mt-3">
            <StaffNav items={items} kitchenLink={canSeeKitchen} />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="shell py-8">{children}</div>
      </main>

      <footer className="border-t border-line py-4">
        <p className="shell hint">
          Signed in as {ROLE_LABELS[user.role]}. Changes made here are recorded in the audit log with your name and the
          time.
        </p>
      </footer>
    </div>
  );
}
