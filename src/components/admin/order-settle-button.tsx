"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/client-api";

/**
 * The one action a served order needs: put it on the till and go there.
 *
 * It raises the bill when there is none — the table's own bill for a dine-in order,
 * a bill of its own for a takeaway — and lands on the screen that finalizes, takes
 * the money and prints the receipt. The owner should never have to find the floor
 * board or a second tab to charge a guest who is already standing at the counter.
 */
export function OrderSettleButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    const response = await apiFetch<{ billId: string }>(`/api/orders/${orderId}/bill`, { method: "POST" });
    if (!response.ok) {
      setBusy(false);
      setError(response.error.message);
      return;
    }
    // Deliberately not clearing `busy`: the page is about to change under the button.
    router.push(`/admin/bills/${response.data.billId}`);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className="btn btn-primary btn-sm" onClick={go} disabled={busy}>
        {busy ? "Opening the bill…" : "Bill & take payment"}
      </button>
      {error ? <p className="notice notice-error">{error}</p> : null}
    </div>
  );
}
