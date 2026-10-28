"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PaymentMethod } from "@prisma/client";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { PAYMENT_METHOD_LABELS } from "@/lib/staff-format";
import { formatPoisa, parseMoneyInput, poisaToInputValue } from "@/lib/money";

/**
 * Counter payment — cash, card or mobile banking handed over at the till.
 *
 * The cashier types Taka. The field is sent verbatim as `amountPoisa`, and the
 * server's `pricePoisa` transform converts it to integer poisa, so "460" here is
 * ৳ 460 and nothing on this screen multiplies the figure again. The button spells
 * out the taka amount that is about to leave the browser, so a mistyped amount is
 * visible before it is sent.
 */
export function BillPaymentForm({
  billId,
  outstandingInputValue,
  outstandingLabel,
  currencySymbol,
}: {
  billId: string;
  /** Taka as text, e.g. "460.00" — from poisaToInputValue on the server. */
  outstandingInputValue: string;
  outstandingLabel: string;
  currencySymbol: string;
}) {
  const router = useRouter();
  const action = useAdminAction();
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [amount, setAmount] = useState(outstandingInputValue);
  const [reference, setReference] = useState("");

  // Both sides of the comparison are converted the same way the server will
  // convert them, so the warning agrees with the check the API performs.
  const typedPoisa = parseMoneyInput(amount);
  const outstandingPoisa = parseMoneyInput(outstandingInputValue) ?? 0;
  const exceedsOutstanding = typedPoisa !== null && typedPoisa > outstandingPoisa;
  const amountLabel = typedPoisa === null ? null : formatPoisa(typedPoisa, { symbol: currencySymbol });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = amount.trim();
    const response = await action.run<PaymentRecordResponse>("POST", "/api/payments", {
      billId,
      method,
      // The Taka text, unchanged. The server turns it into poisa.
      amountPoisa: trimmed,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    });
    if (!response) return;
    setAmount(poisaToInputValue(response.outstandingPoisa));
    setReference("");
    action.setNotice(
      `${formatPoisa(parseMoneyInput(trimmed) ?? 0, { symbol: currencySymbol })} recorded as ${
        PAYMENT_METHOD_LABELS[method]
      }. ${
        response.outstandingPoisa > 0
          ? `${formatPoisa(response.outstandingPoisa, { symbol: currencySymbol })} still outstanding on ${response.billNumber}.`
          : `${response.billNumber} is settled.`
      }`,
    );
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="no-print space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="payment-method">
            Method
          </label>
          <select id="payment-method" className="select" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
            {COUNTER_METHODS.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="payment-amount">
            Amount taken ({currencySymbol} Taka)
          </label>
          <input
            id="payment-amount"
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={exceedsOutstanding}
          />
          <p className="hint mt-1">
            Prefilled with the outstanding {outstandingLabel}.{" "}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAmount(outstandingInputValue)}>
              Use the full outstanding
            </button>
          </p>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="payment-reference">
          Reference (optional)
        </label>
        <input
          id="payment-reference"
          className="input"
          autoComplete="off"
          placeholder="Card slip, bKash or Nagad transaction id"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </div>

      {exceedsOutstanding ? (
        <p className="notice notice-error">
          {amountLabel} is more than the outstanding {outstandingLabel}. The counter will refuse it — take the exact
          amount owed, or record the payment the guest actually handed over and let the rest stand.
        </p>
      ) : null}

      {action.error ? <p className="notice notice-error">{action.error}</p> : null}
      {action.notice ? <p className="notice notice-ok">{action.notice}</p> : null}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={action.busy || typedPoisa === null || typedPoisa <= 0}
      >
        {action.busy
          ? "Recording…"
          : typedPoisa === null || typedPoisa <= 0
            ? "Record payment"
            : `Record payment of ${amountLabel}`}
      </button>
      <p className="hint">
        Nothing is counted as received until this request comes back accepted. Online payments are not recorded here —
        they are confirmed by the bank.
      </p>
    </form>
  );
}

type PaymentRecordResponse = {
  payment: { id: string; status: string; reference: string };
  settled: boolean;
  outstandingPoisa: number;
  billNumber: string;
};

/** ONLINE_GATEWAY is refused at the counter: only a verified callback can settle it. */
const COUNTER_METHODS = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).filter(
  (method) => method !== "ONLINE_GATEWAY",
);
