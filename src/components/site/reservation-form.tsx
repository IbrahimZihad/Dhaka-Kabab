"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { formatPoisa } from "@/lib/money";

type Slots = {
  dateKey: string;
  slots: { time: string; available: boolean; reason?: string }[];
  closed: boolean;
  maxPartySize: number;
};

const PHONE = /^(\+?880|880|0)?1[3-9]\d{8}$/;

function tomorrowKey(todayKey: string): string {
  const date = new Date(`${todayKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Booking is a request, not a hold: the slots below are what the database could
 * prove were free at the moment they were fetched, and nothing is reserved until
 * a manager approves the request.
 */
export function ReservationForm({
  todayKey,
  maxDaysAhead,
  durationMinutes,
  depositPoisa,
  requirePolicy,
  symbol,
}: {
  todayKey: string;
  maxDaysAhead: number;
  durationMinutes: number;
  depositPoisa: number;
  requirePolicy: boolean;
  symbol: string;
}) {
  const router = useRouter();
  const [partySize, setPartySize] = useState(2);
  const [dateKey, setDateKey] = useState(() => tomorrowKey(todayKey));
  const [availability, setAvailability] = useState<Slots | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [requests, setRequests] = useState("");
  const [accepted, setAccepted] = useState(!requirePolicy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSlots = useCallback(async () => {
    setLoadingSlots(true);
    setSlotError(null);
    setTime(null);
    const response = await apiFetch<Slots>(
      `/api/reservations/availability?dateKey=${encodeURIComponent(dateKey)}&partySize=${partySize}`,
    );
    setLoadingSlots(false);
    if (response.ok) setAvailability(response.data);
    else {
      setAvailability(null);
      setSlotError(response.error.message);
    }
  }, [dateKey, partySize]);

  useEffect(() => {
    // Queued a tick out: loading slots writes state, and doing that inside the
    // effect render would cascade straight out of it on every date change.
    const start = window.setTimeout(() => void loadSlots(), 0);
    return () => window.clearTimeout(start);
  }, [loadSlots]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!time) return setError("Choose a time from the list first.");
    const cleanPhone = phone.replace(/[\s()-]/g, "");
    if (name.trim().length < 2) return setError("Please tell us who the table is for.");
    if (!PHONE.test(cleanPhone)) return setError("Enter a Bangladeshi mobile number, e.g. 01712345678.");
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("That email address does not look right.");

    setBusy(true);
    setError(null);
    const response = await apiFetch<{ publicToken: string; code: string; message: string }>("/api/reservations", {
      method: "POST",
      body: {
        customerName: name.trim(),
        phone: cleanPhone,
        email: email.trim(),
        dateKey,
        time,
        partySize,
        ...(requests.trim() ? { specialRequests: requests.trim() } : {}),
        policyAccepted: accepted,
      },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      void loadSlots();
      return;
    }
    router.push(`/reserve/confirm?token=${encodeURIComponent(response.data.publicToken)}&code=${encodeURIComponent(response.data.code)}`);
  }

  const minDate = todayKey;
  const maxDate = (() => {
    const date = new Date(`${todayKey}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + maxDaysAhead);
    return date.toISOString().slice(0, 10);
  })();

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="rs-party">
            How many guests?
          </label>
          <input
            id="rs-party"
            className="input mt-1"
            type="number"
            min={1}
            max={60}
            value={partySize}
            onChange={(event) => setPartySize(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
          />
          {availability ? <p className="hint mt-1">Our room seats up to {availability.maxPartySize} at once.</p> : null}
        </div>
        <div>
          <label className="label" htmlFor="rs-date">
            Which day?
          </label>
          <input
            id="rs-date"
            className="input mt-1"
            type="date"
            value={dateKey}
            min={minDate}
            max={maxDate}
            onChange={(event) => setDateKey(event.target.value)}
          />
          <p className="hint mt-1">Bookings open up to {maxDaysAhead} days ahead.</p>
        </div>
      </div>

      <div className="card p-5">
        <p className="label">Free times</p>
        {loadingSlots ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <span key={index} className="skeleton block h-9 w-20" />
            ))}
          </div>
        ) : slotError ? (
          <p className="notice mt-2">{slotError}</p>
        ) : availability && availability.slots.length === 0 ? (
          <p className="notice mt-2">
            {availability.closed
              ? "We are closed on that day."
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
                  onClick={() => setTime(slot.time)}
                  className={
                    time === slot.time
                      ? "btn btn-primary btn-sm"
                      : slot.available
                        ? "btn btn-outline btn-sm"
                        : "btn btn-ghost btn-sm opacity-50 line-through"
                  }
                  title={slot.reason}
                >
                  {slot.time}
                  {slot.reason ? <span className="ml-1 text-xs opacity-70">({slot.reason})</span> : null}
                </button>
              ))}
            </div>
            <p className="hint mt-3">
              A table is held for {durationMinutes} minutes from the time you pick. These are times the kitchen and
              floor could honour when this list was drawn up — nothing is held while you fill the form below.
            </p>
          </>
        )}
      </div>

      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="rs-name">
            Name on the booking
          </label>
          <input id="rs-name" className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div>
          <label className="label" htmlFor="rs-phone">
            Mobile number
          </label>
          <input id="rs-phone" className="input mt-1" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01712345678" maxLength={20} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="rs-email">
            Email (optional — for the confirmation)
          </label>
          <input id="rs-email" className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="rs-requests">
            Anything we should know? (optional)
          </label>
          <textarea id="rs-requests" className="textarea mt-1" value={requests} onChange={(e) => setRequests(e.target.value)} maxLength={400} placeholder="High chair, birthday, allergy…" />
        </div>
      </div>

      <label className="card flex items-start gap-3 p-4 text-sm">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1" />
        <span>
          I understand this is a <strong>request</strong>: a manager confirms it, and the table is only mine once that
          happens.
          {depositPoisa > 0 ? (
            <>
              {" "}
              A deposit of {formatPoisa(depositPoisa, { symbol })} may be collected — staff will tell me before any money
              is taken.
            </>
          ) : null}
        </span>
      </label>

      {error ? <p className="notice notice-error">{error}</p> : null}

      <button type="submit" className="btn btn-primary" disabled={busy || !accepted}>
        {busy ? "Sending your request…" : "Request this table"}
      </button>
    </form>
  );
}
