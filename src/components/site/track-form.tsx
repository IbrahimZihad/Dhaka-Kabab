"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Looks an order up by the code on its confirmation. The code is the long string
 * in that page&apos;s link, not the short order number — the order number is
 * printed on receipts and would be guessable.
 */
export function TrackForm({
  initial,
  basePath = "/track",
  placeholder = "Order code from your confirmation",
  button = "Find my order",
  help = "That does not look like a code. It is the long link we sent you, not the short number printed on it.",
}: {
  initial?: string;
  basePath?: string;
  placeholder?: string;
  button?: string;
  help?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const token = value.trim();
    if (!/^[A-Za-z0-9]{8,64}$/.test(token)) {
      setError(help);
      return;
    }
    router.push(`${basePath}/${encodeURIComponent(token)}`);
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap gap-2 p-4">
      <input
        className="input flex-1"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <button type="submit" className="btn btn-primary">
        {button}
      </button>
      {error ? <p className="notice notice-error w-full">{error}</p> : null}
    </form>
  );
}
