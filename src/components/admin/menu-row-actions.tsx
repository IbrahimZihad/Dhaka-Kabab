"use client";

import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * Inline controls on a dish row. Availability and the featured marker are the two
 * things staff flip most often, so they live here rather than inside the editor.
 * Each button calls its own endpoint through `useAdminAction`, reports exactly
 * what the server answered, then reloads the list from the database.
 *
 * "Unavailable" is not deletion: the dish stays on the public menu with a plain
 * note for the guest. Removal is a separate, soft action on the dish page.
 */
export function MenuRowActions({
  item,
}: {
  item: { id: string; name: string; available: boolean; featured: boolean };
}) {
  const router = useRouter();
  const { busy, error, notice, run } = useAdminAction();

  async function setAvailability(available: boolean) {
    const result = await run<{ available: boolean }>("PATCH", `/api/admin/menu/items/${item.id}/availability`, {
      available,
    });
    if (result) {
      router.refresh();
    }
  }

  async function setFeatured(featured: boolean) {
    const result = await run<{ featured: boolean }>("PATCH", `/api/admin/menu/items/${item.id}/featured`, { featured });
    if (result) {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {item.available ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void setAvailability(false)}>
            Sold out
          </button>
        ) : (
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void setAvailability(true)}>
            Back on
          </button>
        )}
        {item.featured ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void setFeatured(false)}>
            Unfeature
          </button>
        ) : (
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void setFeatured(true)}>
            Feature
          </button>
        )}
      </div>
      {busy ? <span className="hint">Asking the server…</span> : null}
      {error ? <span className="hint text-danger">{error}</span> : null}
      {notice ? <span className="hint">{notice}</span> : null}
    </div>
  );
}

/**
 * Undo of the soft removal. An archived dish was never erased — its row is kept so
 * past orders and receipts still read correctly — so bringing it back is a matter
 * of clearing the archive marker. This posts to the restore endpoint and reports
 * what the server answered before the list is reloaded.
 */
export function MenuRestoreButton({ item }: { item: { id: string; name: string } }) {
  const router = useRouter();
  const { busy, error, notice, run } = useAdminAction();

  async function restore() {
    const result = await run<{ id: string }>("POST", `/api/admin/menu/items/${item.id}/restore`);
    if (result) {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void restore()}>
        {busy ? "Restoring…" : "Put back on the menu"}
      </button>
      {error ? <span className="hint text-danger">{error}</span> : null}
      {notice ? <span className="hint">{notice}</span> : null}
    </div>
  );
}

/** Same undo for a section. A section only archives once it holds no dishes. */
export function CategoryRestoreButton({ category }: { category: { id: string; name: string } }) {
  const router = useRouter();
  const { busy, error, run } = useAdminAction();

  async function restore() {
    const result = await run<{ id: string }>("POST", `/api/admin/menu/categories/${category.id}/restore`);
    if (result) {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => void restore()}>
        {busy ? "Restoring…" : "Put back on the menu"}
      </button>
      {error ? <span className="hint text-danger">{error}</span> : null}
    </div>
  );
}
