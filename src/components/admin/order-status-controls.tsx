"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * A step this person may take, worked out on the server from the order's current
 * status and the role's permissions — the same two checks the API applies, so a
 * button here is never offered for a move the service would refuse.
 */
export type OrderTransition = { status: string; label: string };

/**
 * Status moves. Only the status and an optional note are sent; the server owns
 * every figure on the order and the transition rules. Success is reported from
 * the response, never before it.
 */
export function OrderStatusControls({
  orderId,
  orderNumber,
  transitions,
}: {
  orderId: string;
  orderNumber: string;
  transitions: OrderTransition[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const { busy, error, notice, setNotice, run } = useAdminAction();

  async function move(to: string, label: string) {
    const trimmed = note.trim();
    const updated = await run<{ status?: string }>(
      "PATCH",
      `/api/orders/${orderId}/status`,
      trimmed ? { status: to, note: trimmed } : { status: to },
    );
    if (!updated) return;
    setNotice(`Order ${orderNumber} is now ${label}.`);
    setNote("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {transitions.length === 0 ? (
        <p className="hint">
          No step to take from here. Either this order has finished, or the next step belongs to another role.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {transitions.map((step, index) => (
            <button
              key={step.status}
              type="button"
              className={index === 0 ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}
              disabled={busy}
              onClick={() => move(step.status, step.label)}
            >
              {busy ? "Sending…" : `Mark ${step.label.toLowerCase()}`}
            </button>
          ))}
        </div>
      )}

      <div>
        <label className="label" htmlFor={`order-note-${orderId}`}>
          Note for the next step (optional)
        </label>
        <input
          id={`order-note-${orderId}`}
          className="input mt-1"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
          placeholder="Why the order moved, if it needs saying"
        />
      </div>

      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}
    </div>
  );
}
