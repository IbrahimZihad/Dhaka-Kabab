"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { PAYMENT_METHOD_LABELS, PAYMENT_RECORD_LABELS } from "@/lib/staff-format";
import { formatPoisa } from "@/lib/money";

type ReceiptLine = {
  description: string;
  orderNumber: string | null;
  quantity: number;
  unitPricePoisa: number;
  lineTotalPoisa: number;
  options: { optionName?: string; groupName?: string }[];
};

type ReceiptPayment = {
  reference: string;
  method: keyof typeof PAYMENT_METHOD_LABELS;
  status: keyof typeof PAYMENT_RECORD_LABELS;
  amountPoisa: number;
  verifiedAt: string | null;
  provider: string;
  gatewayTxnId: string | null;
  isDemo: boolean;
};

type ReceiptRefund = {
  number: string;
  amountPoisa: number;
  reason: string;
  status: string;
  processedAt: string | null;
};

type Receipt = {
  number: string;
  status: string;
  issuedAt: string;
  table: string | null;
  sessionCode: string | null;
  orders: string[];
  customer: string | null;
  items: ReceiptLine[];
  subtotalPoisa: number;
  discountPoisa: number;
  serviceChargePoisa: number;
  vatPoisa: number;
  roundingAdjustmentPoisa: number;
  totalPoisa: number;
  paidPoisa: number;
  refundedPoisa: number;
  outstandingPoisa: number;
  overpaidPoisa: number;
  currencySymbol: string;
  currencyCode: string;
  isDemo: boolean;
  payments: ReceiptPayment[];
  refunds: ReceiptRefund[];
  chargeBasis: { serviceChargeBps?: number; vatBps?: number };
  restaurant: {
    name: string;
    header: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    phone: string | null;
    footer: string | null;
    timezone: string;
  };
  money: Record<
    "subtotal" | "discount" | "serviceCharge" | "vat" | "rounding" | "total" | "paid" | "refunded" | "outstanding" | "overpaid",
    string
  >;
};

/**
 * Asks `GET /api/bills/{id}/receipt` for the receipt the system holds.
 *
 * What that route actually returns is the bill's stored figures — re-read from
 * the line copies and the charge snapshot taken when the bill was finalized — as
 * JSON. It is a courtesy print for the guest. It is not a fiscal document: it is
 * not issued, signed or registered with the tax authority, and there is no PDF
 * behind this button.
 */
export function BillReceipt({ billId, timeZone }: { billId: string; timeZone: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    const response = await apiFetch<Receipt>(`/api/bills/${billId}/receipt`, { method: "GET" });
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setReceipt(response.data);
  }

  if (error) return <p className="notice notice-error">{error}</p>;

  if (!receipt) {
    return (
      <div className="no-print flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-outline" onClick={load} disabled={busy}>
          {busy ? "Fetching…" : "Receipt"}
        </button>
        <span className="hint">
          Reads the figures stored with this bill. A courtesy copy for the guest — not a fiscal document, and not a PDF.
        </span>
      </div>
    );
  }

  const symbol = receipt.currencySymbol;
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: receipt.restaurant.timezone || timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(receipt.issuedAt));

  const moneyRows: { label: string; value: string; strong?: boolean }[] = [
    { label: "Subtotal", value: receipt.money.subtotal },
    ...(receipt.discountPoisa > 0 ? [{ label: "Discount", value: `−${receipt.money.discount}` }] : []),
    { label: "Service charge", value: receipt.money.serviceCharge },
    { label: "VAT", value: receipt.money.vat },
    ...(receipt.roundingAdjustmentPoisa !== 0 ? [{ label: "Rounding", value: receipt.money.rounding }] : []),
    { label: "Total", value: receipt.money.total, strong: true },
    { label: "Received", value: receipt.money.paid },
    ...(receipt.refundedPoisa > 0 ? [{ label: "Refunded", value: receipt.money.refunded }] : []),
    { label: "Outstanding", value: receipt.money.outstanding, strong: true },
    ...(receipt.overpaidPoisa > 0 ? [{ label: "Owed back to the guest", value: receipt.money.overpaid }] : []),
  ];

  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => window.print()}>
          Print
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => downloadText(receiptToText(receipt, when))}
        >
          Download a text copy
        </button>
        <span className="hint">
          Straight from the receipt route: the stored line copies and the charge snapshot in force when this bill was
          finalized. Courtesy copy, not a fiscal document.
        </span>
      </div>

      <article className="card p-5 font-mono text-xs sm:text-sm">
        <header className="text-center">
          <p className="text-base font-bold">{receipt.restaurant.header || receipt.restaurant.name}</p>
          <p className="muted">
            {[receipt.restaurant.addressLine1, receipt.restaurant.addressLine2, receipt.restaurant.city]
              .filter(Boolean)
              .join(", ") || "address not recorded yet"}
          </p>
          {receipt.restaurant.phone ? <p className="muted">{receipt.restaurant.phone}</p> : null}
        </header>

        <div className="mt-4 border-t border-line pt-3">
          <p>
            Bill {receipt.number} · {receipt.status}
          </p>
          <p className="muted">
            {receipt.table ? `Table ${receipt.table}` : "Counter"}
            {receipt.sessionCode ? ` · session ${receipt.sessionCode}` : ""} · issued {when}
          </p>
          {receipt.orders.length > 0 ? <p className="muted">Orders: {receipt.orders.join(", ")}</p> : null}
          {receipt.customer ? <p className="muted">Payer: {receipt.customer}</p> : null}
        </div>

        <table className="mt-4 w-full text-left">
          <thead>
            <tr className="border-b border-line">
              <th className="label py-1">Item</th>
              <th className="label py-1 text-right">Qty</th>
              <th className="label py-1 text-right">Price</th>
              <th className="label py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item, index) => {
              const note = item.options
                .map((option) => option.optionName ?? option.groupName ?? "")
                .filter(Boolean)
                .join(", ");
              return (
                <tr key={`${item.description}-${index}`} className="border-b border-line align-top">
                  <td className="py-1 pr-2">
                    {item.description}
                    {note ? <p className="muted">{note}</p> : null}
                    {item.orderNumber ? <p className="muted">{item.orderNumber}</p> : null}
                  </td>
                  <td className="py-1 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-1 text-right tabular-nums">{formatPoisa(item.unitPricePoisa, { symbol })}</td>
                  <td className="py-1 text-right tabular-nums">{formatPoisa(item.lineTotalPoisa, { symbol })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <dl className="mt-4 ml-auto max-w-xs space-y-1">
          {moneyRows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className={row.strong ? "font-bold" : "muted"}>{row.label}</dt>
              <dd className={row.strong ? "price" : "tabular-nums"}>{row.value}</dd>
            </div>
          ))}
        </dl>

        {receipt.payments.length > 0 ? (
          <div className="mt-4 border-t border-line pt-3">
            <p className="label">Payments</p>
            <ul className="mt-1 space-y-1">
              {receipt.payments.map((payment) => (
                <li key={payment.reference} className="flex flex-wrap justify-between gap-3">
                  <span>
                    {PAYMENT_METHOD_LABELS[payment.method]} · {payment.reference}
                    {payment.isDemo ? " · simulated" : ""}
                  </span>
                  <span className="tabular-nums">
                    {formatPoisa(payment.amountPoisa, { symbol })} — {PAYMENT_RECORD_LABELS[payment.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {receipt.refunds.length > 0 ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="label">Refunds</p>
            <ul className="mt-1 space-y-1">
              {receipt.refunds.map((refund) => (
                <li key={refund.number} className="flex flex-wrap justify-between gap-3">
                  <span>
                    {refund.number} · {refund.reason}
                  </span>
                  <span className="tabular-nums">
                    {formatPoisa(refund.amountPoisa, { symbol })} — {refund.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <footer className="mt-4 border-t border-line pt-3 text-center">
          {receipt.isDemo || receipt.payments.some((payment) => payment.isDemo) ? (
            <p className="badge badge-closed">Simulated money — not takings</p>
          ) : null}
          <p className="muted mt-2">
            {receipt.restaurant.footer || "Thank you."} · Charges in force at issue:{" "}
            {receipt.chargeBasis.serviceChargeBps ? `${(receipt.chargeBasis.serviceChargeBps / 100).toFixed(2)}% service` : "no service charge"}
            {receipt.chargeBasis.vatBps ? `, ${(receipt.chargeBasis.vatBps / 100).toFixed(2)}% VAT` : ""}. Courtesy copy —
            not a fiscal document.
          </p>
        </footer>
      </article>
    </div>
  );
}

function receiptToText(receipt: Receipt, when: string): string {
  const symbol = receipt.currencySymbol;
  const lines = [
    receipt.restaurant.header || receipt.restaurant.name,
    [receipt.restaurant.addressLine1, receipt.restaurant.city].filter(Boolean).join(", "),
    receipt.restaurant.phone ?? "",
    "",
    `Bill ${receipt.number} (${receipt.status}) — issued ${when}`,
    receipt.table ? `Table ${receipt.table}` : "Counter",
    "",
    ...receipt.items.map(
      (item) =>
        `${item.quantity} × ${item.description} — ${formatPoisa(item.lineTotalPoisa, { symbol })} (${formatPoisa(
          item.unitPricePoisa,
          { symbol },
        )} each)`,
    ),
    "",
    `Subtotal        ${receipt.money.subtotal}`,
    `Service charge  ${receipt.money.serviceCharge}`,
    `VAT             ${receipt.money.vat}`,
    `Total           ${receipt.money.total}`,
    `Received        ${receipt.money.paid}`,
    `Outstanding     ${receipt.money.outstanding}`,
    "",
    ...receipt.payments.map(
      (payment) =>
        `${PAYMENT_METHOD_LABELS[payment.method]} ${payment.reference}: ${formatPoisa(payment.amountPoisa, {
          symbol,
        })} — ${PAYMENT_RECORD_LABELS[payment.status]}${payment.isDemo ? " (simulated)" : ""}`,
    ),
    "",
    "Courtesy copy of the figures held by the restaurant. Not a fiscal document.",
    receipt.restaurant.footer ?? "",
  ];
  return lines.filter((line) => line !== undefined).join("\n");
}

function downloadText(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "receipt.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}
