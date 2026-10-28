"use client";

import { useState } from "react";
import { formatPoisa } from "@/lib/money";
import { addToCart } from "@/lib/cart";

/**
 * One-tap add for dishes that need no choice from the guest. Anything with a
 * required customisation goes to its detail page instead — a half-chosen dish is
 * worse than one extra tap.
 */
export function QuickAdd({
  item,
  symbol = "৳",
}: {
  item: { id: string; name: string; slug: string; pricePoisa: number };
  symbol?: string;
}) {
  const [added, setAdded] = useState(false);

  function add() {
    addToCart(item, [], 1, null);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={add}
      className="btn btn-outline btn-sm"
      aria-label={`Add ${item.name} for ${formatPoisa(item.pricePoisa, { symbol })}`}
    >
      {added ? "Added" : "Add"}
    </button>
  );
}
