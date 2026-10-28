import { mkdirSync } from "node:fs";

import { AUTH_DIR, E2E_BASE_URL } from "./env";

/**
 * Guard rail, not a boot script.
 *
 * The developer's `next dev` server normally owns port 3000 and is already
 * serving the database this suite reads and writes. Rather than start a second
 * one — or kill the one that is running — this asks the address a question and
 * refuses to run specs against a server that is not there, so a failure names the
 * real cause instead of the first navigation that timed out.
 */
export default async function preflight(): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });

  const probeUrl = new URL("/menu", E2E_BASE_URL).toString();
  let answer: Response | undefined;
  try {
    answer = await fetch(probeUrl, { signal: AbortSignal.timeout(60_000) });
  } catch (cause) {
    throw new Error(
      `The end-to-end suite expects a Next.js server at ${E2E_BASE_URL}, ` +
        `and ${probeUrl} did not answer (${cause instanceof Error ? cause.message : String(cause)}). ` +
        "Start `npm run dev` yourself, or point the suite at another installation with E2E_BASE_URL.",
    );
  }

  if (!answer.ok) {
    throw new Error(
      `${probeUrl} answered ${answer.status}. The dev server is up but the menu route is not usable, ` +
        "so end-to-end specs would report an app problem rather than their own. Check the dev log before re-running.",
    );
  }
}
