"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { formatPoisa, parseMoneyInput } from "@/lib/money";

export type RefundablePayment = {
  id: string;
  reference: string;
  methodLabel: string;
  amountLabel: string;
  /** Taka as text for the amount field; the server converts it to poisa. */
  refundableInputValue: string;
  refundableLabel: string;
  isDemo: boolean;
};

/**
 * A refund returns money that was already received. It adds a refund record
 * against the original payment — the payment itself stays on file, and so does
 * the bill.
 */
export function BillRefundForm({
  payments,
  currencySymbol,
}: {
  payments: RefundablePayment[];
  currencySymbol: string;
}) {
  const router = useRouter();
  const action = useAdminAction();
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? "");
  const [amount, setAmount] = useState(payments[0]?.refundableInputValue ?? "");
  const [reason, setReason] = useState("");

  const chosen = payments.find((payment) => payment.id === paymentId);
  const typedPoisa = parseMoneyInput(amount);
  const refundablePoisa = parseMoneyInput(chosen?.refundableInputValue ?? "") ?? 0;
  const exceedsRefundable = typedPoisa !== null && typedPoisa > refundablePoisa;
  const amountLabel = typedPoisa === null ? null : formatPoisa(typedPoisa, { symbol: currencySymbol });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await action.run<RefundResponse>("POST", "/api/payments/refund", {
      paymentId,
      // Taka text, exactly as the cashier typed it.
      amountPoisa: amount.trim(),
      reason: reason.trim(),
    });
    if (!response) return;
    setReason("");
    action.setNotice(
      response.applied
        ? `Refund ${response.refund.number} recorded — the money is back with the guest. The bill and the original payment both remain on file.`
        : response.message ??
          "Refund sent to the gateway. It stays pending until that gateway confirms it; nothing has come back to the guest yet.",
    );
    router.refresh();
  }

  if (payments.length === 0) {
    return (
      <p className="hint">
        There is no verified payment on this bill to refund. A payment that is still waiting on the bank has not been
        received, so there is nothing to give back.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="no-print space-y-3">
      <div>
        <label className="label" htmlFor="refund-payment">
          Refund which payment
        </label>
        <select
          id="refund-payment"
          className="select"
          value={paymentId}
          onChange={(event) => {
            const next = event.target.value;
            setPaymentId(next);
            const payment = payments.find((entry) => entry.id === next);
            if (payment) setAmount(payment.refundableInputValue);
          }}
        >
          {payments.map((payment) => (
            <option key={payment.id} value={payment.id}>
              {payment.reference} · {payment.methodLabel} · {payment.amountLabel}
              {payment.isDemo ? " · simulated" : ""} · still refundable {payment.refundableLabel}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="refund-amount">
            Amount to give back ({currencySymbol} Taka)
          </label>
          <input
            id="refund-amount"
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={exceedsRefundable}
          />
          <p className="hint mt-1">
            Prefilled with the {chosen?.refundableLabel ?? "outstanding"} still refundable on that payment.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="refund-reason">
            Reason
          </label>
          <input
            id="refund-reason"
            className="input"
            autoComplete="off"
            placeholder="Dish returned, over-taken in error…"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>

      {exceedsRefundable ? (
        <p className="notice notice-error">
          {amountLabel} is more than the {chosen?.refundableLabel ?? "refundable"} still held against that payment. The
          server will refuse it.
        </p>
      ) : null}

      {action.error ? <p className="notice notice-error">{action.error}</p> : null}
      {action.notice ? <p className="notice notice-ok">{action.notice}</p> : null}

      <button type="submit" className="btn btn-danger" disabled={action.busy || reason.trim().length < 5 || typedPoisa === null || typedPoisa <= 0}>
        {action.busy
          ? "Recording the refund…"
          : amountLabel
            ? `Refund ${amountLabel}`
            : "Refund"}
      </button>
      <p className="hint">
        A refund needs a reason and is written to the audit log with your name. It reduces what the restaurant is
        holding; it does not remove the bill, the order or the original payment.
      </p>
    </form>
  );
}

type RefundResponse = {
  refund: { id: string; number: string; status: string };
  applied: boolean;
  message?: string;
};
