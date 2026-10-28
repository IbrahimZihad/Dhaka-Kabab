"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { TABLE_STATUS_LABELS } from "@/lib/staff-format";

/**
 * Everything on a floor tile that changes state lives here. The board hands this
 * component ids, labels and pre-formatted strings only — never a raw poisa figure
 * and never an authority over money. Each button calls an existing admin endpoint
 * through `useAdminAction`, shows exactly what the server reported, and reloads
 * the server data with `router.refresh()`.
 */

export type FloorTableData = {
  table: {
    id: string;
    label: string;
    number: number;
    capacity: number;
    section: string | null;
    status: string;
    isEnabled: boolean;
    orderUrl: string;
    publicToken: string;
    qrHref: string;
    session: {
      id: string;
      code: string;
      openedAt: string;
      guestCount: number;
      participants: number;
      reservationCode: string | null;
      billId: string | null;
      billNumber: string | null;
      billStatus: string | null;
      billTotal: string | null;
      outstanding: string | null;
    } | null;
  };
  orders: { id: string; orderNumber: string; status: string; items: { name: string; quantity: number }[] }[];
  billRequestedAt: string | null;
};

type Can = { manageTables: boolean; manageSessions: boolean; manageBills: boolean };

const MANUAL_STATUSES = ["AVAILABLE", "CLEANING", "DISABLED"] as const;
const CLOSE_REASONS: { value: string; label: string }[] = [
  { value: "SETTLED", label: "Bill settled" },
  { value: "TRANSFERRED", label: "Party moved to another table" },
  { value: "NO_PAYMENT", label: "Left without paying" },
  { value: "MANUAL", label: "Closed manually" },
];

export function FloorTableActions({
  table,
  can,
  transferTargets,
  reservations,
  billRequestedAt,
}: {
  table: FloorTableData["table"];
  can: Can;
  transferTargets: { id: string; label: string; capacity: number }[];
  reservations: { id: string; code: string; customerName: string; partySize: number }[];
  billRequestedAt: string | null;
}) {
  const router = useRouter();
  const { busy, error, notice, run, setNotice } = useAdminAction();
  const [panel, setPanel] = useState<null | "seat" | "status" | "move" | "close" | "bill" | "qr">(null);

  const [guestCount, setGuestCount] = useState("2");
  const [reservationId, setReservationId] = useState("");
  const [notes, setNotes] = useState("");

  const [status, setStatus] = useState<(typeof MANUAL_STATUSES)[number]>("AVAILABLE");
  const [disableReason, setDisableReason] = useState("");

  const [target, setTarget] = useState("");
  const [moveReason, setMoveReason] = useState("");

  const [closeReason, setCloseReason] = useState("SETTLED");
  const [closeNote, setCloseNote] = useState("");

  function toggle(next: typeof panel) {
    setNotice(null);
    setPanel((current) => (current === next ? null : next));
  }

  function finished(message: string) {
    setNotice(message);
    setPanel(null);
    router.refresh();
  }

  const session = table.session;

  async function seatGuests(event: React.FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {
      tableId: table.id,
      guestCount: Math.min(20, Math.max(1, Number(guestCount) || 1)),
    };
    if (reservationId) body.reservationId = reservationId;
    if (notes.trim()) body.notes = notes.trim();
    const result = await run("POST", "/api/admin/sessions", body);
    if (result) finished(`Table ${table.label} is now open for the party.`);
  }

  async function raiseBill() {
    if (!session) return;
    const result = await run("POST", `/api/admin/sessions/${session.id}/bill`);
    if (result) finished(`The bill for table ${table.label} was drawn up from its orders. Payment is taken on the bills screen.`);
  }

  async function rotateToken() {
    const agreed = window.confirm(
      `Replace table ${table.label}'s ordering code?\n\nThe guests at the table can still order, but every QR sticker already printed for this table will stop working and a new one must be printed.`,
    );
    if (!agreed) return;
    const result = await run("POST", `/api/admin/tables/${table.id}/token`);
    if (result) finished("A new ordering code was issued. Old stickers no longer work — print the new code.");
  }

  async function moveParty(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    const body: Record<string, unknown> = { fromTableId: table.id, toTableId: target };
    if (moveReason.trim()) body.reason = moveReason.trim();
    const result = await run("POST", "/api/admin/sessions/transfer", body);
    if (result) finished(`The party was moved to table ${transferTargets.find((t) => t.id === target)?.label ?? "another table"}.`);
  }

  async function closeSession(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    const body: Record<string, unknown> = { reason: closeReason };
    if (closeNote.trim()) body.note = closeNote.trim();
    const result = await run("POST", `/api/admin/sessions/${session.id}/close`, body);
    if (result) finished(`Table ${table.label} was cleared.`);
  }

  async function submitStatus(event: React.FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = { status };
    if (status === "DISABLED" && disableReason.trim()) body.reason = disableReason.trim();
    const result = await run("PATCH", `/api/admin/tables/${table.id}/status`, body);
    if (result) finished(`Table ${table.label} marked ${TABLE_STATUS_LABELS[status] ?? status}.`);
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      {notice ? <p className="notice notice-ok mb-2">{notice}</p> : null}
      {error ? <p className="notice notice-error mb-2">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {!session && can.manageSessions ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => toggle("seat")}>
            Seat guests
          </button>
        ) : null}
        {session && can.manageBills ? (
          <button
            type="button"
            className={billRequestedAt ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm"}
            disabled={busy}
            onClick={() => toggle("bill")}
          >
            {billRequestedAt ? "Bill requested — take it forward" : session.billNumber ? "Refresh the bill" : "Draw up the bill"}
          </button>
        ) : null}
        {session?.billId ? (
          <Link href={`/admin/bills/${session.billId}`} className="btn btn-ghost btn-sm">
            Open the bill
          </Link>
        ) : null}
        {session && can.manageSessions && transferTargets.length > 0 ? (
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => toggle("move")}>
            Move party
          </button>
        ) : null}
        {session && can.manageSessions ? (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => toggle("close")}>
            Close session
          </button>
        ) : null}
        {!session && can.manageTables ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle("status")}>
            Set table status
          </button>
        ) : null}
        {can.manageTables ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle("qr")}>
            Order link &amp; QR
          </button>
        ) : null}
      </div>

      {panel === "seat" ? (
        <form className="mt-3 space-y-3 rounded-md border border-line p-3" onSubmit={seatGuests}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`${table.id}-guests`}>
                Guests
              </label>
              <input
                id={`${table.id}-guests`}
                className="input"
                type="number"
                min={1}
                max={20}
                inputMode="numeric"
                value={guestCount}
                onChange={(event) => setGuestCount(event.target.value)}
              />
              <p className="hint mt-1">Between 1 and 20 guests. The table seats {table.capacity}.</p>
            </div>
            <div>
              <label className="label" htmlFor={`${table.id}-reservation`}>
                Link a booking (optional)
              </label>
              <select
                id={`${table.id}-reservation`}
                className="select"
                value={reservationId}
                onChange={(event) => setReservationId(event.target.value)}
              >
                <option value="">No booking to link</option>
                {reservations.map((reservation) => (
                  <option key={reservation.id} value={reservation.id}>
                    {reservation.code} — {reservation.customerName} ({reservation.partySize})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor={`${table.id}-notes`}>
              Note for this visit (optional)
            </label>
            <input
              id={`${table.id}-notes`}
              className="input"
              maxLength={200}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="e.g. birthday, window seat"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? "Opening…" : "Open the session"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {panel === "bill" && session ? (
        <div className="mt-3 space-y-2 rounded-md border border-line p-3 text-sm">
          {billRequestedAt ? (
            <p className="notice notice-error">The table has asked for its bill. Take it forward now — nobody pays here.</p>
          ) : null}
          <p className="soft">
            This takes the orders at table {table.label} as they stand and raises or refreshes its open bill. Charges and
            totals are worked out by the restaurant, not entered here. Payments are recorded on the bills screen, not on
            this board.
          </p>
          {session.billId ? (
            <p className="soft">
              <Link href={`/admin/bills/${session.billId}`} className="underline">
                Open bill {session.billNumber} for the money itself
              </Link>
              .
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={raiseBill}>
              {busy ? "Working…" : "Draw up / refresh the bill"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {panel === "move" ? (
        <form className="mt-3 space-y-3 rounded-md border border-line p-3" onSubmit={moveParty}>
          <div>
            <label className="label" htmlFor={`${table.id}-target`}>
              Move to
            </label>
            <select id={`${table.id}-target`} className="select" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Choose a free table…</option>
              {transferTargets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  Table {candidate.label} — seats {candidate.capacity}
                </option>
              ))}
            </select>
            <p className="hint mt-1">
              The party&apos;s orders and any open bill follow them; the old table is left for clearing.
            </p>
          </div>
          <div>
            <label className="label" htmlFor={`${table.id}-move-reason`}>
              Reason (optional)
            </label>
            <input id={`${table.id}-move-reason`} className="input" maxLength={200} value={moveReason} onChange={(event) => setMoveReason(event.target.value)} />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !target}>
              {busy ? "Moving…" : "Move the party"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {panel === "close" && session ? (
        <form className="mt-3 space-y-3 rounded-md border border-line p-3" onSubmit={closeSession}>
          <div>
            <label className="label" htmlFor={`${table.id}-close-reason`}>
              Why is this visit ending?
            </label>
            <select id={`${table.id}-close-reason`} className="select" value={closeReason} onChange={(event) => setCloseReason(event.target.value)}>
              {CLOSE_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`${table.id}-close-note`}>
              Note (optional)
            </label>
            <input id={`${table.id}-close-note`} className="input" maxLength={200} value={closeNote} onChange={(event) => setCloseNote(event.target.value)} />
          </div>
          <p className="hint">
            A session with money still owed can only be closed by a manager or owner — a cashier is asked to settle the
            bill first. The server decides this; nothing here is changed unless it agrees.
          </p>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-danger btn-sm" disabled={busy}>
              {busy ? "Closing…" : "Close the session"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {panel === "status" ? (
        <form className="mt-3 space-y-3 rounded-md border border-line p-3" onSubmit={submitStatus}>
          <div>
            <label className="label" htmlFor={`${table.id}-status`}>
              Floor state
            </label>
            <select
              id={`${table.id}-status`}
              className="select"
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof MANUAL_STATUSES)[number])}
            >
              {MANUAL_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {TABLE_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          {status === "DISABLED" ? (
            <div>
              <label className="label" htmlFor={`${table.id}-disable-reason`}>
                Why is it out of service?
              </label>
              <input id={`${table.id}-disable-reason`} className="input" maxLength={200} value={disableReason} onChange={(event) => setDisableReason(event.target.value)} />
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? "Saving…" : "Save the state"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => toggle(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {panel === "qr" ? (
        <div className="mt-3 space-y-3 rounded-md border border-line p-3 text-sm">
          <p className="soft">The guest&apos;s ordering link for this table, and its code for reprinting the sticker.</p>
          <div>
            <p className="label">Ordering link</p>
            <p className="soft break-all">
              <a href={table.orderUrl} className="underline" target="_blank" rel="noreferrer">
                {table.orderUrl}
              </a>
            </p>
          </div>
          <div>
            <p className="label">Table code</p>
            <p className="font-mono soft">{table.publicToken}</p>
            <p className="hint mt-1">
              Read the link or the code out over the phone and the guest reaches this table&apos;s menu directly.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- this is a server-generated QR PNG, not an optimisable asset */}
            <img src={table.qrHref} alt={`QR code for table ${table.label}`} width={128} height={128} className="rounded border border-line bg-white p-1" />
            <a href={table.qrHref} className="btn btn-outline btn-sm" target="_blank" rel="noreferrer">
              Open the printed QR
            </a>
          </div>
          <p className="hint">Printing the code opens the single-table QR image, ready to cut and stick on the table.</p>
          <div className="border-t border-line pt-2">
            <p className="soft">
              If a sticker has been lost or shared outside the restaurant, a new code can be issued.{" "}
              <strong>Every QR printed with the old code stops working at once.</strong>
            </p>
            <button type="button" className="btn btn-danger btn-sm mt-2" disabled={busy} onClick={rotateToken}>
              {busy ? "Working…" : "Issue a new table code"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
