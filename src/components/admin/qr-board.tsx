"use client";

import { useState } from "react";
import { QrCard, type QrTableData } from "@/components/admin/qr-card";

/**
 * The sticker board: ticks, counts and the print action. Printing deliberately
 * composes a separate clean sheet inside an off-screen iframe (only the ticked
 * cards, cut-line borders, no panel chrome), because the staff shell around
 * this screen belongs to the layout and must not be edited here. Every card's
 * picture is fetched through the signed-in admin QR route and checked to load
 * before the print dialogue opens — if one fails, nothing is printed and the
 * board says which tables failed.
 */

const PRINT_CARD_PX = 512;

export function QrBoard({
  tables,
  looksLocal,
}: {
  tables: QrTableData[];
  looksLocal: boolean;
}) {
  const printable = tables.filter((table) => table.isEnabled);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(printable.map((table) => table.id)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const chosen = printable.filter((table) => selected.has(table.id));

  function toggle(id: string, next: boolean) {
    setMessage(null);
    setSelected((current) => {
      const updated = new Set(current);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  }

  function selectAll() {
    setSelected(new Set(printable.map((table) => table.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function loadQrAsDataUrl(table: QrTableData): Promise<string> {
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth || PRINT_CARD_PX;
          canvas.height = image.naturalHeight || PRINT_CARD_PX;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no canvas");
          ctx.drawImage(image, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          reject(new Error(table.label));
        }
      };
      image.onerror = () => reject(new Error(table.label));
      image.src = table.qrHref;
    });
  }

  function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) =>
      character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;" : character === '"' ? "&quot;" : "&#39;",
    );
  }

  async function printSheet() {
    setMessage(null);
    setFailure(null);
    if (chosen.length === 0) {
      setFailure("Tick at least one table to print.");
      return;
    }
    setBusy(true);
    const loaded: { table: QrTableData; dataUrl: string }[] = [];
    const failedLabels: string[] = [];
    const results = await Promise.allSettled(chosen.map((table) => loadQrAsDataUrl(table)));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") loaded.push({ table: chosen[index]!, dataUrl: result.value });
      else failedLabels.push(chosen[index]!.label);
    });
    if (failedLabels.length > 0) {
      setBusy(false);
      setFailure(
        `The codes for table(s) ${failedLabels.join(", ")} could not be fetched, so nothing was sent to the printer. ` +
          "Most likely the sign-in has ended or the public site address is not a full URL — reload this page (and sign in again) and try once every card shows its picture.",
      );
      return;
    }
    const cards = loaded
      .map(
        ({ table, dataUrl }) => `<div class="card">
          <p class="name">Table ${escapeHtml(table.label)}</p>
          <img src="${dataUrl}" alt="QR code for table ${escapeHtml(table.label)}" width="168" height="168" />
          <p class="scan">Scan to order at this table</p>
          <p class="meta">${escapeHtml(table.section ?? "Unassigned section")} · seats ${table.capacity} · no. ${table.number}</p>
        </div>`,
      )
      .join("");
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Dhaka Kabab — table QR stickers</title>
<style>
  @page { margin: 10mm; }
  body { font-family: system-ui, sans-serif; color: #111; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6mm; }
  .card { border: 1px dashed #777; border-radius: 3mm; padding: 6mm; text-align: center; break-inside: avoid; }
  .name { font-size: 20pt; font-weight: 700; margin: 0 0 4mm; }
  img { width: 46mm; height: 46mm; }
  .scan { font-size: 11pt; margin: 3mm 0 0; }
  .meta { font-size: 9pt; color: #444; margin: 2mm 0 0; }
</style>
</head>
<body><div class="grid">${cards}</div></body>
</html>`;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.srcdoc = html;
    frame.onload = () => {
      setBusy(false);
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        setMessage(
          `The print dialogue was opened with ${loaded.length} sticker(s). This screen cannot see what the printer did: check the sheets came out and test one code by scanning it before the stickers go on tables.`,
        );
      } catch {
        setFailure("The browser refused to open the print dialogue. Use the browser menu's own Print instead, or tick fewer tables.");
      }
      window.setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4 print:hidden">
        <p className="text-sm soft">
          <strong>{chosen.length}</strong> of {printable.length} in-service table(s) ticked for printing
          {tables.length !== printable.length ? `; ${tables.length - printable.length} out-of-service table(s) cannot be ticked` : ""}.
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={selectAll} disabled={busy || printable.length === 0}>
            Select all
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection} disabled={busy || chosen.length === 0}>
            Clear ticks
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={printSheet} disabled={busy}>
            {busy ? "Checking the codes…" : "Print the ticked stickers"}
          </button>
        </div>
      </div>

      {looksLocal ? (
        <p className="notice notice-error print:hidden">
          The public site address still points at this machine, so every sticker printed now encodes a link a
          guest&apos;s phone cannot open off the restaurant network. Set the real address in the environment before
          printing for service.
        </p>
      ) : null}
      {message ? <p className="notice notice-ok print:hidden">{message}</p> : null}
      {failure ? <p className="notice notice-error print:hidden">{failure}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tables.map((table) => (
          <QrCard key={table.id} table={table} selected={selected.has(table.id)} onToggle={toggle} />
        ))}
      </div>
    </div>
  );
}
