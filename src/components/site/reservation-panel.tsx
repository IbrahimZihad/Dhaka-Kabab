"use client";

import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { formatInZone } from "@/lib/time";

export type ReservationView = {
  code: string;
  status: string;
  customerName: string;
  partySize: number;
  startsAt: string;
  durationMinutes: number;
  tables: string[];
  specialRequests: string | null;
  canChange: boolean;
  /** Shown in the restaurant's zone, so it matches the slot grid the guest picked from. */
  timeZone: string;
};

const MEANING: Record<string, string> = {
  PENDING: "We have your request. A manager has not confirmed it yet.",
  CONFIRMED: "Your table is confirmed.",
  CHECKED_IN: "You are marked as arrived.",
  COMPLETED: "This visit is closed. Thank you for dining with us.",
  CANCELLED: "This booking is cancelled.",
  NO_SHOW: "The table was released as a no-show.",
};

/**
 * The guest's view of one booking. It is reachable only through the token minted
 * when the request was made — the short code on its own is guessable, so it is
 * shown but never used as the credential.
 */
export function ReservationPanel({ view, token }: { view: ReservationView; token: string }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState(view.status);

  async function cancel() {
    setBusy(true);
    setError(null);
    const response = await apiFetch<{ message: string; status: string }>("/api/reservations/cancel", {
      method: "POST",
      body: { token, reason: reason.trim() || "Cancelled by the guest" },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setStatus(response.data.status);
    setMessage(response.data.message);
  }

  const starts = new Date(view.startsAt);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">Booking {view.code}</h2>
        <span className={`badge ${status === "CANCELLED" || status === "NO_SHOW" ? "badge-closed" : status === "PENDING" ? "badge" : "badge-open"}`}>
          {status.replace(/_/g, " ").toLowerCase()}
        </span>
      </div>
      <p className="hint mt-1">{MEANING[status] ?? "This booking has moved on from the state below."}</p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="label">For</dt>
          <dd>{view.customerName}</dd>
        </div>
        <div>
          <dt className="label">Party</dt>
          <dd>
            {view.partySize} guest{view.partySize === 1 ? "" : "s"}
          </dd>
        </div>
        <div>
          <dt className="label">When</dt>
          <dd>{formatInZone(starts, view.timeZone)}</dd>
        </div>
        <div>
          <dt className="label">Held for</dt>
          <dd>{view.durationMinutes} minutes</dd>
        </div>
        <div className="col-span-2">
          <dt className="label">Table</dt>
          <dd>{view.tables.length > 0 ? view.tables.join(", ") : "Not allocated yet — staff assign it when they confirm."}</dd>
        </div>
        {view.specialRequests ? (
          <div className="col-span-2">
            <dt className="label">Your note</dt>
            <dd>“{view.specialRequests}”</dd>
          </div>
        ) : null}
      </dl>

      {message ? <p className="notice notice-ok mt-4">{message}</p> : null}
      {error ? <p className="notice notice-error mt-4">{error}</p> : null}

      {view.canChange && status !== "CANCELLED" ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-sm font-semibold">Need to drop the table?</p>
          <p className="hint mt-1">
            Cancelling frees the seats for someone else straight away. If you need a different time, book again — it is
            quicker than us editing this one.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              className="input flex-1"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (optional)"
              maxLength={200}
              aria-label="Reason for cancelling"
            />
            <button type="button" className="btn btn-danger" onClick={cancel} disabled={busy}>
              {busy ? "Cancelling…" : "Cancel this booking"}
            </button>
          </div>
        </div>
      ) : null}

      <p className="hint mt-4">
        Keep this link — it is the only way to see or change this booking.{" "}
        <Link href="/reservations" className="underline">
          Book another table
        </Link>
        .
      </p>
    </div>
  );
}
