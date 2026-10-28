"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * Adding a table to the room. `number` is unique across the restaurant, so if a
 * number is taken the server says so and the message is shown verbatim — the
 * form stays open so the staff member can pick another and try again.
 */
export function FloorAddTable() {
  const router = useRouter();
  const { busy, error, notice, run, setNotice } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [section, setSection] = useState("");

  function reset() {
    setLabel("");
    setNumber("");
    setCapacity("4");
    setSection("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedLabel = label.trim().toUpperCase();
    const result = await run<{ label?: string }>("POST", "/api/admin/tables", {
      label: trimmedLabel,
      number,
      capacity,
      section: section.trim() ? section.trim() : null,
      isEnabled: true,
    });
    if (result) {
      reset();
      setOpen(false);
      setNotice(`Table ${result.label ?? trimmedLabel} is on the floor.`);
      router.refresh();
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        {notice ? <p className="notice notice-ok mb-0">{notice}</p> : null}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
          Add a table
        </button>
      </div>
    );
  }

  return (
    <form className="card space-y-3 p-4" onSubmit={submit}>
      <p className="label">A new table on the floor</p>
      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="new-table-label">
            Label
          </label>
          <input
            id="new-table-label"
            className="input"
            required
            maxLength={12}
            autoComplete="off"
            placeholder="e.g. YE252"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <p className="hint mt-1">Letters, numbers or dashes, up to 12.</p>
        </div>
        <div>
          <label className="label" htmlFor="new-table-number">
            Number
          </label>
          <input
            id="new-table-number"
            className="input"
            type="number"
            required
            min={1}
            max={9999}
            inputMode="numeric"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
          <p className="hint mt-1">Must be unique in the restaurant.</p>
        </div>
        <div>
          <label className="label" htmlFor="new-table-capacity">
            Seats
          </label>
          <input
            id="new-table-capacity"
            className="input"
            type="number"
            required
            min={1}
            max={40}
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="new-table-section">
            Section (optional)
          </label>
          <input
            id="new-table-section"
            className="input"
            maxLength={40}
            autoComplete="off"
            placeholder="e.g. Hall"
            value={section}
            onChange={(event) => setSection(event.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Adding…" : "Add the table"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
