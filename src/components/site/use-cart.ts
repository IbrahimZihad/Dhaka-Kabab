"use client";

import { useSyncExternalStore } from "react";
import { cartItemCount, cartSubtotalPoisa, getCartLines, subscribe, type CartLine } from "@/lib/cart";

const EMPTY: CartLine[] = [];

/** The store lives in `@/lib/cart`; this is the React window onto it. */
export function useCartLines(): CartLine[] {
  return useSyncExternalStore(
    subscribe,
    getCartLines,
    () => EMPTY,
  );
}

export function useCartSummary() {
  const lines = useCartLines();
  return { lines, count: cartItemCount(lines), subtotalPoisa: cartSubtotalPoisa(lines) };
}
