import path from "node:path";

import "./load-env";

/**
 * Everything the suite needs to know about *this* machine, and nothing about a
 * real restaurant. Each value may be overridden from the environment so the suite
 * can be pointed at another installation without editing a spec.
 */

/** The developer's Next.js server. `127.0.0.1` avoids a `localhost`/IPv6 mismatch. */
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

/** Health probe — the address Playwright asks before deciding to start a server. */
export const E2E_HEALTH_URL = new URL("/api/health", E2E_BASE_URL).toString();

/** Repo root, for shelling out to the project's own scripts. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Sign-in states, kept under `test-results/` (already git-ignored) so no session
 * cookie ever lands in the working tree.
 */
export const AUTH_DIR = path.join(REPO_ROOT, "test-results", "e2e-auth");

export function authStatePath(role: "owner" | "kitchen"): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

export type StaffCredential = { email: string; password: string };

/**
 * The two logins the suite signs in with, read from the environment only.
 *
 * `owner` is deliberately *not* given a fallback: the account and its password are
 * the developer's own, they live in the gitignored `.env`, and a hardcoded guess
 * would let a broken door look like a passing test. Asking for it is what raises,
 * and the message names the variables — never their values.
 *
 * `kitchen` is a local account the suite creates for itself through the project's
 * own bootstrap script, so its details are invented here rather than borrowed.
 */
export const CREDENTIALS: { owner: StaffCredential; kitchen: StaffCredential & { name: string; role: string } } = {
  get owner(): StaffCredential {
    const email = process.env.E2E_OWNER_EMAIL;
    const password = process.env.E2E_OWNER_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "The staff journey needs E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD in .env (or the real environment). " +
          "Neither value is ever echoed by this suite.",
      );
    }
    return { email, password };
  },
  kitchen: {
    name: process.env.E2E_KITCHEN_NAME ?? "IT Kitchen",
    email: process.env.E2E_KITCHEN_EMAIL ?? "it.kitchen@localhost.dev",
    password: process.env.E2E_KITCHEN_PASSWORD ?? "KitchenLocal2026pass",
    role: "KITCHEN",
  },
};

/** Same pair, spelled as a function for specs that want the failure at the call site. */
export function ownerCredential(): StaffCredential {
  return CREDENTIALS.owner;
}

/**
 * The app's own refresh budgets. A spec waits for a change at most
 * `interval + margin`, and never sleeps to cover a race it cannot observe.
 */
export const POLL = {
  /** `TableOrder` re-reads the session every 8s. */
  table: 8_000,
  /** `LiveOrder` re-reads the public order endpoint every 10s. */
  tracking: 10_000,
  /** `KitchenQueue` polls `/api/kitchen/queue` every 15s. */
  kitchen: 15_000,
  /** Room for a cold server's first hit on a screen and one slow query. */
  margin: 25_000,
} as const;

/** Wait budget for "the app's own polling must notice". */
export const REFRESH_TIMEOUT = POLL.kitchen + POLL.margin;
