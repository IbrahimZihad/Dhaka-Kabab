"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { MenuImage } from "@/components/ui/menu-image";

/**
 * Attaching a picture to a dish or section.
 *
 * Two honest ways, both backed by routes that already exist:
 *   1. upload a file, which the /uploads route stores under a name WE generate
 *      and returns as a /api/media URL;
 *   2. point at a picture already on the server — either a path/URL typed in, or
 *      one chosen from the /media listing.
 *
 * Nothing is kept in the browser: the chosen URL lives in the parent form's state
 * and is sent with the record, so a picture only becomes permanent when the dish
 * itself is saved.
 */

type MediaEntry = { filename: string; bytes: number; referenced: boolean };

export function MenuImageUpload({
  id,
  value,
  onChange,
  alt,
}: {
  id: string;
  value: string | null;
  onChange: (url: string | null) => void;
  alt: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<MediaEntry[] | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);

  async function uploadFile(file: File) {
    setUploading(true);
    setFailure(null);
    setStatus(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("/api/admin/uploads", { method: "POST", body: form });
      const parsed = (await response.json().catch(() => null)) as
        | { ok?: boolean; data?: { url?: string }; error?: { message?: string } }
        | null;
      if (response.ok && parsed?.ok && parsed.data?.url) {
        onChange(parsed.data.url);
        setStatus("Picture uploaded. It is attached once you save the dish.");
      } else {
        setFailure(parsed?.error?.message ?? "The picture could not be uploaded.");
      }
    } catch {
      setFailure("We could not reach the server to upload the picture.");
    } finally {
      setUploading(false);
    }
  }

  async function loadMedia() {
    setMediaLoading(true);
    setFailure(null);
    const response = await apiFetch<{ files: MediaEntry[] }>("/api/admin/media", { method: "GET" });
    setMediaLoading(false);
    if (!response.ok) {
      setFailure(response.error.message || "The stored pictures could not be listed.");
      return;
    }
    setMediaFiles(response.data.files);
  }

  function openBrowser() {
    const next = !browsing;
    setBrowsing(next);
    if (next && mediaFiles === null) void loadMedia();
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor={`${id}-file`}>
            Upload a picture
          </label>
          <input
            id={`${id}-file`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
              event.target.value = "";
            }}
          />
          <p className="hint mt-1">JPEG, PNG or WebP, under 6 MB. The server names and stores it.</p>
          {uploading ? <p className="hint mt-1">Uploading the picture…</p> : null}
        </div>

        <div>
          <label className="label" htmlFor={`${id}-url`}>
            Or paste a picture path or address
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${id}-url`}
              className="input grow"
              autoComplete="off"
              maxLength={500}
              placeholder="/api/media/…  or https://…"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!pasted.trim()}
              onClick={() => {
                const trimmed = pasted.trim();
                if (!trimmed) return;
                onChange(trimmed);
                setPasted("");
                setFailure(null);
                setStatus("Picture address set. It is attached once you save the dish.");
              }}
            >
              Use this address
            </button>
          </div>
          <p className="hint mt-1">A stored picture lives under /api/media/. A saved address becomes permanent only on save.</p>
        </div>

        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={openBrowser} disabled={mediaLoading}>
            {browsing ? "Hide stored pictures" : "Choose a stored picture"}
          </button>
          {browsing ? (
            <div className="mt-2 rounded-md border border-line p-2">
              {mediaLoading ? <p className="hint">Reading the store…</p> : null}
              {!mediaLoading && mediaFiles && mediaFiles.length === 0 ? (
                <p className="hint">Nothing has been uploaded yet. Upload one above, or paste an address.</p>
              ) : null}
              {!mediaLoading && mediaFiles && mediaFiles.length > 0 ? (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {mediaFiles.map((entry) => (
                    <li key={entry.filename}>
                      <button
                        type="button"
                        className={`btn w-full btn-sm ${value === `/api/media/${entry.filename}` ? "btn-primary" : "btn-outline"}`}
                        onClick={() => {
                          onChange(`/api/media/${entry.filename}`);
                          setStatus("Stored picture chosen. It is attached once you save the dish.");
                        }}
                        title={entry.referenced ? "Already used by a dish or section" : "Not currently used"}
                      >
                        {entry.filename.slice(0, 12)}… · {Math.max(1, Math.round(entry.bytes / 1024))} KB
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        {failure ? <p className="notice notice-error">{failure}</p> : null}
        {status && !failure ? <p className="hint">{status}</p> : null}

        {value ? (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => { onChange(null); setStatus(null); setFailure(null); }}>
            Remove picture
          </button>
        ) : null}
      </div>

      <div className="w-48">
        <p className="label mb-1">Preview</p>
        <MenuImage src={value} alt={alt} width={192} height={128} className="h-32 w-48 rounded object-cover" />
      </div>
    </div>
  );
}
