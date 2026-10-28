"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * A failure is reported as a failure. The stack stays on the server (Next logs
 * it); a guest gets a way back to a working door rather than a blank page or a
 * technical message that leaks internals.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[site-error]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="shell max-w-xl py-20 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong on our side</h1>
      <p className="mt-2 text-sm soft">
        The order was not placed and nothing was charged. If you were at a table, tell a member of staff — they can
        take the order without this website.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-outline">
          Home
        </Link>
        <Link href="/menu" className="btn btn-ghost">
          Menu
        </Link>
      </div>
      {error.digest ? <p className="hint mt-6">Reference {error.digest} — quote this if you ask us what happened.</p> : null}
    </div>
  );
}
