"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { formatPoisa } from "@/lib/money";
import { cartOrderPayload, cartSubtotalPoisa, clearCart } from "@/lib/cart";
import { submitOrder } from "@/lib/order-submit";
import { useCartLines } from "@/components/site/use-cart";
import { useSeat } from "@/components/site/use-seat";

type Channel = "DINE_IN" | "TAKEAWAY" | "DELIVERY";

const PHONE = /^(\+?880|880|0)?1[3-9]\d{8}$/;

/**
 * Places the order. The guest chooses a channel and their contact details; the
 * items are sent as ids and quantities and the server answers with the order it
 * actually built, including its own totals.
 */
export function CheckoutForm({
  allowTakeaway,
  allowDelivery,
  deliveryFeePoisa,
  currencySymbol,
}: {
  allowTakeaway: boolean;
  allowDelivery: boolean;
  deliveryFeePoisa: number;
  currencySymbol: string;
}) {
  const lines = useCartLines();
  const seat = useSeat();
  const router = useRouter();

  const channels = useMemo<Channel[]>(() => {
    const list: Channel[] = [];
    if (seat) list.push("DINE_IN");
    if (allowTakeaway) list.push("TAKEAWAY");
    if (allowDelivery) list.push("DELIVERY");
    return list;
  }, [seat, allowTakeaway, allowDelivery]);

  const [channel, setChannel] = useState<Channel>(channels[0] ?? "TAKEAWAY");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One key per checkout screen, made at the first send: a double tap or a retry
  // after a dropped connection returns the order already made instead of a second.
  const idempotencyKey = useRef<string | null>(null);

  const subtotal = cartSubtotalPoisa(lines);

  async function placeOrder() {
    if (lines.length === 0) {
      setError("Your order is empty.");
      return;
    }
    if (idempotencyKey.current === null) idempotencyKey.current = crypto.randomUUID();
    // Only [\s()-] go here; the '+' must reach the server, whose validator folds
    // '+88017…' onto the same trunk form as '017…'. Stripping it client-side would
    // leave a 12-digit string that matches nothing.
    const cleanPhone = phone.replace(/[\s()-]/g, "");
    if (channel !== "DINE_IN") {
      if (name.trim().length < 2) return setError("Please enter a name for the order.");
      if (!PHONE.test(cleanPhone)) return setError("Enter a Bangladeshi mobile number, e.g. 01712345678.");
      if (channel === "DELIVERY" && address.trim().length < 6) return setError("Please give the delivery address.");
    }

    setBusy(true);
    setError(null);
    const payload = {
      ...cartOrderPayload(lines),
      type: channel,
      ...(channel === "DINE_IN" && seat ? { tableToken: seat.tableToken, participantToken: seat.participantToken } : {}),
      ...(channel === "DINE_IN" ? {} : { contact: { name: name.trim(), phone: cleanPhone, ...(channel === "DELIVERY" ? { address: address.trim() } : {}) } }),
      ...(notes.trim() ? { specialInstructions: notes.trim() } : {}),
      idempotencyKey: idempotencyKey.current ?? crypto.randomUUID(),
    };

    const response = await submitOrder(payload);

    setBusy(false);

    if (!response.ok) {
      setError(response.error.message);
      return;
    }

    clearCart();
    idempotencyKey.current = null;
    if (channel === "DINE_IN") {
      router.push("/order");
    } else {
      router.push(`/track/${encodeURIComponent(response.data.order.publicToken)}`);
    }
  }

  if (channels.length === 0) {
    return (
      <p className="notice notice-error">
        No order channel is open right now. Dine-in needs a table code, and takeaway or delivery have been switched off
        by the restaurant — please call us or order at the counter.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <fieldset className="card p-4">
        <legend className="label">How would you like it?</legend>
        <div className="mt-2 space-y-2">
          {channels.includes("DINE_IN") ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="channel" checked={channel === "DINE_IN"} onChange={() => setChannel("DINE_IN")} />
              Dine in at table <strong>{seat?.tableLabel}</strong>
            </label>
          ) : null}
          {channels.includes("TAKEAWAY") ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="channel" checked={channel === "TAKEAWAY"} onChange={() => setChannel("TAKEAWAY")} />
              Takeaway — collect from the counter
            </label>
          ) : null}
          {channels.includes("DELIVERY") ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="channel" checked={channel === "DELIVERY"} onChange={() => setChannel("DELIVERY")} />
              Delivery
              <span className="muted">
                (charge {formatPoisa(deliveryFeePoisa, { symbol: currencySymbol })}, added to the bill)
              </span>
            </label>
          ) : null}
        </div>
        {!channels.includes("DINE_IN") ? (
          <p className="hint mt-3">
            At a table in the restaurant?{" "}
            <Link href="/order" className="underline">
              Enter the code under the QR sticker
            </Link>{" "}
            and your dishes will be sent to that table.
          </p>
        ) : null}
      </fieldset>

      {channel !== "DINE_IN" ? (
        <div className="card grid gap-4 p-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ck-name">
              Name
            </label>
            <input id="ck-name" className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div>
            <label className="label" htmlFor="ck-phone">
              Mobile number
            </label>
            <input id="ck-phone" className="input mt-1" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01712345678" maxLength={20} />
          </div>
          {channel === "DELIVERY" ? (
            <div className="sm:col-span-2">
              <label className="label" htmlFor="ck-address">
                Delivery address
              </label>
              <textarea id="ck-address" className="textarea mt-1" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="card p-4">
        <label className="label" htmlFor="ck-notes">
          Anything for the kitchen? (optional)
        </label>
        <textarea id="ck-notes" className="textarea mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
      </div>

      <div className="card p-4">
        <p className="text-sm">
          Food subtotal: <span className="price">{formatPoisa(subtotal, { symbol: currencySymbol })}</span>
        </p>
        <p className="hint mt-1">
          The restaurant adds its service charge, VAT and any delivery fee to that figure when it takes the order, and
          the order confirmation shows exactly what was added.
        </p>
      </div>

      {error ? <p className="notice notice-error">{error}</p> : null}

      <button type="button" className="btn btn-primary" onClick={placeOrder} disabled={busy || lines.length === 0}>
        {busy ? "Sending to the restaurant…" : channel === "DINE_IN" ? "Send this order to the table" : "Place the order"}
      </button>
    </div>
  );
}
