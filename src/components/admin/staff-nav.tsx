"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

/**
 * The section list is decided on the server from the signed-in role; this only
 * marks where the member of staff currently is.
 */
export function StaffNav({ items, kitchenLink }: { items: NavItem[]; kitchenLink: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="flex flex-wrap gap-1 text-sm">
      {items.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 ${active ? "bg-brand text-white" : "text-ink-soft hover:bg-paper-raised hover:text-brand"}`}
          >
            {item.label}
          </Link>
        );
      })}
      {kitchenLink ? (
        <Link
          href="/kitchen"
          className={`rounded-md px-3 py-1.5 ${pathname.startsWith("/kitchen") ? "bg-brand text-white" : "text-ink-soft hover:bg-paper-raised hover:text-brand"}`}
        >
          Kitchen screen
        </Link>
      ) : null}
    </nav>
  );
}
