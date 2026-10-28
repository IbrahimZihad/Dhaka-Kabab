import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/rbac";
import { CartLink } from "@/components/site/cart-link";
import { SignOutButton } from "@/components/site/sign-out-button";
import { siteContext } from "@/server/http/site";

/**
 * The header reads the restaurant's name and opening state from the database, so
 * what a guest sees is what the owner configured — not what the template said.
 */
async function HeaderInner() {
  const site = await siteContext();
  const user = await getCurrentUser();

  return (
    <header className="border-b border-line bg-paper-raised">
      <div className="shell flex flex-wrap items-center gap-x-6 gap-y-3 py-3">
        <Link href="/" className="flex items-baseline gap-2 mr-auto">
          <span className="text-lg font-bold tracking-tight text-ink">{site.info.name || "Restaurant"}</span>
          <span className={`badge ${site.open ? "badge-open" : "badge-closed"}`}>{site.open ? "Open now" : "Closed"}</span>
        </Link>

        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium text-ink-soft">
          <Link href="/menu" className="hover:text-brand">
            Menu
          </Link>
          <Link href="/reservations" className="hover:text-brand">
            Book a table
          </Link>
          <Link href="/track" className="hover:text-brand">
            Track an order
          </Link>
          <Link href="/contact" className="hover:text-brand">
            Contact
          </Link>
          <CartLink symbol={site.money.currencySymbol} />
          {user ? (
            isStaff(user) ? (
              <>
                <span className="muted text-xs">
                  {user.name} · {user.role.toLowerCase()}
                </span>
                <Link href={user.role === "KITCHEN" ? "/kitchen" : "/admin"} className="btn btn-primary btn-sm">
                  Staff area
                </Link>
                <SignOutButton />
              </>
            ) : (
              <>
                <Link href="/account" className="hover:text-brand">
                  My account
                </Link>
                <SignOutButton />
              </>
            )
          ) : (
            <Link href="/login" className="btn btn-outline btn-sm">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteHeader() {
  return (
    <Suspense
      fallback={
        <header className="border-b border-line bg-paper-raised">
          <div className="shell flex items-center gap-6 py-3">
            <span className="skeleton h-6 w-40" />
            <span className="skeleton h-6 w-64" />
          </div>
        </header>
      }
    >
      <HeaderInner />
    </Suspense>
  );
}
