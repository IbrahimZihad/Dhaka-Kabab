"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";

/** One step the server would accept from this booking's current status. */
export type ReservationStep = { status: string; label: string };

/**
 * Status moves for one booking. The steps are worked out on the server from the
 * booking's stored status and the reservation service's own transition rules,
 * so a button here exists only where the service would grant the move. Success
 * is reported from the response, never before it; cancellation requires a
 * reason, which is sent with the move.
 */
export function ReservationStatusActions({
  reservationId,
  code,
  steps,
  floorHref,
}: {
  reservationId: string;
  code: string;
  steps: ReservationStep[];
  floorHref: string;
}) {
  const router = useRouter();
  const { busy, error, notice, setNotice, setError, run } = useAdminAction();
  const [reason, setReason] = useState("");
  const [seated, setSeated] = useState(false);

  async function move(status: string, label: string) {
    const moved = await run<{ session?: { id: string; code: string } }>(
      "PATCH",
      `/api/reservations/${reservationId}`,
      { status },
    );
    if (!moved) return;
    if (status === "CHECKED_IN") {
      setNotice(
        `Booking ${code} is marked arrived${moved.session ? ` — table session ${moved.session.code} is open` : ""}.`,
      );
      setSeated(true);
    } else {
      setNotice(`Booking ${code} is now ${label.toLowerCase()}.`);
      setSeated(false);
    }
    router.refresh();
  }

  async function cancel(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError("A cancellation needs a short reason — it is kept on the booking.");
      return;
    }
    const moved = await run("PATCH", `/api/reservations/${reservationId}`, {
      status: "CANCELLED",
      reason: trimmed,
    });
    if (!moved) return;
    setNotice(`Booking ${code} is cancelled. The reason was recorded.`);
    setReason("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {steps.length === 0 ? (
        <p className="hint">
          Nothing can be changed — the booking has reached its final state, and only the server decides that.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {steps.map((step, index) => (
            <button
              key={step.status}
              type="button"
              className={index === 0 ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}
              disabled={busy}
              onClick={() => move(step.status, step.label)}
            >
              {busy ? "Sending…" : step.label}
            </button>
          ))}
        </div>
      )}

      {notice ? (
        <p className="notice notice-ok">
          {notice}
          {seated ? (
            <>
              {" "}
              <Link href={floorHref} className="underline">
                Open the floor board
              </Link>{" "}
              to run the visit.
            </>
          ) : null}
        </p>
      ) : null}
      {error ? <p className="notice notice-error">{error}</p> : null}

      {steps.some((step) => step.status === "CANCELLED") ? (
        <form className="mt-2 space-y-2 rounded-md border border-line p-3" onSubmit={cancel}>
          <label className="label" htmlFor={`cancel-reason-${reservationId}`}>
            Reason for cancelling (required)
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`cancel-reason-${reservationId}`}
              className="input flex-1"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder="e.g. guest telephoned to drop the table"
            />
            <button type="submit" className="btn btn-danger btn-sm" disabled={busy}>
              {busy ? "Sending…" : "Cancel the booking"}
            </button>
          </div>
          <p className="hint">The reason is stored on the booking and shown on its page.</p>
        </form>
      ) : null}
    </div>
  );
}
