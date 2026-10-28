import { defineConfig, devices } from "@playwright/test";

import { E2E_BASE_URL, E2E_HEALTH_URL } from "./tests/e2e/support/env";

/**
 * End-to-end suite for the restaurant, driven against a real Next.js server and
 * the real development database behind it.
 *
 * Deliberate choices:
 *
 * - The server under test is the **production** one: `npm run build` then
 *   `npm run start`. Set `E2E_DEV_SERVER=1` to point the suite at `npm run dev`
 *   instead. Production is the default because `next dev` cannot carry this suite on
 *   this machine, and the reason is measured, not assumed (see
 *   `test-results/e2e-blocker-evidence.md`): over `127.0.0.1` the dev-only origin
 *   guard refuses every `/_next/hmr` handshake a browser asks for, and over
 *   `localhost` the dev runtime answers each subscribe with a `restart` for the
 *   entry chunk, which the client performs as a full document reload — about twelve
 *   a second, forever. A page that never finishes hydrating turns the login button
 *   into a native form submission, so a dev-server run tests the dev runtime rather
 *   than the restaurant. The shipped artifact has no HMR socket and no dev guard.
 * - `reuseExistingServer: true` with the probe on `/api/health`. When something
 *   already answers on the port the suite borrows it and never sends it a signal;
 *   only an installation with nothing there gets its own server, built, started and
 *   stopped by the suite.
 * - `fullyParallel: false`, one worker. The honest setting, not a conservative
 *   one: every spec writes rows into the *same* development database, the app
 *   rate-limits by IP in process memory (login, order, reservation, table join,
 *   chat each have their own window), and two journeys racing over one table's
 *   session produce failures that mean nothing. There is no parallel mode here
 *   because there is no isolated second database to run it against.
 * - Long first-hit budgets. A cold production server still warms its caches on the
 *   first request to each screen, and the kitchen, table and tracking screens poll
 *   on their own timers (15s / 8s / 10s), so waiting is budgeted rather than slept
 *   through. The web-server timeout additionally covers a full route build.
 * - Environment wiring: this file imports `tests/e2e/support/env`, which loads `.env`
 *   and then `.env.local` into `process.env` in the runner before any worker starts,
 *   and every spec imports the same support module, so a worker re-derives the same
 *   values (`E2E_OWNER_EMAIL`, `DATABASE_URL`) after it is forked. Playwright 1.64
 *   types `env` for the web server only, so there is no top-level `env` to set; the
 *   loader is what makes the variables visible to a spec, and no value is ever
 *   printed by it.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: "./test-results/e2e",
  reporter: "list",
  use: {
    baseURL: E2E_BASE_URL,
    headless: true,
    viewport: { width: 1366, height: 1100 },
    actionTimeout: 20_000,
    navigationTimeout: 90_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "staff-states",
      testMatch: /support[\\/]auth\.setup\.ts/,
    },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["staff-states"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env.E2E_DEV_SERVER === "1" ? "npm run dev" : "npm run build && npm run start",
    url: E2E_HEALTH_URL,
    reuseExistingServer: true,
    timeout: process.env.E2E_DEV_SERVER === "1" ? 180_000 : 900_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
