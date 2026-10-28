"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * Soft removal and its undo. Archiving a dish never destroys it: past order lines
 * and receipts keep their own price and name, so the row stays resolvable and the
 * server refuses to archive one still sitting on an open order. Restore brings it
 * back onto the menu.
 */
export function DishLifecycle({ dish }: { dish: { id: string; name: string; archived: boolean } }) {
  const router = useRouter();
  const { busy, error, notice, run } = useAdminAction();
  const [confirming, setConfirming] = useState(false);

  async function archive() {
    const result = await run<{ id: string }>("DELETE", `/api/admin/menu/items/${dish.id}`);
    if (result) {
      setConfirming(false);
      router.refresh();
    }
  }

  async function restore() {
    const result = await run<{ id: string }>("POST", `/api/admin/menu/items/${dish.id}/restore`);
    if (result) {
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}

      {dish.archived ? (
        <div className="rounded-md border border-line p-3">
          <p className="soft">
            This dish is off the menu (archived). It is kept so past orders still read correctly. Bring it back to make
            it orderable again.
          </p>
          <button type="button" className="btn btn-primary btn-sm mt-2" disabled={busy} onClick={() => void restore()}>
            {busy ? "Restoring…" : "Put it back on the menu"}
          </button>
        </div>
      ) : (
        <div className="rounded-md border border-line p-3">
          <p className="soft">
            Taking a dish off the menu keeps it in the records — it is not deleted. Mark it sold out instead if it is
            only unavailable for now; that keeps it visible to guests with a note.
          </p>
          {confirming ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void archive()}>
                {busy ? "Working…" : "Confirm: take it off the menu"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
                Keep it on
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm mt-2" disabled={busy} onClick={() => setConfirming(true)}>
              Take off the menu
            </button>
          )}
        </div>
      )}
    </div>
  );
}
