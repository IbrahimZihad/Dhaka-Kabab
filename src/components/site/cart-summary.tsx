"use client";

import Link from "next/link";
import { formatPoisa } from "@/lib/money";
import { cartItemCount, cartSubtotalPoisa, lineTotalPoisa } from "@/lib/cart";
import { useCartLines } from "@/components/site/use-cart";

/** The guest's own list, repeated next to the form so nothing is ordered blind. */
export function CartSummary({ symbol }: { symbol: string }) {
  const lines = useCartLines();

  if (lines.length === 0) {
    return (
      <div className="card p-5">
        <h2 className="text-base font-bold">Nothing to order yet</h2>
        <p className="mt-2 text-sm soft">Your list is empty. Add a dish from the menu and it will appear here.</p>
        <p className="mt-4">
          <Link href="/menu" className="btn btn-primary btn-sm">
            Browse the menu
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-bold">Your dishes</h2>
        <span className="hint">{cartItemCount(lines)} item{cartItemCount(lines) === 1 ? "" : "s"}</span>
      </div>
      <ul className="mt-3 divide-y divide-line text-sm">
        {lines.map((line) => (
          <li key={line.key} className="flex items-start justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="font-medium">{line.quantity}×</span> {line.name}
              {line.options.length > 0 ? <span className="block hint">{line.options.map((o) => o.name).join(", ")}</span> : null}
              {line.instructions ? <span className="block hint italic">“{line.instructions}”</span> : null}
            </span>
            <span className="price shrink-0">{formatPoisa(lineTotalPoisa(line), { symbol })}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
        <span className="label">Food subtotal</span>
        <span className="price text-lg">{formatPoisa(cartSubtotalPoisa(lines), { symbol })}</span>
      </div>
      <p className="mt-2">
        <Link href="/cart" className="btn btn-ghost btn-sm">
          Change this list
        </Link>
      </p>
    </div>
  );
}
