"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrderStatus, OrderType } from "@prisma/client";
import { apiFetch } from "@/lib/client-api";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { ORDER_TYPE_LABELS } from "@/lib/staff-format";
import {
  KitchenTicketCard,
  OVERDUE_AFTER_MINUTES,
  type KitchenCapabilities,
  type KitchenTicket,
} from "@/components/admin/kitchen-ticket";

/**
 * The kitchen board: three columns, refreshed by polling the existing
 * /api/kitchen/queue endpoint every 15 seconds. The queue route is the safe
 * projection — no money, no contacts — and nothing rendered here adds any.
 */

const QUEUE_PATH = "/api/kitchen/queue";
const POLL_MS = 15_000;

type QueueResponse = {
  counters: Record<string, number>;
  orders: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    type: OrderType;
    table: string | null;
    sessionCode: string | null;
    elapsedMinutes: number;
    expectedMinutes: number;
    overdue: boolean;
    specialInstructions: string | null;
    items: { id: string; name: string; quantity: number; instructions: string | null; options: string[] }[];
  }[];
};

export function destinationFor(order: { type: OrderType; table: string | null }): string {
  if (order.type === "DINE_IN") return order.table ? `Table ${order.table}` : "Table";
  return ORDER_TYPE_LABELS[order.type];
}

function toTicket(order: QueueResponse["orders"][number]): KitchenTicket {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    type: order.type,
    destination: destinationFor(order),
    elapsedMinutes: order.elapsedMinutes,
    overdue: order.overdue || order.elapsedMinutes >= OVERDUE_AFTER_MINUTES,
    specialInstructions: order.specialInstructions,
    items: order.items,
  };
}

const COLUMNS: { key: string; title: string; statuses: OrderStatus[] }[] = [
  { key: "new", title: "New", statuses: ["PENDING", "CONFIRMED"] },
  { key: "cooking", title: "Cooking", statuses: ["PREPARING"] },
  { key: "ready", title: "Ready", statuses: ["READY"] },
];

type Filter = "ALL" | OrderType;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DINE_IN", label: "Table" },
  { key: "TAKEAWAY", label: "Takeaway" },
  { key: "DELIVERY", label: "Delivery" },
];

/** Wall-clock in the restaurant's own timezone, with seconds, for the poll stamp. */
function clockInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(instant);
}

export default function KitchenQueue({
  tickets: initialTickets,
  timezone,
  restaurantDate,
  capabilities,
}: {
  tickets: KitchenTicket[];
  timezone: string;
  /** The restaurant's own calendar day (YYYY-MM-DD) this board is served for. */
  restaurantDate: string;
  capabilities: KitchenCapabilities;
}) {
  const [tickets, setTickets] = useState<KitchenTicket[]>(initialTickets);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [connLost, setConnLost] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const { busy, error, run, dismiss } = useAdminAction();

  const load = useCallback(async () => {
    const response = await apiFetch<QueueResponse>(QUEUE_PATH);
    if (!response.ok) {
      setConnLost(true);
      return;
    }
    setTickets(response.data.orders.map(toTicket));
    setUpdatedAt(new Date());
    setConnLost(false);
  }, []);

  useEffect(() => {
    let active = true;
    // The server-rendered tickets are fresh at page delivery; the first poll
    // lands 15 seconds later. Polling stops while the screen is hidden and
    // catches up the moment it becomes visible again.
    const refresh = () => {
      if (active && !document.hidden) void load();
    };
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  async function advance(ticket: KitchenTicket, to: OrderStatus) {
    // Send only the id and the target status — never any money — and only
    // believe the move once the server has answered. The response body is
    // ignored entirely; the queue refetch is the single source of truth.
    const moved = await run<unknown>("PATCH", `/api/orders/${ticket.id}/status`, { status: to });
    if (!moved) return;
    await dismiss();
    await load();
  }

  const visible = filter === "ALL" ? tickets : tickets.filter((ticket) => ticket.type === filter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kitchen</h1>
          <p className="hint mt-1">
            {connLost ? (
              <span className="font-bold text-danger">Connection lost — retrying.</span>
            ) : updatedAt ? (
              <>
                Restaurant day {restaurantDate} · live, updated{" "}
                <span className="font-mono tabular-nums">{clockInZone(updatedAt, timezone)}</span> ({timezone}, checks every
                15 seconds, paused while the screen is hidden)
              </>
            ) : (
              `Restaurant day ${restaurantDate} · the tickets below are from page load; first automatic refresh in a few seconds (${timezone})`
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter tickets by order type">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={`btn btn-sm ${filter === option.key ? "btn-primary" : "btn-outline"}`}
              aria-pressed={filter === option.key}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {connLost ? (
        <p className="notice notice-error">
          The board below is from the last successful refresh ({updatedAt ? clockInZone(updatedAt, timezone) : "not yet refreshed"}{" "}
          and may show tickets that have moved on. Retrying automatically.
        </p>
      ) : null}

      {error ? (
        <div className="notice notice-error flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dismiss()}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {COLUMNS.map((column) => {
          const columnTickets = visible.filter((ticket) => column.statuses.includes(ticket.status));
          return (
            <section key={column.key} className="card p-4">
              <h2 className="text-xl font-bold">
                {column.title} <span className="tabular-nums">({columnTickets.length})</span>
              </h2>
              <div className="mt-3 space-y-4">
                {columnTickets.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-lg font-semibold muted">
                    Nothing on the pass
                  </p>
                ) : (
                  columnTickets.map((ticket) => (
                    <KitchenTicketCard key={ticket.id} ticket={ticket} caps={capabilities} busy={busy} onAdvance={advance} />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
