import type { ReactNode } from "react";
import { statusTone } from "@/lib/staff-format";

/**
 * Shared building blocks for the staff screens, so a table, a badge or an empty
 * list looks the same in every section of the panel.
 */

const TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  ok: "badge badge-open",
  wait: "badge",
  bad: "badge badge-closed",
  neutral: "badge",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={TONE_CLASS[statusTone(status)]}>{status}</span>;
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description ? <p className="hint mt-1">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <p className="hint mx-auto mt-1 max-w-prose">{children}</p> : null}
    </div>
  );
}

/** Server-rendered note about the data itself, e.g. "nothing matches that filter". */
export function Note({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: ReactNode }) {
  const cls = kind === "error" ? "notice notice-error" : kind === "ok" ? "notice notice-ok" : "notice";
  return <p className={cls}>{children}</p>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint ? <p className="hint mt-1">{hint}</p> : null}
    </div>
  );
}

/** A plain key/value grid — used instead of a table when a row has many fields. */
export function Details({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="label">{row.label}</dt>
          <dd className="soft mt-0.5">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            {head.map((cell) => (
              <th key={cell} className="label px-3 py-2 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
