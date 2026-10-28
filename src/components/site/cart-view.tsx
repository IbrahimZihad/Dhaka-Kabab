"use client";

import Link from "next/link";
import { formatPoisa } from "@/lib/money";
import { cartSubtotalPoisa, lineTotalPoisa, removeLine, setQuantity, type CartLine } from "@/lib/cart";
import { useCartLines } from "@/components/site/use-cart";
import { useSeat } from "@/components/site/use-seat";

/**
 * The guest's own scratch list. Every figure on this screen is the menu price
 * from a few minutes ago; the bill is built later, by the server.
 */
export function CartView({ symbol }: { symbol: string }) {
  const lines = useCartLines();
  const seat = useSeat();

  if (lines.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-bold">Your order is empty</h2>
        <p className="mt-2 text-sm soft">
          {seat
            ? `You are seated at table ${seat.tableLabel}. Add dishes from the menu and they will be ready to send to the kitchen from here.`
            : "Add a dish from the menu. If you are at a table, scan the QR code on it and this list becomes your order for that table."}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/menu" className="btn btn-primary">
            Browse the menu
          </Link>
          <Link href="/reservations" className="btn btn-outline">
            Book a table
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {seat ? (
        <p className="notice">
          These dishes will be sent to <strong>table {seat.tableLabel}</strong> (session {seat.sessionCode}).{" "}
          <Link href="/order" className="underline">
            See the table&apos;s orders
          </Link>
        </p>
      ) : (
        <p className="hint">
          Not seated at a table? This list becomes a takeaway or delivery order at the next step.{" "}
          <Link href="/order" className="underline">
            Or enter a table code
          </Link>
        </p>
      )}

      <ul className="card divide-y divide-line">
        {lines.map((line) => (
          <li key={line.key} className="p-4">
            <LineRow line={line} symbol={symbol} />
          </li>
        ))}
      </ul>

      <div className="card p-4">
        <div className="flex items-baseline justify-between">
          <span className="label">Your food, before charges</span>
          <span className="price text-lg">{formatPoisa(cartSubtotalPoisa(lines), { symbol })}</span>
        </div>
        <p className="hint mt-2">
          Service charge, VAT and any delivery fee are added by the restaurant when the order is placed — this figure is
          only the sum of the menu prices above.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/checkout" className="btn btn-primary">
            Review and place order
          </Link>
          <Link href="/menu" className="btn btn-ghost">
            Keep browsing
          </Link>
        </div>
      </div>
    </div>
  );
}

function LineRow({ line, symbol }: { line: CartLine; symbol: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Link href={`/menu/${line.slug}`} className="font-semibold hover:text-brand">
          {line.name}
        </Link>
        <p className="hint mt-1">
          {formatPoisa(line.unitPricePoisa, { symbol })} each
          {line.options.length > 0 ? ` · ${line.options.map((option) => option.name).join(", ")}` : ""}
        </p>
        {line.options.some((option) => option.priceDeltaPoisa !== 0) ? (
          <p className="hint">
            with{" "}
            {line.options
              .filter((option) => option.priceDeltaPoisa !== 0)
              .map((option) => `${option.name} ${option.priceDeltaPoisa > 0 ? "+" : "−"}${formatPoisa(Math.abs(option.priceDeltaPoisa), { symbol }).replace(symbol, "")}`)
              .join(", ")}
          </p>
        ) : null}
        {line.instructions ? <p className="mt-1 text-xs soft italic">“{line.instructions}”</p> : null}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setQuantity(line.key, line.quantity - 1)}
            aria-label={`One fewer ${line.name}`}
          >
            −
          </button>
          <span className="w-8 text-center font-semibold tabular-nums">{line.quantity}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setQuantity(line.key, line.quantity + 1)}
            aria-label={`One more ${line.name}`}
          >
            +
          </button>
        </div>
        <span className="price w-24 text-right">{formatPoisa(lineTotalPoisa(line), { symbol })}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLine(line.key)}>
          Remove
        </button>
      </div>
    </div>
  );
}
