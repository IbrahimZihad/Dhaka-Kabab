"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { poisaToInputValue } from "@/lib/money";

/**
 * Customisation groups for one dish — e.g. "Choose your spice" or "Pick a side".
 * A group holds options, each carrying a price delta in TAKA (the order engine
 * adds it to the line at checkout).
 *
 * Saving posts the whole group with its options: the endpoint upserts the ones
 * that carry an id, creates the new ones, and deletes any existing option left
 * out. So removing an option here only takes effect once the group is saved.
 *
 * Price deltas are typed in TAKA and sent verbatim; the server converts to poisa.
 */

export type OptionRow = {
  id: string;
  name: string;
  priceDeltaPoisa: number;
  available: boolean;
  sortOrder: number;
};

export type GroupRow = {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: OptionRow[];
};

type DraftOption = {
  id?: string;
  name: string;
  priceDelta: string;
  available: boolean;
  sortOrder: string;
};

function toDraft(group?: GroupRow): {
  name: string;
  required: boolean;
  minSelect: string;
  maxSelect: string;
  sortOrder: string;
  options: DraftOption[];
} {
  if (!group) {
    return { name: "", required: false, minSelect: "0", maxSelect: "1", sortOrder: "0", options: [{ name: "", priceDelta: "0", available: true, sortOrder: "0" }] };
  }
  return {
    name: group.name,
    required: group.required,
    minSelect: String(group.minSelect),
    maxSelect: String(group.maxSelect),
    sortOrder: String(group.sortOrder),
    options: group.options.map((option) => ({
      id: option.id,
      name: option.name,
      priceDelta: poisaToInputValue(option.priceDeltaPoisa),
      available: option.available,
      sortOrder: String(option.sortOrder),
    })),
  };
}

function guestHint(required: boolean, min: number, max: number): string {
  const range = min === max ? `exactly ${min} option${min === 1 ? "" : "s"}` : `between ${min} and ${max} options`;
  if (required) {
    return `Required: a guest must pick ${range} before they can add this dish.`;
  }
  return `Optional: a guest may ignore this, but any choice they make must be ${range}.`;
}

export function MenuGroupEditor({
  itemId,
  symbol,
  group,
}: {
  itemId: string;
  symbol: string;
  group?: GroupRow;
}) {
  const router = useRouter();
  const { busy, error, notice, run, setNotice } = useAdminAction();
  const [draft, setDraft] = useState(() => toDraft(group));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCreate = group === undefined;

  function setField<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateOption(index: number, patch: Partial<DraftOption>) {
    setDraft((current) => ({
      ...current,
      options: current.options.map((option, i) => (i === index ? { ...option, ...patch } : option)),
    }));
  }

  function addOption() {
    setDraft((current) => ({
      ...current,
      options: [...current.options, { name: "", priceDelta: "0", available: true, sortOrder: String(current.options.length) }],
    }));
  }

  function removeOption(index: number) {
    setDraft((current) => ({ ...current, options: current.options.filter((_, i) => i !== index) }));
  }

  async function save() {
    const body = {
      id: group?.id,
      name: draft.name.trim(),
      required: draft.required,
      minSelect: Number(draft.minSelect) || 0,
      maxSelect: Number(draft.maxSelect) || 1,
      sortOrder: Number(draft.sortOrder) || 0,
      options: draft.options.map((option) => ({
        id: option.id,
        name: option.name.trim(),
        priceDeltaPoisa: option.priceDelta.trim() === "" ? "0" : option.priceDelta.trim(),
        available: option.available,
        sortOrder: Number(option.sortOrder) || 0,
      })),
    };
    const result = await run<{ name: string; options: { priceDeltaPoisa: number }[] }>(
      "POST",
      `/api/admin/menu/items/${itemId}/customizations`,
      body,
    );
    if (result) {
      setNotice(`Saved “${result.name}” with ${result.options.length} option(s).`);
      if (isCreate) setDraft(toDraft());
      router.refresh();
    }
  }

  async function remove() {
    if (!group) return;
    const result = await run<{ id: string }>("DELETE", `/api/admin/menu/customizations/${group.id}`);
    if (result) {
      router.refresh();
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label" htmlFor={`grp-${group?.id ?? "new"}-name`}>
            Group name
          </label>
          <input
            id={`grp-${group?.id ?? "new"}-name`}
            className="input"
            required
            maxLength={60}
            autoComplete="off"
            value={draft.name}
            onChange={(event) => setField("name", event.target.value)}
            placeholder="e.g. Choose your spice"
          />
        </div>
        <div>
          <label className="label" htmlFor={`grp-${group?.id ?? "new"}-sort`}>
            Order
          </label>
          <input
            id={`grp-${group?.id ?? "new"}-sort`}
            className="input"
            type="number"
            min={0}
            max={999}
            inputMode="numeric"
            value={draft.sortOrder}
            onChange={(event) => setField("sortOrder", event.target.value)}
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.required} onChange={(event) => setField("required", event.target.checked)} />
            Required choice
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`grp-${group?.id ?? "new"}-min`}>
            Fewest to pick
          </label>
          <input
            id={`grp-${group?.id ?? "new"}-min`}
            className="input"
            type="number"
            min={0}
            max={10}
            inputMode="numeric"
            value={draft.minSelect}
            onChange={(event) => setField("minSelect", event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor={`grp-${group?.id ?? "new"}-max`}>
            Most to pick
          </label>
          <input
            id={`grp-${group?.id ?? "new"}-max`}
            className="input"
            type="number"
            min={1}
            max={10}
            inputMode="numeric"
            value={draft.maxSelect}
            onChange={(event) => setField("maxSelect", event.target.value)}
          />
        </div>
      </div>

      <p className="hint">{guestHint(draft.required, Number(draft.minSelect) || 0, Number(draft.maxSelect) || 1)}</p>

      <div className="space-y-2">
        <p className="label">Options</p>
        {draft.options.map((option, index) => (
          <div key={option.id ?? `new-${index}`} className="grid gap-2 rounded border border-line p-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
            <input
              className="input"
              aria-label={`Option ${index + 1} name`}
              maxLength={60}
              value={option.name}
              placeholder="e.g. Mild"
              onChange={(event) => updateOption(index, { name: event.target.value })}
            />
            <input
              className="input w-24"
              aria-label={`Option ${index + 1} price`}
              inputMode="decimal"
              value={option.priceDelta}
              placeholder={`0 (taka)`}
              title="Price change in taka"
              onChange={(event) => updateOption(index, { priceDelta: event.target.value })}
            />
            <input
              className="input w-16"
              aria-label={`Option ${index + 1} order`}
              type="number"
              min={0}
              max={999}
              inputMode="numeric"
              value={option.sortOrder}
              title="Order"
              onChange={(event) => updateOption(index, { sortOrder: event.target.value })}
            />
            <label className="flex items-center gap-1 text-xs" title="Available">
              <input type="checkbox" checked={option.available} onChange={(event) => updateOption(index, { available: event.target.checked })} />
              On
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeOption(index)} disabled={busy}>
              Remove
            </button>
          </div>
        ))}
        <p className="hint">
          The price box is the change to the dish price, in taka (a “0” adds nothing). {symbol} figures are stored as
          poisa by the server.
        </p>
        <button type="button" className="btn btn-outline btn-sm" onClick={addOption} disabled={busy}>
          Add an option
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || draft.options.length === 0} onClick={() => void save()}>
          {busy ? "Saving…" : isCreate ? "Add this group" : "Save the group"}
        </button>
        {!isCreate && group ? (
          confirmDelete ? (
            <>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void remove()}>
                {busy ? "Removing…" : "Confirm: delete the group"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
              Delete the group
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

export function MenuCustomizer({ itemId, symbol, groups }: { itemId: string; symbol: string; groups: GroupRow[] }) {
  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <p className="hint">
          No choices on this dish yet — a guest adds it as it is. Add a group if they must pick something (a size, a
          spice level, a side).
        </p>
      ) : (
        groups.map((group) => <MenuGroupEditor key={group.id} itemId={itemId} symbol={symbol} group={group} />)
      )}
      <MenuGroupEditor key={`create-${groups.length}`} itemId={itemId} symbol={symbol} />
    </div>
  );
}
