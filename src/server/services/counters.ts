import { prisma, type Db } from "@/lib/db";
import { zonedParts } from "@/lib/time";

/**
 * Human-readable document numbers. A per-scope counter row is incremented
 * inside the caller's transaction, so two concurrent inserts can never mint the
 * same order or invoice number.
 */

export type CounterScope = "order" | "bill" | "refund" | "reservation" | "session";

const PREFIX: Record<CounterScope, string> = {
  order: "DK",
  bill: "INV",
  refund: "RF",
  reservation: "BK",
  session: "TS",
};

function scopeFor(kind: CounterScope, dateKey: string): string {
  // Daily counters keep printed receipts short and legible; monthly for the rest.
  const bucket = kind === "order" ? dateKey.replaceAll("-", "") : dateKey.slice(0, 7).replace("-", "");
  return `${kind}:${bucket}`;
}

export async function nextDocumentNumber(
  kind: CounterScope,
  options: { timeZone: string; at?: Date; client?: Db } = { timeZone: "Asia/Dhaka" },
): Promise<string> {
  const client = options.client ?? prisma;
  const at = options.at ?? new Date();
  const dateKey = zonedParts(at, options.timeZone).dateKey;
  const key = scopeFor(kind, dateKey);
  const year = Number(dateKey.slice(0, 4));

  const counter = await client.documentCounter.upsert({
    where: { scope: key },
    create: { scope: key, year, value: 1 },
    update: { value: { increment: 1 }, year },
  });

  const suffix = String(counter.value).padStart(4, "0");
  const compactDate = kind === "order" ? dateKey.slice(2).replaceAll("-", "") : dateKey.slice(2, 7).replace("-", "");
  return `${PREFIX[kind]}-${compactDate}-${suffix}`;
}

/** Reads the current counter without consuming a number (reporting only). */
export async function peekCounter(kind: CounterScope, dateKey: string): Promise<number> {
  const counter = await prisma.documentCounter.findUnique({ where: { scope: scopeFor(kind, dateKey) } });
  return counter?.value ?? 0;
}
