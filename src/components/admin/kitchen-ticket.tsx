"use client";

import type { OrderStatus, OrderType } from "@prisma/client";
import { ORDER_STATUS_LABELS } from "@/lib/staff-format";

/**
 * One ticket on the kitchen board. The type only carries what a cook is allowed
 * to see: the dishes, the quantities, the chosen options and the notes. There is
 * deliberately no price, total, customer name, phone number or address field
 * here, so money cannot leak onto this screen through the props.
 */

export type KitchenTicketItem = {
  id: string;
  name: string;
  quantity: number;
  options: string[];
  instructions: string | null;
};

export type KitchenTicket = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  type: OrderType;
  /** Where the food is going: a table label, or Takeaway / Delivery. Never a name. */
  destination: string;
  elapsedMinutes: number;
  overdue: boolean;
  specialInstructions: string | null;
  items: KitchenTicketItem[];
};

/** A ticket this old is flagged hard — a wall screen is read at a glance. */
export const OVERDUE_AFTER_MINUTES = 20;

/**
 * The queue projection carries no dedicated allergen column, so an allergen
 * warning is recognised from the note text the guests write. Deliberately
 * broad: a missed peanut note is worse than a false alarm.
 */
const ALLERGEN_PATTERN =
  /\b(allergen|allergens|allergy|allergic|peanut|peanuts|groundnut|cashew|almond|walnut|pistachio|hazelnut|nut|nuts|sesame|sesamum|mustard|shellfish|prawn|prawns|shrimp|shrimps|crab|lobster|mollusc|mollusk|squid|oyster|egg|eggs|mayonnaise|milk|dairy|cheese|butter|ghee|paneer|gluten|wheat|barley|rye|oat|oats|soy|soya|tofu|bean|sulphite|sulfite)\b/i;

export function allergenNotes(ticket: KitchenTicket): string[] {
  const notes: string[] = [];
  if (ticket.specialInstructions && ALLERGEN_PATTERN.test(ticket.specialInstructions)) {
    notes.push(ticket.specialInstructions);
  }
  for (const item of ticket.items) {
    if (item.instructions && ALLERGEN_PATTERN.test(item.instructions)) {
      notes.push(`${item.name}: ${item.instructions}`);
    }
  }
  return notes;
}

export function formatTicketAge(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} h ${rest} min ago` : `${hours} h ago`;
}

export type KitchenCapabilities = { confirm: boolean; cook: boolean; serve: boolean };

export type KitchenAction = { to: OrderStatus; label: string; primary: boolean };

/**
 * Mirrors the server's transition rules (order.service TRANSITIONS plus the
 * per-status permission in the status route) so we only ever offer a button the
 * API will accept for this role.
 */
export function actionsFor(status: OrderStatus, caps: KitchenCapabilities): KitchenAction[] {
  switch (status) {
    case "PENDING":
      return caps.confirm ? [{ to: "CONFIRMED", label: "Confirm", primary: false }] : [];
    case "CONFIRMED":
      return caps.cook ? [{ to: "PREPARING", label: "Start", primary: true }] : [];
    case "PREPARING":
      return caps.cook ? [{ to: "READY", label: "Ready", primary: true }] : [];
    case "READY":
      return caps.serve ? [{ to: "SERVED", label: "Served", primary: true }] : [];
    default:
      return [];
  }
}

export function KitchenTicketCard({
  ticket,
  caps,
  busy,
  onAdvance,
}: {
  ticket: KitchenTicket;
  caps: KitchenCapabilities;
  busy: boolean;
  onAdvance: (ticket: KitchenTicket, to: OrderStatus) => void;
}) {
  const actions = actionsFor(ticket.status, caps);
  const allergens = allergenNotes(ticket);
  const stale = ticket.overdue || ticket.elapsedMinutes >= OVERDUE_AFTER_MINUTES;

  return (
    <article className={`card p-5 ${stale ? "border-2 border-danger" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-3xl font-bold tracking-tight">{ticket.orderNumber}</p>
        <p className={`text-2xl font-semibold tabular-nums ${stale ? "text-danger" : "soft"}`}>
          {formatTicketAge(ticket.elapsedMinutes)}
          {stale ? " · running late" : ""}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="badge text-lg">{ticket.destination}</span>
        <span className="badge text-lg">{ORDER_STATUS_LABELS[ticket.status]}</span>
      </div>

      {allergens.length > 0 ? (
        <div className="notice notice-error mt-3 text-lg font-bold">
          <p>Allergen warning — check before cooking:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 font-semibold">
            {allergens.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {ticket.specialInstructions && allergens.length === 0 ? (
        <p className="notice mt-3 text-lg">For the whole order: {ticket.specialInstructions}</p>
      ) : null}

      <ul className="mt-4 divide-y divide-line">
        {ticket.items.map((item) => (
          <li key={item.id} className="py-3">
            <p className="text-2xl font-bold">
              <span className="tabular-nums">{item.quantity}×</span> {item.name}
            </p>
            {item.options.length > 0 ? <p className="hint mt-1 text-base">with {item.options.join(", ")}</p> : null}
            {item.instructions ? (
              <p
                className={`mt-1 rounded-md border border-line px-3 py-2 text-lg font-semibold ${
                  ALLERGEN_PATTERN.test(item.instructions) ? "text-danger" : "text-ink"
                }`}
              >
                Kitchen note: {item.instructions}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {actions.length > 0 ? (
        <div className="mt-4 flex gap-3">
          {actions.map((action) => (
            <button
              key={action.to}
              type="button"
              disabled={busy}
              onClick={() => onAdvance(ticket, action.to)}
              className={`btn flex-1 py-5 text-xl font-bold ${action.primary ? "btn-primary" : "btn-outline"}`}
            >
              {busy ? "Working…" : action.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="hint mt-4">No step here is yours to take — this ticket waits for another role.</p>
      )}
    </article>
  );
}
