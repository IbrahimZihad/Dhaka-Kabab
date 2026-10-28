"use client";

import Link from "next/link";
import { formatPoisa } from "@/lib/money";
import { useCartSummary } from "@/components/site/use-cart";

/** Basket summary for the header. Nothing is shown until a line is added. */
export function CartLink({ symbol }: { symbol: string }) {
  const { count, subtotalPoisa } = useCartSummary();
  if (count === 0) return null;

  return (
    <Link href="/cart" className="btn btn-primary btn-sm">
      Cart
      <span className="badge badge-brand">
        {count} · {formatPoisa(subtotalPoisa, { symbol })}
      </span>
    </Link>
  );
}
