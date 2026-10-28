"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { formatPoisa, parseMoneyInput } from "@/lib/money";

/**
 * The three things a cashier or manager does to a bill itself. Editing lines is
 * not one of them: an OPEN bill is re-mirrored from the table's orders, and a
 * FINALIZED bill is an immutable financial document whose lines never change
 * again.
 */
export function BillActions({
  billId,
  billNumber,
  status,
  canManage,
  currencySymbol,
}: {
  billId: string;
  billNumber: string;
  status: "OPEN" | "FINALIZED" | "SETTLED" | "VOIDED";
  canManage: boolean;
  currencySymbol: string;
}) {
  const router = useRouter();
  const refreshAction = useAdminAction();
  const finalizeAction = useAdminAction();
  const [discount, setDiscount] = useState("");

  const discountPoisa = parseMoneyInput(discount);
  const discountLabel = discountPoisa === null || discountPoisa === 0 ? null : formatPoisa(discountPoisa, { symbol: currencySymbol });

  async function refresh() {
    const response = await refreshAction.run("POST", `/api/bills/${billId}/refresh`);
    if (!response) return;
    refreshAction.setNotice(
      `${billNumber} re-mirrored from the table's orders. Only an open bill can change; nothing was priced by hand.`,
    );
    router.refresh();
  }

  async function finalize(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = discount.trim();
    const response = await finalizeAction.run<FinalizeResponse>(
      "POST",
      `/api/bills/${billId}/finalize`,
      trimmed ? { discountPoisa: trimmed } : {},
    );
    if (!response) return;
    finalizeAction.setNotice(
      `${response.number} finalized at ${formatPoisa(response.totalPoisa, { symbol: currencySymbol })}. Its lines are now fixed.`,
    );
    router.refresh();
  }

  if (!canManage) {
    return (
      <p className="hint">
        Your role can read this bill but not change it. A manager or cashier on shift can finalize it once the table
        has finished ordering.
      </p>
    );
  }

  return (
    <div className="no-print space-y-4">
      {status === "OPEN" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-outline" onClick={refresh} disabled={refreshAction.busy}>
              {refreshAction.busy ? "Refreshing…" : "Refresh from the kitchen"}
            </button>
            <span className="hint">
              Pulls in anything the table has ordered since this bill was last read. A cancelled order drops out.
            </span>
          </div>
          {refreshAction.error ? <p className="notice notice-error">{refreshAction.error}</p> : null}
          {refreshAction.notice ? <p className="notice notice-ok">{refreshAction.notice}</p> : null}

          <form onSubmit={finalize} className="space-y-3">
            <div className="max-w-xs">
              <label className="label" htmlFor="finalize-discount">
                Discount ({currencySymbol} Taka, optional)
              </label>
              <input
                id="finalize-discount"
                className="input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="No discount"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
              />
              <p className="hint mt-1">
                The discount is taken off the subtotal before service charge and VAT, and is fixed with the bill.
              </p>
            </div>
            {finalizeAction.error ? <p className="notice notice-error">{finalizeAction.error}</p> : null}
            {finalizeAction.notice ? <p className="notice notice-ok">{finalizeAction.notice}</p> : null}
            <button type="submit" className="btn btn-primary" disabled={finalizeAction.busy}>
              {finalizeAction.busy
                ? "Finalizing…"
                : discountLabel
                  ? `Finalize with ${discountLabel} discount`
                  : "Finalize this bill"}
            </button>
            <p className="hint">
              Finalizing fixes the amount owed and stamps the charges in force. It does not take any money.
            </p>
          </form>
        </>
      ) : status === "FINALIZED" ? (
        <p className="hint">
          This bill is finalized, so its lines are an issued document and cannot be edited here. Refreshing it would
          leave those lines untouched; payment, refund and void are what remain.
        </p>
      ) : (
        <p className="hint">
          {status === "SETTLED"
            ? "This bill is settled. Nothing further can be taken against it; a refund is the only money action left."
            : "This bill was voided, so it no longer carries a balance to act on."}
        </p>
      )}
    </div>
  );
}

type FinalizeResponse = { number: string; status: string; totalPoisa: number };

/**
 * Voiding is a recorded action, not a deletion: the bill, its lines and any
 * payment against it survive, and the reason is written to the audit log.
 */
export function BillVoidForm({
  billId,
  billNumber,
  status,
  paymentsHeld,
}: {
  billId: string;
  billNumber: string;
  status: "OPEN" | "FINALIZED" | "SETTLED" | "VOIDED";
  paymentsHeld: boolean;
}) {
  const router = useRouter();
  const action = useAdminAction();
  const [reason, setReason] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await action.run<VoidResponse>("POST", `/api/bills/${billId}/void`, { reason: reason.trim() });
    if (!response) return;
    action.setNotice(
      `${response.number} is now recorded as voided. The bill, its lines and this reason stay on the ledger — nothing has been deleted.`,
    );
    router.refresh();
  }

  if (status === "VOIDED") return null;

  return (
    <details className="no-print">
      <summary className="cursor-pointer text-sm font-semibold text-danger">Void this bill</summary>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="hint">
          Voiding does not delete anything. {billNumber}, its line copies and the reason stay on file, and this action
          is recorded in the audit log with your name.
          {paymentsHeld
            ? " This bill has verified payments: they must be refunded before it can be voided."
            : " A bill with verified payments cannot be voided until those payments are refunded."}
        </p>
        <div>
          <label className="label" htmlFor="void-reason">
            Reason
          </label>
          <textarea
            id="void-reason"
            className="textarea"
            placeholder="Raised against the wrong table, settled on another bill…"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {action.error ? <p className="notice notice-error">{action.error}</p> : null}
        {action.notice ? <p className="notice notice-ok">{action.notice}</p> : null}
        <button type="submit" className="btn btn-danger" disabled={action.busy || reason.trim().length < 5}>
          {action.busy ? "Recording the void…" : "Void this bill"}
        </button>
      </form>
    </details>
  );
}

type VoidResponse = { number: string; status: string; voidedAt: string | null };
