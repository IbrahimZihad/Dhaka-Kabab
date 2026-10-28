import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Test harness. Two projects so `npm run test:unit` and `npm run test:integration`
 * can never pick up each other's files: the include patterns are the boundary,
 * on top of the path filter each npm script passes on the command line.
 *
 * Unit tests stay pure — no database, no network, no wall clock inside an
 * assertion (anything time dependent takes an explicit `now`).
 */

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` -> `./src/*` mapping in tsconfig.json, so tests import
    // the same paths the app does.
    alias: { "@": path.join(rootDir, "src") },
  },
  test: {
    environment: "node",
    // Exposes the two `describe.each`/`it.each` helpers we rely on and keeps
    // assertion messages readable without importing chai plugins.
    globals: false,
    setupFiles: ["tests/setup/load-env.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          // Every integration file writes to one shared database and the settings
          // singleton, and `queueNotification` fans staff mail out to *every* active
          // staff account in that database. Left parallel, one file can insert a
          // notification addressed to another file's staff email after that file has
          // already run its teardown, so `findResidue()` reports a row it never owns.
          // Serialized files remove the race: a file's staff accounts only exist
          // during that file, so no other file can notify them.
          fileParallelism: false,
        },
      },
    ],
  },
});
