"use client";

import { useEffect } from "react";
import { hydrateCart } from "@/lib/cart";
import { hydrateSeat } from "@/lib/table-seat";

/**
 * Reads the saved cart out of localStorage once, after mount. Server rendering
 * has no storage, so the first paint always shows an empty cart and the real
 * contents arrive a frame later — the same behaviour a shopper expects from a
 * basket that survived a browser restart. The table seat is restored here for
 * the same reason: a reload of a QR link should not seat the table twice.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    hydrateCart();
    hydrateSeat();
  }, []);

  return <>{children}</>;
}
