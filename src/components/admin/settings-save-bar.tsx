"use client";

/**
 * The save row every settings section ends with. It refuses to look successful
 * before the server answers: while a save is running the button is disabled and
 * reads &ldquo;Saving&hellip;&rdquo;; the notice only ever holds text composed after a 2xx, and
 * an error shows the server&apos;s own message with the edited values left in place.
 *
 * Problems listed here are this screen&apos;s courtesy checks mirroring the server&apos;s
 * bounds; the server remains the authority and its refusal is what finally displays.
 */
export function SettingsSaveBar({
  busy,
  error,
  notice,
  problems,
  label,
  onReset,
  hint,
}: {
  busy: boolean;
  error: string | null;
  notice: string | null;
  problems: string[];
  label: string;
  onReset: () => void;
  hint?: string;
}) {
  const blocked = problems.length > 0;
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      {blocked ? (
        <div className="notice notice-error">
          <p className="font-semibold">This section is not ready to send:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice notice-ok">{notice}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy || blocked}>
          {busy ? "Saving…" : label}
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onReset}>
          Discard my changes
        </button>
      </div>

      {hint ? <p className="hint">{hint}</p> : null}
      <p className="hint">
        Nothing changes until the server accepts this request. If it refuses, the message above is its own words and
        your edits stay on screen.
      </p>
    </div>
  );
}
