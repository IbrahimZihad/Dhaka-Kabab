"use client";

/**
 * The browser cart is a convenience, never an invoice. It holds the item id, the
 * chosen option ids, a quantity and an optional note; the prices in it are only
 * what the menu page showed a moment ago. On submit the server rebuilds every
 * line from the database, and the cart total travels with the order purely as a
 * staleness check — a mismatch is refused rather than charged.
 */

export type CartOption = { groupId: string; optionId: string };
export type CartLine = {
  key: string;
  menuItemId: string;
  name: string;
  slug: string;
  quantity: number;
  /** Display only. */
  unitPricePoisa: number;
  options: (CartOption & { name: string; priceDeltaPoisa: number })[];
  instructions: string | null;
};

const STORAGE_KEY = "dk.cart.v1";
const listeners = new Set<() => void>();
let lines: CartLine[] = [];
let snapshot: CartLine[] = lines;
let hydrated = false;

function emit() {
  snapshot = lines;
  for (const listener of listeners) listener();
  if (hydrated && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // A private-mode or full storage is not worth breaking an order over.
    }
  }
}

export function lineKey(
  menuItemId: string,
  options: CartOption[],
  instructions: string | null,
): string {
  const optionPart = [...options]
    .map((option) => `${option.groupId}:${option.optionId}`)
    .sort()
    .join(",");
  return `${menuItemId}|${optionPart}|${(instructions ?? "").trim().toLowerCase()}`;
}

export function lineTotalPoisa(line: CartLine): number {
  const unit = line.unitPricePoisa + line.options.reduce((total, option) => total + option.priceDeltaPoisa, 0);
  return unit * line.quantity;
}

export function cartSubtotalPoisa(current: CartLine[]): number {
  return current.reduce((total, line) => total + lineTotalPoisa(line), 0);
}

export function cartItemCount(current: CartLine[]): number {
  return current.reduce((total, line) => total + line.quantity, 0);
}

/** Runs once in the provider after mount: localStorage only exists in the browser. */
export function hydrateCart(): void {
  if (typeof window === "undefined" || hydrated) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
    lines = Array.isArray(parsed) ? parsed.filter((line) => line && typeof line.menuItemId === "string" && Number.isFinite(line.quantity)) : [];
  } catch {
    lines = [];
  }
  hydrated = true;
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCartLines(): CartLine[] {
  return snapshot;
}

export function addToCart(
  item: { id: string; name: string; slug: string; pricePoisa: number },
  options: CartLine["options"],
  quantity: number,
  instructions: string | null,
): void {
  const key = lineKey(
    item.id,
    options.map((option) => ({ groupId: option.groupId, optionId: option.optionId })),
    instructions,
  );
  const existing = lines.find((line) => line.key === key);
  if (existing) {
    lines = lines.map((line) => (line.key === key ? { ...line, quantity: Math.min(99, line.quantity + quantity) } : line));
  } else {
    lines = [...lines, { key, menuItemId: item.id, name: item.name, slug: item.slug, quantity, unitPricePoisa: item.pricePoisa, options, instructions }];
  }
  emit();
}

export function setQuantity(key: string, quantity: number): void {
  if (quantity <= 0) {
    lines = lines.filter((line) => line.key !== key);
  } else {
    lines = lines.map((line) => (line.key === key ? { ...line, quantity: Math.min(99, quantity) } : line));
  }
  emit();
}

export function removeLine(key: string): void {
  lines = lines.filter((line) => line.key !== key);
  emit();
}

export function clearCart(): void {
  lines = [];
  emit();
}

/** What POST /api/orders needs: ids and quantities, nothing the client priced. */
export function cartOrderPayload(current: CartLine[]) {
  return {
    items: current.map((line) => ({
      menuItemId: line.menuItemId,
      quantity: line.quantity,
      options: line.options.map((option) => ({ groupId: option.groupId, optionId: option.optionId })),
      instructions: line.instructions,
    })),
    cartTotalPoisa: cartSubtotalPoisa(current),
  };
}
