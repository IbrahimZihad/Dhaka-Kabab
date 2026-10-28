"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { TABLE_STATUS_LABELS } from "@/lib/staff-format";

export type AssignableTable = {
  id: string;
  label: string;
  capacity: number;
  status: string;
  isEnabled: boolean;
};

/**
 * Moving a booking between tables. The chosen set is sent to the API and the
 * service re-checks every overlap and the seat count inside a locked
 * transaction — this component never decides whether a table is free. A refusal
 * (an overlapping booking, too few seats) is shown verbatim and the choice
 * stays on screen, so the member of staff can pick differently and retry.
 */
export function ReservationTableAssign({
  reservationId,
  code,
  partySize,
  assignedIds,
  tables,
}: {
  reservationId: string;
  code: string;
  partySize: number;
  assignedIds: string[];
  tables: AssignableTable[];
}) {
  const router = useRouter();
  const { busy, error, notice, setNotice, setError, run } = useAdminAction();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(assignedIds));

  const seats = tables
    .filter((table) => chosen.has(table.id))
    .reduce((total, table) => total + table.capacity, 0);

  function toggle(tableId: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(tableId)) next.delete(tableId);
      else next.add(tableId);
      return next;
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (chosen.size === 0) {
      setError("Pick at least one table — a booking cannot sit on nothing.");
      return;
    }
    const updated = await run<{ tables: { table?: { label?: string } | null }[] }>(
      "PUT",
      `/api/reservations/${reservationId}/tables`,
      { tableIds: [...chosen] },
    );
    if (!updated) return;
    const labels = updated.tables.map((assignment) => assignment.table?.label).filter(Boolean).join(", ");
    setNotice(`Booking ${code} now sits at ${labels || "the chosen tables"}.`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <fieldset disabled={busy}>
        <legend className="label">Choose the tables for this party</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((table) => (
            <label
              key={table.id}
              className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                chosen.has(table.id) ? "border-brand bg-paper-raised" : "border-line"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosen.has(table.id)}
                  onChange={() => toggle(table.id)}
                  className="mt-0.5"
                />
                <span className="font-semibold">{table.label}</span>
              </span>
              <span className="muted">
                seats {table.capacity} · {TABLE_STATUS_LABELS[table.status as keyof typeof TABLE_STATUS_LABELS] ?? table.status}
                {table.isEnabled ? "" : " · disabled"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="hint">
        Selected tables seat {seats} in total; the party is {partySize}. Whether these tables are genuinely free at
        this booking&apos;s time is checked by the restaurant, not guessed here — the answer arrives when you save.
      </p>

      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Sending…" : "Assign these tables"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setChosen(new Set(assignedIds))}>
          Back to the current tables
        </button>
      </div>
    </form>
  );
}
