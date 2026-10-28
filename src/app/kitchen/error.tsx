"use client";

import { useEffect } from "react";

/**
 * A stopped board is a kitchen that thinks nothing is coming. The failure is
 * said plainly, retries are automatic through the normal poll, and the way to
 * escalate (tell the floor) is spelled out.
 */
export default function KitchenError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[kitchen-error]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">Kitchen board stopped</h1>
      <p className="notice notice-error text-lg">
        The board cannot load right now, so new tickets are not visible here. Tell the floor to keep taking orders by
        hand, and press the button to try again.
      </p>
      <button type="button" onClick={retry} className="btn btn-primary py-4 text-lg font-bold">
        Try again
      </button>
      {error.digest ? <p className="hint">Reference {error.digest} — quote this if you ask us what happened.</p> : null}
    </div>
  );
}
