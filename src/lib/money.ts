/**
 * Money. Every amount in this system is an integer number of poisa (1 BDT = 100
 * poisa). Floats never touch a stored or transmitted financial total.
 */

export const POISA_PER_UNIT = 100;

export type Poisa = number;

export function bdtToPoisa(bdt: number | string): Poisa {
  const value = typeof bdt === "string" ? Number(bdt.replace(/[^\d.\-]/g, "")) : bdt;
  if (!Number.isFinite(value)) throw new Error(`Cannot convert ${bdt} to a monetary amount.`);
  // Multiply first, then round, so 0.1 * 100 does not land on 10.000000000000002.
  return Math.round(value * POISA_PER_UNIT);
}

export function poisaToBdt(poisa: Poisa): number {
  return poisa / POISA_PER_UNIT;
}

/** Half-up rounding at the poisa level. Used for every derived charge. */
export function roundPoisa(poisa: number): Poisa {
  if (!Number.isFinite(poisa)) throw new Error("Monetary calculation produced a non-finite number.");
  return Math.round(poisa);
}

/**
 * Percentage in basis points (1500 = 15.00%). Multiplying before dividing keeps
 * this exact for the magnitudes a restaurant bill reaches.
 */
export function applyBps(amountPoisa: Poisa, bps: number): Poisa {
  assertAmount(amountPoisa);
  assertAmount(bps);
  if (amountPoisa === 0 || bps === 0) return 0;
  return roundPoisa((amountPoisa * bps) / 10_000);
}

/**
 * Bills are rounded to the smallest physical coin available. Bangladesh has no
 * poisa coin in circulation, so restaurants round to the nearest Taka (100
 * poisa) or nearest 5 Taka. stepPoisa of 1 disables rounding.
 */
export function roundToStep(poisa: Poisa, stepPoisa: number): Poisa {
  assertAmount(poisa);
  if (!Number.isInteger(stepPoisa) || stepPoisa < 1) return poisa;
  if (stepPoisa === 1) return poisa;
  const sign = poisa < 0 ? -1 : 1;
  const absolute = Math.abs(poisa);
  return sign * Math.round(absolute / stepPoisa) * stepPoisa;
}

export function sumPoisa(...amounts: Poisa[]): Poisa {
  let total = 0;
  for (const amount of amounts) {
    assertAmount(amount);
    total += amount;
  }
  return total;
}

export function clampNonNegative(poisa: Poisa): Poisa {
  return poisa < 0 ? 0 : poisa;
}

export function assertAmount(poisa: number): void {
  if (!Number.isInteger(poisa)) {
    throw new Error(`Monetary values must be integers (poisa); received ${poisa}.`);
  }
  if (!Number.isSafeInteger(poisa)) {
    throw new Error(`Monetary value ${poisa} exceeds the safe integer range.`);
  }
}

export function formatPoisa(poisa: Poisa, options: { symbol?: string; withSymbol?: boolean } = {}): string {
  const { symbol = "৳", withSymbol = true } = options;
  const sign = poisa < 0 ? "-" : "";
  const absolute = Math.abs(poisa);
  const takas = Math.floor(absolute / POISA_PER_UNIT);
  const remainder = absolute % POISA_PER_UNIT;
  const grouped = takas.toLocaleString("en-US");
  const decimals = remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`;
  return `${sign}${withSymbol ? `${symbol} ` : ""}${grouped}${decimals}`;
}

/** "12.50" or "৳ 1,250.00" in, integer poisa out. Returns null when unparsable. */
export function parseMoneyInput(raw: string | number | null | undefined): Poisa | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const cleaned = String(raw).replace(/[^\d.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return bdtToPoisa(value);
}

export function poisaToInputValue(poisa: Poisa): string {
  return (poisa / POISA_PER_UNIT).toFixed(2);
}

/** Percent (0-100, two decimals) from basis points, for display only. */
export function bpsToPercentLabel(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.00$/, "");
}
