"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { PAYMENT_RECORD_LABELS, statusTone } from "@/lib/staff-format";
import { formatPoisa } from "@/lib/money";

type StatusPayload = {
  id: string;
  reference: string;
  status: keyof typeof PAYMENT_RECORD_LABELS;
  amountPoisa: number;
  provider: string;
  isDemo: boolean;
  verifiedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  bill: { id: string; number: string; totalPoisa: number; paidPoisa: number; status: string } | null;
};

const TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  ok: "badge badge-open",
  wait: "badge",
  bad: "badge badge-closed",
  neutral: "badge",
};

/**
 * Asks the server what a payment record currently says. A page load proves
 * nothing: only this response, which reads the stored record after any verified
 * gateway callback, may change what we say about the money.
 */
export function PaymentStatusCheck({ reference, timeZone }: { reference: string; timeZone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<StatusPayload | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    const response = await apiFetch<StatusPayload>(
      `/api/payments/${encodeURIComponent(reference)}/status`,
      { method: "GET" },
    );
    setBusy(false);
    if (!response.ok) {
      setError(response.error.message);
      return;
    }
    setAnswer(response.data);
    // The bill's own figures come from the server, so pull them again rather than
    // assuming the callback already moved the balance forward here.
    if (response.data.status !== "PENDING") router.refresh();
  }

  const label = answer ? PAYMENT_RECORD_LABELS[answer.status] : null;

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-outline btn-sm no-print" onClick={check} disabled={busy}>
          {busy ? "Asking the server…" : "Check now"}
        </button>
        {answer ? (
          <span className={TONE_CLASS[statusTone(label ?? "")]}>
            {label}
            {answer.isDemo ? " · simulated" : ""}
          </span>
        ) : null}
      </span>
      {error ? <span className="hint text-danger">{error}</span> : null}
      {answer ? (
        <span className="hint">
          {formatPoisa(answer.amountPoisa)} · reference {answer.reference} ·{" "}
          {answer.status === "PENDING"
            ? "the bank has not confirmed this yet"
            : answer.verifiedAt
              ? `confirmed ${new Intl.DateTimeFormat("en-GB", {
                  timeZone,
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  year: undefined,
                }).format(new Date(answer.verifiedAt))}`
              : "no confirmation time on the record"}
          {answer.failureReason ? ` · ${answer.failureReason}` : ""}
        </span>
      ) : null}
    </span>
  );
}
