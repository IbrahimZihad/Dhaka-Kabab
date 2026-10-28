"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAction } from "@/components/admin/use-admin-action";

/**
 * One printable QR sticker card. The picture always comes from the signed-in
 * admin route `/api/admin/tables/<id>/qr` — the table token never appears in an
 * image URL, so it cannot leak through referrers or proxy logs. The token is
 * shown to staff on screen only (never on the printed card), because the guest
 * ordering page accepts it in its "Table code or the full link" box when a
 * camera will not scan.
 */

export type QrTableData = {
  id: string;
  label: string;
  number: number;
  capacity: number;
  section: string | null;
  isEnabled: boolean;
  status: string;
  disabledReason: string | null;
  publicToken: string;
  qrHref: string;
  rotatedAtLabel: string | null;
};

export function QrCard({
  table,
  selected,
  onToggle,
}: {
  table: QrTableData;
  selected: boolean;
  onToggle: (id: string, next: boolean) => void;
}) {
  const router = useRouter();
  const { busy, error, notice, run, setNotice } = useAdminAction();
  const [imageState, setImageState] = useState<"loading" | "ok" | "failed">("loading");
  const [revision, setRevision] = useState(0);

  // A plain `?r=<n>` cache-buster after a rotation: no token in the query, only a nonce.
  const imageSrc = revision > 0 ? `${table.qrHref}?r=${revision}` : table.qrHref;

  function retryImage() {
    setImageState("loading");
    setRevision((current) => current + 1);
  }

  async function rotateToken() {
    const agreed = window.confirm(
      `Replace table ${table.label}'s ordering code?\n\nEvery QR sticker already printed for this table stops working the moment you confirm — a guest scanning an old one is turned away. The new code must be printed and put on the table straight away.`,
    );
    if (!agreed) return;
    const result = await run("POST", `/api/admin/tables/${table.id}/token`);
    if (result) {
      setImageState("loading");
      setRevision((current) => current + 1);
      setNotice("A new code was issued. Old stickers no longer work — print this card again and remove the old one from the table.");
      router.refresh();
    }
  }

  return (
    <section className={`card p-5 ${selected && table.isEnabled ? "" : "opacity-90"} print:break-inside-avoid`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {table.isEnabled ? (
            <input
              id={`${table.id}-pick`}
              type="checkbox"
              className="mt-1 h-4 w-4 accent-current"
              checked={selected}
              onChange={(event) => onToggle(table.id, event.target.checked)}
            />
          ) : null}
          <div>
            <label htmlFor={`${table.id}-pick`} className="block text-lg font-bold">
              Table {table.label}
            </label>
            <p className="hint mt-0.5">
              {table.section ? table.section : "Unassigned section"} · seats {table.capacity} · no. {table.number}
            </p>
          </div>
        </div>
        {!table.isEnabled ? <span className="badge badge-closed">Out of service</span> : null}
        {table.isEnabled && table.status === "CLEANING" ? <span className="badge">Being cleared</span> : null}
      </div>

      {!table.isEnabled ? (
        <p className="hint mt-2">
          {table.disabledReason ?? "Disabled by staff"}. This code is excluded from the printed sheet and from the bulk
          data: a phone scanning it is told the table is closed for ordering.
        </p>
      ) : table.status === "CLEANING" ? (
        <p className="hint mt-2">While the table is marked as being cleared, a scan is refused until staff open it.</p>
      ) : null}

      <div className="mt-3 flex flex-col items-center gap-2 rounded-md border border-dashed border-line bg-white p-4 print:border-solid">
        {/* eslint-disable-next-line @next/next/no-img-element -- server-generated QR PNG from the signed-in admin route; not an optimisable asset, and the token must stay out of the URL */}
        <img
          src={imageSrc}
          alt={`QR code for table ${table.label}`}
          width={160}
          height={160}
          className="rounded border border-line bg-white"
          onLoad={() => setImageState("ok")}
          onError={() => setImageState("failed")}
        />
        {imageState === "loading" ? <p className="hint">Loading the code…</p> : null}
        {imageState === "failed" ? (
          <p className="notice notice-error w-full text-center">
            This code could not be fetched. The sign-in has probably ended or the public site address is not a full
            URL — reload the page, sign in again, or fix the address in settings.{" "}
            <button type="button" className="btn btn-ghost btn-sm" onClick={retryImage}>
              Try the image again
            </button>
          </p>
        ) : null}
        <p className="text-center text-sm font-semibold">Scan to order at this table</p>
      </div>

      <div className="mt-3 rounded-md border border-line p-3 print:hidden">
        <p className="label">Table code — staff reference only</p>
        <p className="break-all font-mono text-sm soft">{table.publicToken}</p>
        <p className="hint mt-1">
          If a camera will not scan, the guest types this exact code (or the whole ordering link) into the “Join
          table” box on the ordering page. It is a credential: never write it onto the sticker itself or anywhere a
          guest can photograph it.
        </p>
        {table.rotatedAtLabel ? (
          <p className="hint mt-1">
            This table&apos;s code was replaced on {table.rotatedAtLabel}. The app does not record when a sticker was
            printed, so it cannot say whether the one on the table is current — when in doubt, reprint and remove the
            old copy.
          </p>
        ) : (
          <p className="hint mt-1">This table&apos;s code has never been replaced since it was created.</p>
        )}
      </div>

      {notice ? <p className="notice notice-ok mt-2 print:hidden">{notice}</p> : null}
      {error ? <p className="notice notice-error mt-2 print:hidden">{error}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <a href={table.qrHref} download={`table-${table.label}.png`} className="btn btn-outline btn-sm">
          Download this code
        </a>
        {table.isEnabled ? (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={rotateToken}>
            {busy ? "Working…" : "Issue a new code"}
          </button>
        ) : null}
      </div>
      <p className="hint mt-2 print:hidden">
        A download only proves itself: open the saved file and check a code appears before sticking it on a table.
      </p>
    </section>
  );
}
