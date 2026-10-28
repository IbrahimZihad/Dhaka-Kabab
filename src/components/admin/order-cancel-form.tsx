"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * Cancellation is its own door, with its own reason requirement — the same one
 * the API enforces. A blank reason is refused here so the person gets told
 * immediately, and the server still refuses if something sneaks past.
 */
export function OrderCancelForm({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const { busy, error, notice, setNotice, run } = useAdminAction();

  async function cancel(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setReasonError("A short reason is required — it is kept on the order record.");
      return;
    }
    setReasonError(null);
    const result = await run<{ message?: string }>("POST", `/api/orders/${orderId}/cancel`, { reason: trimmed });
    if (!result) return;
    setReason("");
    setNotice(result.message ?? `Order ${orderNumber} was cancelled and recorded.`);
    router.refresh();
  }

  return (
    <form onSubmit={cancel} className="space-y-3">
      <div>
        <label className="label" htmlFor={`cancel-${orderId}`}>
          Reason for cancelling
        </label>
        <textarea
          id={`cancel-${orderId}`}
          className="textarea mt-1"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
          rows={2}
          placeholder="Guest walked out, dish out of stock, ordered in error…"
        />
        <p className="hint mt-1">The order and its history are kept; cancelling is never a delete.</p>
      </div>
      {reasonError ? <p className="notice notice-error">{reasonError}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}
      <button type="submit" className="btn btn-danger btn-sm" disabled={busy}>
        {busy ? "Cancelling…" : "Cancel this order"}
      </button>
    </form>
  );
}
