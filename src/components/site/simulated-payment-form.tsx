"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client-api";

/**
 * The stand-in for a bank's hosted page. It asks us to record an outcome; it does
 * not assert one, and it cannot — the proof that authenticates a notification is
 * computed on the server when this button is pressed.
 */
export function SimulatedPaymentForm({
  reference,
  amount,
  next,
}: {
  reference: string;
  amount: string;
  next: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function choose(outcome: "APPROVED" | "DECLINED" | "ABANDONED") {
    setBusy(true);
    setError(null);
    const response = await apiFetch<{ status: string; message: string }>("/api/payments/simulated/complete", {
      method: "POST",
      body: { reference, outcome },
    });
    setBusy(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    setDone(response.data.message);
    window.setTimeout(() => window.location.assign(next), 900);
  }

  return (
    <div className="card p-5">
      <p className="text-sm">
        Paying <span className="price text-lg">{amount}</span>
      </p>
      {error ? <p className="notice notice-error mt-3">{error}</p> : null}
      {done ? (
        <p className="notice notice-ok mt-3">{done} Returning you to the restaurant…</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" onClick={() => choose("APPROVED")} disabled={busy}>
            Approve payment
          </button>
          <button type="button" className="btn btn-outline" onClick={() => choose("DECLINED")} disabled={busy}>
            Decline (not enough funds)
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => choose("ABANDONED")} disabled={busy}>
            Close without paying
          </button>
        </div>
      )}
      <p className="hint mt-4">
        Nothing here touches a card. Every record this page creates is flagged as simulated, so it can never be read as
        takings.
      </p>
    </div>
  );
}
