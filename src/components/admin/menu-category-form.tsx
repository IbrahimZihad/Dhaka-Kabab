"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * Categories (sections) hold dishes, so a category that has appeared on a printed
 * menu or in a past order must stay resolvable — hence archiving, never deleting,
 * and the server refuses to archive one that still holds dishes.
 *
 * A create/edit sends the whole record; the PATCH endpoint re-validates the full
 * body, so an edit keeps the fields it is not changing.
 */

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  dishCount: number;
};

function bodyFor(input: {
  name: string;
  description: string;
  imageUrl: string | null;
  sortOrder: string;
  isActive: boolean;
  slug?: string;
}) {
  return {
    name: input.name.trim(),
    slug: input.slug && input.slug.trim() ? input.slug.trim() : undefined,
    description: input.description.trim() ? input.description.trim() : null,
    imageUrl: input.imageUrl,
    sortOrder: Number(input.sortOrder) || 0,
    isActive: input.isActive,
  };
}

/** Creating a new section. */
export function MenuCategoryForm() {
  const router = useRouter();
  const { busy, error, notice, run, setNotice } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await run<{ name: string }>("POST", "/api/admin/menu/categories", {
      ...bodyFor({ name, description, imageUrl: null, sortOrder, isActive: true }),
    });
    if (result) {
      setName("");
      setDescription("");
      setSortOrder("");
      setOpen(false);
      setNotice(`The section “${result.name}” was added.`);
      router.refresh();
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        {notice ? <p className="notice notice-ok mb-0">{notice}</p> : null}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
          Add a section
        </button>
      </div>
    );
  }

  return (
    <form className="card space-y-3 p-4" onSubmit={submit}>
      <p className="label">A new section</p>
      {error ? <p className="notice notice-error">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="new-cat-name">
            Name
          </label>
          <input
            id="new-cat-name"
            className="input"
            required
            maxLength={60}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Kebabs"
          />
        </div>
        <div>
          <label className="label" htmlFor="new-cat-sort">
            Order
          </label>
          <input
            id="new-cat-sort"
            className="input"
            type="number"
            min={0}
            max={9999}
            inputMode="numeric"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            placeholder="0"
          />
          <p className="hint mt-1">Lowest first on the guest menu.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="new-cat-desc">
            Description (optional)
          </label>
          <textarea
            id="new-cat-desc"
            className="textarea"
            maxLength={400}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Adding…" : "Add the section"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** One section in the list: rename, reorder, hide from guests, or archive when empty. */
export function MenuCategoryEditor({ category }: { category: CategoryRow }) {
  const router = useRouter();
  const { busy, error, notice, run, setError, setNotice } = useAdminAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));

  async function save() {
    const result = await run<{ name: string; isActive: boolean; sortOrder: number }>(
      "PATCH",
      `/api/admin/menu/categories/${category.id}`,
      bodyFor({ name, description, imageUrl: category.imageUrl, sortOrder, isActive: category.isActive }),
    );
    if (result) {
      setNotice(`Section saved.`);
      setEditing(false);
      router.refresh();
    }
  }

  async function toggleActive() {
    setError(null);
    const result = await run<{ isActive: boolean }>("PATCH", `/api/admin/menu/categories/${category.id}`, {
      ...bodyFor({
        name: category.name,
        description: category.description ?? "",
        imageUrl: category.imageUrl,
        sortOrder: String(category.sortOrder),
        isActive: !category.isActive,
      }),
    });
    if (result) {
      router.refresh();
    }
  }

  async function archive() {
    if (
      !window.confirm(
        `Archive “${category.name}”?\n\nThe section is hidden from guests but kept, so past orders still read correctly. It can only be archived once no dishes remain in it.`,
      )
    ) {
      return;
    }
    const result = await run<{ id: string }>("DELETE", `/api/admin/menu/categories/${category.id}`);
    if (result) {
      setNotice(`Section archived.`);
      router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}
      {editing ? (
        <div className="space-y-3 rounded-md border border-line p-3">
          <div>
            <label className="label" htmlFor={`cat-${category.id}-name`}>
              Name
            </label>
            <input
              id={`cat-${category.id}-name`}
              className="input"
              required
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`cat-${category.id}-sort`}>
                Order
              </label>
              <input
                id={`cat-${category.id}-sort`}
                className="input"
                type="number"
                min={0}
                max={9999}
                inputMode="numeric"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor={`cat-${category.id}-desc`}>
                Description
              </label>
              <input
                id={`cat-${category.id}-desc`}
                className="input"
                maxLength={400}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save the section"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                setName(category.name);
                setDescription(category.description ?? "");
                setSortOrder(String(category.sortOrder));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void toggleActive()}>
            {category.isActive ? "Hide from guests" : "Show again"}
          </button>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void archive()}>
            Archive
          </button>
        </div>
      )}
    </div>
  );
}
