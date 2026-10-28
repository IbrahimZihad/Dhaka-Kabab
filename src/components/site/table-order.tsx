"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { formatPoisa } from "@/lib/money";
import { cartItemCount, cartOrderPayload, cartSubtotalPoisa, clearCart } from "@/lib/cart";
import { orderStatusLabel, submitOrder, type PlacedOrder } from "@/lib/order-submit";
import { formatTimeInZone } from "@/lib/time";
import { setSeat, clearSeat, type TableSeat } from "@/lib/table-seat";
import { useSeat, useSeatHydrated } from "@/components/site/use-seat";
import { useCartLines } from "@/components/site/use-cart";

type SessionView = {
  session: {
    id: string;
    code: string;
    table: string;
    openedAt: string;
    billRequestedAt: string | null;
    guestCount: number;
    status: string;
    yourDevice: string | null;
  };
  orders: PlacedOrder[];
  bill: {
    number: string;
    status: string;
    total: string;
    paid: string;
    outstanding: string;
    outstandingPoisa: number;
    payableOnline: boolean;
  } | null;
  currencySymbol: string;
  /** The restaurant's zone, so the visit times match what staff see on the board. */
  timeZone: string;
};

type Handoff = {
  actionUrl: string;
  httpMethod: string;
  form: Record<string, string>;
  notice?: string | null;
  isDemo: boolean;
  providerLabel: string;
  amountPoisa: number;
};

const POLL_MS = 8_000;

/**
 * The table's own screen: what a guest sees after scanning the QR sticker. It
 * holds no authority over money or status — it reads the session the restaurant
 * keeps and asks the server to act.
 */
export function TableOrder({ symbol }: { symbol: string }) {
  const seat = useSeat();
  const lines = useCartLines();
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");

  const refresh = useCallback(
    async (token: string) => {
      const response = await apiFetch<SessionView>(
        `/api/sessions/guest?participantToken=${encodeURIComponent(token)}`,
      );
      if (response.ok) {
        setView(response.data);
        setError(null);
      } else {
        setError(response.error.message);
      }
    },
    [],
  );

  /** Seating this device at a table. Stable, so the arrival effect can name it as a dependency. */
  const join = useCallback(async (tableToken: string, existing?: TableSeat | null) => {
    setBusy(true);
    setError(null);
    const sameTable = existing && existing.tableToken === tableToken;
    const response = await apiFetch<TableSeat & { wasAutoOpened: boolean }>("/api/tables/join", {
      method: "POST",
      body: { tableToken, ...(sameTable ? { participantToken: existing.participantToken } : {}) },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setSeat({
      tableToken: response.data.tableToken,
      participantToken: response.data.participantToken,
      tableLabel: response.data.tableLabel,
      sessionCode: response.data.sessionCode,
    });
    setNotice(
      response.data.wasAutoOpened
        ? `Welcome — table ${response.data.tableLabel} is now open for your visit.`
        : `You are ordering with table ${response.data.tableLabel}.`,
    );
  }, []);

  // A QR link is the entry point: seat this device at the table it names, once.
  // Waiting for the store's own "storage has been read" signal is what stops a
  // reload of the same link from taking a second seat and orphaning the guest's
  // first one. The latch is set when the join fires, not when it is scheduled, so
  // a component remount during development simply re-arms the same one attempt.
  const seatHydrated = useSeatHydrated();
  const joinStarted = useRef(false);
  useEffect(() => {
    if (!seatHydrated || joinStarted.current) return;
    const token = new URL(window.location.href).searchParams.get("table");
    if (!token) return;
    if (seat && seat.tableToken === token) return;
    const start = window.setTimeout(() => {
      if (joinStarted.current) return;
      joinStarted.current = true;
      void join(token, seat);
    }, 0);
    return () => window.clearTimeout(start);
  }, [seatHydrated, seat, join]);

  useEffect(() => {
    if (!seat) return;
    // One timer path for the first read and for the refreshes: queueing the opening
    // poll a tick later keeps its state write out of the mount render, and the
    // screen still fills immediately.
    const start = window.setTimeout(() => void refresh(seat.participantToken), 0);
    const timer = window.setInterval(() => void refresh(seat.participantToken), POLL_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [seat, refresh]);

  // One key per screen, made when the guest first sends: a double tap or a retry
  // after a dropped connection returns the order that already exists.
  const idempotencyKey = useRef<string | null>(null);

  async function sendOrder() {
    if (!seat || lines.length === 0) return;
    if (idempotencyKey.current === null) idempotencyKey.current = crypto.randomUUID();
    setBusy(true);
    setError(null);
    const response = await submitOrder({
      ...cartOrderPayload(lines),
      type: "DINE_IN",
      tableToken: seat.tableToken,
      participantToken: seat.participantToken,
      idempotencyKey: idempotencyKey.current,
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    clearCart();
    idempotencyKey.current = null;
    setNotice(response.data.message);
    void refresh(seat.participantToken);
  }

  async function requestBill() {
    if (!seat) return;
    setBusy(true);
    setError(null);
    const response = await apiFetch<{ message: string }>("/api/sessions/request-bill", {
      method: "POST",
      body: { participantToken: seat.participantToken },
    });
    setBusy(false);
    if (!response.ok) setError(response.error.message);
    else setNotice(response.data.message);
    void refresh(seat.participantToken);
  }

  if (!seat) {
    return (
      <div className="space-y-5">
        <div className="card p-5">
          <h2 className="text-lg font-bold">Scan the code on your table</h2>
          <p className="mt-2 text-sm soft">
            Point your camera at the QR sticker. If it will not load, type the code printed under it — it is something
            like <span className="font-mono">T3</span>&apos;s long link, not the table number on its own.
          </p>
          <form
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const raw = code.trim();
              if (!raw) return;
              const token = raw.includes("table=") ? new URL(raw, window.location.origin).searchParams.get("table") ?? raw : raw;
              void join(token, seat);
            }}
          >
            <input
              className="input flex-1"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Table code or the full link"
              aria-label="Table code"
            />
            <button type="submit" className="btn btn-primary" disabled={busy || code.trim() === ""}>
              {busy ? "Joining…" : "Join table"}
            </button>
          </form>
          {error ? <p className="notice notice-error mt-3">{error}</p> : null}
        </div>
        <p className="hint">
          Not dining in? <Link href="/menu" className="underline">Order takeaway</Link> from the menu instead.
        </p>
      </div>
    );
  }

  const cartCount = cartItemCount(lines);
  const openOrders = (view?.orders ?? []).filter((order) => !["COMPLETED", "CANCELLED"].includes(order.status));

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Table {view?.session.table ?? seat.tableLabel}</h2>
            <p className="hint mt-1">
              Visit {view?.session.code ?? seat.sessionCode}
              {view ? ` · ${view.session.guestCount} guest${view.session.guestCount === 1 ? "" : "s"}` : ""}
              {view ? ` · opened ${formatTimeInZone(new Date(view.session.openedAt), view.timeZone)}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/menu" className="btn btn-outline btn-sm">
              Menu
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                clearSeat();
                setView(null);
                setNotice(null);
              }}
            >
              Leave this table
            </button>
          </div>
        </div>
      </div>

      {notice ? <p className="notice notice-ok">{notice}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}

      {lines.length > 0 ? (
        <div className="card p-5">
          <h3 className="text-base font-bold">Your dishes, not yet sent</h3>
          <ul className="mt-2 text-sm soft">
            {lines.map((line) => (
              <li key={line.key}>
                {line.quantity}× {line.name}
                {line.options.length ? ` (${line.options.map((o) => o.name).join(", ")})` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            Subtotal <span className="price">{formatPoisa(cartSubtotalPoisa(lines), { symbol })}</span>
          </p>
          <button type="button" className="btn btn-primary mt-3" onClick={sendOrder} disabled={busy}>
            {busy ? "Sending…" : `Send ${cartCount} dish${cartCount === 1 ? "" : "es"} to the kitchen`}
          </button>
          <p className="hint mt-2">
            Sending adds these to the table&apos;s bill at the restaurant&apos;s own prices. If a price or availability
            changed since you looked, the order is refused and nothing is charged.
          </p>
        </div>
      ) : (
        <p className="notice">
          Nothing in your list right now. <Link href="/menu" className="underline">Open the menu</Link> and add dishes —
          they will appear here ready to send.
        </p>
      )}

      <div className="card p-5">
        <h3 className="text-base font-bold">Orders at this table</h3>
        {view === null ? (
          <div className="mt-3 space-y-2">
            {[0, 1].map((index) => (
              <span key={index} className="skeleton block h-20" />
            ))}
          </div>
        ) : view.orders.length === 0 ? (
          <p className="mt-2 text-sm soft">Nothing has been sent for this visit yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {view.orders.map((order) => (
              <li key={order.id} className="rounded-lg border border-line p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold">{order.orderNumber}</p>
                  <span className={`badge ${order.status === "CANCELLED" ? "badge-closed" : "badge-open"}`}>
                    {orderStatusLabel(order.status)}
                  </span>
                </div>
                <ul className="mt-2 text-sm soft">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3">
                      <span>
                        {item.quantity}× {item.name}
                        {item.options.length ? <span className="hint block">{item.options.join(", ")}</span> : null}
                        {item.instructions ? <span className="hint block italic">“{item.instructions}”</span> : null}
                      </span>
                      <span className="price shrink-0">{item.lineTotal}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2 text-sm">
                  <span className="hint">
                    {order.totals.subtotal} food · service {order.totals.serviceCharge} · VAT {order.totals.vat}
                  </span>
                  <span className="price">{order.totals.total}</span>
                </div>
                {order.timeline.length > 0 ? (
                  <p className="hint mt-2">
                    {order.timeline.map((event) => `${orderStatusLabel(event.status)} ${formatTimeInZone(new Date(event.at), order.timeZone)}`).join(" → ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <h3 className="text-base font-bold">The bill</h3>
        {view?.bill ? (
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="label">Bill</dt>
              <dd>{view.bill.number}</dd>
            </div>
            <div>
              <dt className="label">Status</dt>
              <dd>{view.bill.status.toLowerCase()}</dd>
            </div>
            <div>
              <dt className="label">Total</dt>
              <dd className="price">{view.bill.total}</dd>
            </div>
            <div>
              <dt className="label">Outstanding</dt>
              <dd className="price">{view.bill.outstanding}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm soft">
            No bill has been drawn up for this visit yet. Charges are added by the restaurant when staff finalise it.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn btn-outline"
            onClick={requestBill}
            disabled={busy || openOrders.length === 0 || view?.session.billRequestedAt != null}
          >
            {view?.session.billRequestedAt ? "Bill requested" : "Ask for the bill"}
          </button>
          {view?.bill && view.bill.outstandingPoisa > 0 ? (
            <GuestPayLink
              participantToken={seat.participantToken}
              outstandingPoisa={view.bill.outstandingPoisa}
              symbol={symbol}
              payableOnline={view.bill.payableOnline}
            />
          ) : null}
        </div>
        {openOrders.length > 0 ? (
          <p className="hint mt-2">
            The kitchen is still working on {openOrders.length} order{openOrders.length === 1 ? "" : "s"}. Staff usually
            bring the bill once everything is served.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Online payment from the table. It asks the server to hand off to the gateway
 * and then goes where the gateway says; the return trip is not what marks the
 * bill paid — the gateway&apos;s own notification is.
 */
function GuestPayLink({
  participantToken,
  outstandingPoisa,
  symbol,
  payableOnline,
}: {
  participantToken: string;
  outstandingPoisa: number;
  symbol: string;
  payableOnline: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);

  // A refusal is about the bill as it stood at that moment. The card above keeps
  // polling, so when staff finalise the bill while the guest is still reading
  // "not finalized yet", the sentence would contradict the status line beneath it.
  // Reset during render on the flip only — the React pattern for a prop the state
  // was derived from — so a refusal raised *after* the bill became payable, too
  // many attempts say, stays on screen.
  const [wasPayable, setWasPayable] = useState(payableOnline);
  if (wasPayable !== payableOnline) {
    setWasPayable(payableOnline);
    setError(null);
  }

  async function pay() {
    setBusy(true);
    setError(null);
    const response = await apiFetch<Handoff>("/api/payments/guest/initiate", {
      method: "POST",
      body: { participantToken, customer: { name: name.trim(), email: email.trim(), phone: phone.trim() } },
    });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setHandoff(response.data);
    const data = response.data;
    if (data.httpMethod.toUpperCase() === "POST") {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.actionUrl;
      for (const [key, value] of Object.entries(data.form)) {
        const field = document.createElement("input");
        field.type = "hidden";
        field.name = key;
        field.value = value;
        form.appendChild(field);
      }
      document.body.appendChild(form);
      form.submit();
      return;
    }
    window.location.assign(data.actionUrl);
  }

  if (handoff) {
    return (
      <p className="notice mt-3">
        {handoff.notice ?? `Redirecting to ${handoff.providerLabel}…`} The bill stays unpaid until the bank tells us
        otherwise.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Pay {formatPoisa(outstandingPoisa, { symbol })} online
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-line p-4">
      <p className="text-sm font-semibold">Pay {formatPoisa(outstandingPoisa, { symbol })} from your phone</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <input className="input" placeholder="Mobile number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
        <input className="input sm:col-span-2" placeholder="Email for the receipt" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
      </div>
      {error ? <p className="notice notice-error mt-3">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={pay} disabled={busy}>
          {busy ? "Starting payment…" : "Continue to the bank"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
      <p className="hint mt-2">
        This pays the whole outstanding amount. Partial payments are settled at the counter with staff, who record them
        against the bill.
      </p>
    </div>
  );
}
