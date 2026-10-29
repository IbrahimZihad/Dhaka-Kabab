"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/client-api";

/**
 * The last step of a paid visit, offered where the money was taken.
 *
 * Closing a table is normally a floor action, but the person who just settled the
 * bill is standing in the same moment; sending them to another screen to confirm
 * the guests have left is how a table stays marked occupied all evening. The
 * server still decides — an unpaid balance needs a manager, and this button only
 * ever asks for the "settled" reason.
 */
export function ClearTableButton({ sessionId, tableLabel }: { sessionId: string; tableLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clear() {
    const agreed = window.confirm(
      `Clear table ${tableLabel}?\n\nThis ends the visit. Any order still open on it is marked completed; the bill and its payments stay on the ledger.`,
    );
    if (!agreed) return;
    setBusy(true);
    setError(null);
    const response = await apiFetch(`/api/admin/sessions/${sessionId}/close`, {
      method: "POST",
      body: { reason: "SETTLED" },
    });
    if (!response.ok) {
      setBusy(false);
      setError(response.error.message);
      return;
    }
    router.push("/admin/floor");
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className="btn btn-outline btn-sm" onClick={clear} disabled={busy}>
        {busy ? "Clearing…" : `Clear table ${tableLabel}`}
      </button>
      {error ? <p className="notice notice-error">{error}</p> : null}
    </div>
  );
}
