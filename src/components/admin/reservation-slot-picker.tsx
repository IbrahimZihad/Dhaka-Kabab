"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";

/**
 * The slot grid for one date and party size, taken from the availability
 * endpoint. Whether a slot is free is the server's fact, never the browser's:
 * this component only lists what the database proved free when it was fetched,
 * with the server's own reason beside every slot it could not confirm.
 */
export type SlotAvailability = {
  dateKey: string;
  slots: { time: string; available: boolean; reason?: string }[];
  closed: boolean;
  maxPartySize: number;
};

export function ReservationSlotPicker({
  idPrefix,
  dateKey,
  partySize,
  onPick,
  picked,
}: {
  idPrefix: string;
  dateKey: string;
  partySize: number;
  picked: string | null;
  onPick: (time: string | null) => void;
}) {
  const [availability, setAvailability] = useState<SlotAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  // Every state change runs after the first await, so a re-render caused by a
  // date change cannot leave a stale answer behind: only the newest request may
  // settle. The parent owns the chosen time and clears it on those changes.
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    await Promise.resolve();
    if (request !== requestRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isInteger(partySize) || partySize < 1) {
      setLoading(false);
      setAvailability(null);
      setError("Choose a day and a party size first.");
      return;
    }
    setLoading(true);
    setError(null);
    const response = await apiFetch<SlotAvailability>(
      `/api/reservations/availability?dateKey=${encodeURIComponent(dateKey)}&partySize=${partySize}`,
    );
    if (request !== requestRef.current) return;
    setLoading(false);
    if (response.ok) setAvailability(response.data);
    else {
      setAvailability(null);
      setError(response.error.message);
    }
  }, [dateKey, partySize]);

  useEffect(() => {
    // The grid is the server's fact, so it is re-drawn whenever the day or the
    // party size changes. Every state change inside `load` lands off the
    // synchronous path (after the first await) and only the newest request may
    // settle, which is the synchronisation this effect exists for.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see the note above
    void load();
  }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label">Free times</p>
        <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => void load()}>
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>

      {loading ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <span key={index} className="skeleton block h-9 w-20" />
          ))}
        </div>
      ) : error ? (
        <p className="notice mt-2">{error}</p>
      ) : availability && availability.slots.length === 0 ? (
        <p className="notice mt-2">
          {availability.closed
            ? "We are closed on that day, so there is nothing to offer."
            : "No seating window fits a party of that size left on that day. Try another date or a smaller party."}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {availability?.slots.map((slot) => (
              <button
                key={slot.time}
                type="button"
                disabled={!slot.available}
                onClick={() => onPick(picked === slot.time ? null : slot.time)}
                title={slot.reason}
                id={`${idPrefix}-slot-${slot.time}`}
                className={
                  picked === slot.time
                    ? "btn btn-primary btn-sm"
                    : slot.available
                      ? "btn btn-outline btn-sm"
                      : "btn btn-ghost btn-sm opacity-50 line-through"
                }
              >
                {slot.time}
                {slot.reason ? <span className="ml-1 text-xs opacity-70">({slot.reason})</span> : null}
              </button>
            ))}
          </div>
          {availability ? (
            <p className="hint mt-2">
              A table is held for the sitting window from the time chosen. The room seats up to{" "}
              {availability.maxPartySize} guests at once, and unavailable times carry the reason the server gave —
              nothing here is held while the form is filled in.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
