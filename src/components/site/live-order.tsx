"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { OrderCard } from "@/components/site/order-card";
import type { PlacedOrder } from "@/lib/order-submit";

/**
 * A confirmation page that keeps itself current. The first paint comes from the
 * server; after that the browser re-reads the same public endpoint a guest could
 * call by hand, so there is no second source of truth to drift from.
 */
export function LiveOrder({ token, initial }: { token: string; initial: PlacedOrder }) {
  const [order, setOrder] = useState<PlacedOrder>(initial);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    const response = await apiFetch<{ order: PlacedOrder }>(`/api/orders/track/${encodeURIComponent(token)}`);
    if (response.ok) {
      setOrder(response.data.order);
      setStale(false);
    } else {
      setStale(true);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="space-y-3">
      <OrderCard order={order} />
      <p className="hint">
        {stale
          ? "This page could not reach us just now — the details above are the last we had."
          : "This page refreshes itself every few seconds while the kitchen works."}
      </p>
    </div>
  );
}
