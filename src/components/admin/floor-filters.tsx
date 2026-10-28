"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { TABLE_STATUS_LABELS } from "@/lib/staff-format";

/**
 * Filters live in the URL, not in local state, so a filtered board can be shared
 * or reloaded and always comes back server-rendered — the same plain GET form the
 * bills and orders screens use. The reload button is the only refresh this screen
 * has: a manager presses it rather than the board polling on its own.
 */
export function FloorFilters({
  sections,
  hasUnassigned,
  activeSection,
  activeStatus,
  activeSearch,
}: {
  sections: string[];
  hasUnassigned: boolean;
  activeSection: string;
  activeStatus: string;
  activeSearch: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const filtersActive = Boolean(activeSection || activeStatus || activeSearch);

  function reload() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <form action="/admin/floor" method="get" className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label" htmlFor="floor-section">
            Section
          </label>
          <select id="floor-section" name="section" className="select" defaultValue={activeSection}>
            <option value="">All sections</option>
            {sections.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
            {hasUnassigned ? <option value="__unassigned">Unassigned</option> : null}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="floor-status">
            Status
          </label>
          <select id="floor-status" name="status" className="select" defaultValue={activeStatus}>
            <option value="">Any status</option>
            {Object.entries(TABLE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="floor-search">
            Table label or visit code
          </label>
          <input
            id="floor-search"
            name="search"
            type="search"
            className="input"
            maxLength={40}
            autoComplete="off"
            placeholder="e.g. YE251 or YE251-7K3F"
            defaultValue={activeSearch}
          />
        </div>

        <button type="submit" className="btn btn-outline btn-sm" disabled={isPending}>
          Apply
        </button>
        {filtersActive ? (
          <Link href="/admin/floor" className="btn btn-ghost btn-sm">
            Clear filters
          </Link>
        ) : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={reload} disabled={isPending}>
          {isPending ? "Reloading…" : "Reload the board"}
        </button>
      </form>

      {filtersActive ? (
        <p className="hint">
          Filtered by{" "}
          {[
            activeStatus ? TABLE_STATUS_LABELS[activeStatus as keyof typeof TABLE_STATUS_LABELS] ?? activeStatus : null,
            activeSection
              ? activeSection === "__unassigned"
                ? "unassigned section"
                : `section “${activeSection}”`
              : null,
            activeSearch ? `“${activeSearch}”` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          .{" "}
          <Link href="/admin/floor" className="underline">
            Show the whole room again
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
