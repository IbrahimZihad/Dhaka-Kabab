"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { ReservationSlotPicker } from "@/components/admin/reservation-slot-picker";

/**
 * Amending a booking's day, time or party size. The new time is chosen from
 * the availability endpoint — the same server-side proof the guest sees — and
 * the service re-runs the whole clash check when the change lands, so a slot
 * taken in the seconds since the grid was drawn is refused with the server's
 * own words rather than silently double-booked.
 */
export function ReservationRescheduleForm({
  reservationId,
  code,
  initialDateKey,
  initialTime,
  initialPartySize,
  todayKey,
  maxDaysAhead,
}: {
  reservationId: string;
  code: string;
  initialDateKey: string;
  initialTime: string;
  initialPartySize: number;
  todayKey: string;
  maxDaysAhead: number;
}) {
  const router = useRouter();
  const { busy, error, notice, setNotice, setError, run } = useAdminAction();

  const [dateKey, setDateKey] = useState(initialDateKey);
  const [partySize, setPartySize] = useState(initialPartySize);
  const [time, setTime] = useState<string | null>(initialTime);
  const [slotsKey, setSlotsKey] = useState(0);

  const max = new Date(`${todayKey}T12:00:00Z`);
  max.setUTCDate(max.getUTCDate() + maxDaysAhead);
  const maxDate = max.toISOString().slice(0, 10);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!time) {
      setError("Choose a time from the grid first.");
      return;
    }
    const moved = await run("PATCH", `/api/reservations/${reservationId}`, {
      dateKey,
      time,
      partySize,
    });
    if (!moved) {
      setTime(null);
      setSlotsKey((key) => key + 1);
      return;
    }
    setNotice(`Booking ${code} now stands at ${dateKey}, ${time}, for ${partySize} guest${partySize === 1 ? "" : "s"}.`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`resched-date-${reservationId}`}>
            New day
          </label>
          <input
            id={`resched-date-${reservationId}`}
            className="input mt-1"
            type="date"
            value={dateKey}
            min={todayKey}
            max={maxDate}
            onChange={(event) => {
              setDateKey(event.target.value);
              setTime(null);
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor={`resched-party-${reservationId}`}>
            Party size
          </label>
          <input
            id={`resched-party-${reservationId}`}
            className="input mt-1"
            type="number"
            min={1}
            max={60}
            inputMode="numeric"
            value={partySize}
            onChange={(event) => {
              setPartySize(Math.max(1, Math.min(60, Number(event.target.value) || 1)));
              setTime(null);
            }}
          />
        </div>
      </div>

      <div className="rounded-md border border-line p-3">
        <ReservationSlotPicker
          key={slotsKey}
          idPrefix={`resched-${reservationId}`}
          dateKey={dateKey}
          partySize={partySize}
          picked={time}
          onPick={setTime}
        />
      </div>

      <p className="hint">
        Moving the booking re-checks availability and re-picks the tables inside the same locked transaction that
        guards new bookings — including the guest&apos;s own link, which keeps working after the change.
      </p>

      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}

      <button type="submit" className="btn btn-outline btn-sm" disabled={busy || !time}>
        {busy ? "Sending…" : "Move the booking"}
      </button>
    </form>
  );
}
