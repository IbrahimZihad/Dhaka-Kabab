"use client";

import { useState } from "react";
import Link from "next/link";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { ReservationSlotPicker } from "@/components/admin/reservation-slot-picker";

const PHONE = /^(\+?880|880|0)?1[3-9]\d{8}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Created = { code: string; status: string; message: string };

/**
 * A staff booking, sent through the very same endpoint the guests use, so the
 * availability rules cannot drift between the two doors. Slots come from the
 * server; if it refuses the booking (an overlap, a closed time) the refusal is
 * shown verbatim and the slot list is refreshed — the form stays usable.
 */
export function ReservationCreateForm({
  todayKey,
  maxDaysAhead,
  durationMinutes,
}: {
  todayKey: string;
  maxDaysAhead: number;
  durationMinutes: number;
}) {
  const [partySize, setPartySize] = useState(2);
  const [dateKey, setDateKey] = useState(todayKey);
  const [time, setTime] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [requests, setRequests] = useState("");
  const [accepted, setAccepted] = useState(false);

  const [created, setCreated] = useState<Created | null>(null);
  /** Bumping this remounts the slot grid so the server re-proves it after a refusal. */
  const [slotsKey, setSlotsKey] = useState(0);
  const { busy, error, run } = useAdminAction();

  const max = new Date(`${todayKey}T12:00:00Z`);
  max.setUTCDate(max.getUTCDate() + maxDaysAhead);
  const maxDate = max.toISOString().slice(0, 10);

  function resetField(next: () => void) {
    next();
    setTime(null);
    setCreated(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!time) return;
    const cleanPhone = phone.replace(/[\s()-]/g, "");
    if (name.trim().length < 2) return;
    if (!PHONE.test(cleanPhone)) return;
    if (email.trim() && !EMAIL.test(email.trim())) return;

    const result = await run<Created>("POST", "/api/reservations", {
      customerName: name.trim(),
      phone: cleanPhone,
      email: email.trim() || undefined,
      dateKey,
      time,
      partySize,
      ...(requests.trim() ? { specialRequests: requests.trim() } : {}),
      policyAccepted: accepted,
    });
    if (!result) {
      // The server refused (an overlap, a closed time, a rule broken). Its
      // message is shown verbatim above; redraw the grid from the server so
      // the staff member sees what is genuinely left.
      setTime(null);
      setSlotsKey((key) => key + 1);
      return;
    }
    setCreated(result);
    setName("");
    setPhone("");
    setEmail("");
    setRequests("");
    setAccepted(false);
    setTime(null);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="res-create-party">
            Guests
          </label>
          <input
            id="res-create-party"
            className="input mt-1"
            type="number"
            min={1}
            max={60}
            inputMode="numeric"
            value={partySize}
            onChange={(event) => resetField(() => setPartySize(Math.max(1, Math.min(60, Number(event.target.value) || 1))))}
          />
          <p className="hint mt-1">Between 1 and 60 guests.</p>
        </div>
        <div>
          <label className="label" htmlFor="res-create-date">
            Which day?
          </label>
          <input
            id="res-create-date"
            className="input mt-1"
            type="date"
            value={dateKey}
            min={todayKey}
            max={maxDate}
            onChange={(event) => resetField(() => setDateKey(event.target.value))}
          />
          <p className="hint mt-1">
            Bookings open up to {maxDaysAhead} days ahead; times are the restaurant&apos;s own clock.
          </p>
        </div>
      </div>

      <div className="rounded-md border border-line p-3">
        <ReservationSlotPicker
          key={slotsKey}
          idPrefix="create"
          dateKey={dateKey}
          partySize={partySize}
          picked={time}
          onPick={setTime}
        />
        <p className="hint mt-2">
          Each sitting holds the table for {durationMinutes} minutes from the chosen time.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="res-create-name">
            Name on the booking
          </label>
          <input
            id="res-create-name"
            className="input mt-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            minLength={2}
          />
        </div>
        <div>
          <label className="label" htmlFor="res-create-phone">
            Mobile number
          </label>
          <input
            id="res-create-phone"
            className="input mt-1"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="01712345678"
            maxLength={20}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="res-create-email">
            Email (optional — for the confirmation)
          </label>
          <input
            id="res-create-email"
            className="input mt-1"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={120}
          />
        </div>
        <div>
          <label className="label" htmlFor="res-create-requests">
            Special requests (optional)
          </label>
          <input
            id="res-create-requests"
            className="input mt-1"
            value={requests}
            onChange={(event) => setRequests(event.target.value)}
            maxLength={400}
            placeholder="High chair, birthday, allergy…"
          />
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-md border border-line p-3 text-sm">
        <input
          id="res-create-policy"
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-1"
          required
        />
        <span>
          The guest has been told this is a request a manager confirms, and accepts the reservation policy. The API
          refuses a booking without this acceptance, whoever takes it.
        </span>
      </label>

      {error ? <p className="notice notice-error">{error}</p> : null}
      {created ? (
        <p className="notice notice-ok">
          Booking {created.code} is recorded ({created.status.toLowerCase()}). {created.message}{" "}
          <Link href={`/admin/reservations?search=${encodeURIComponent(created.code)}`} className="underline">
            Open it in the list
          </Link>
          .
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !time || !accepted}>
        {busy ? "Sending…" : "Take this booking"}
      </button>
      {!time ? <p className="hint ml-2 inline">Choose a free time first.</p> : null}
    </form>
  );
}
