import fs from "node:fs";
import path from "node:path";

/**
 * Loads the project `.env` and then `.env.local` into `process.env` before any
 * Playwright worker is forked, so the suite reads the same configuration the app
 * reads: the staff credential names and `DATABASE_URL`.
 *
 * This mirrors `tests/setup/load-env.ts`. The one difference is mechanical:
 * Playwright transpiles TypeScript down to CommonJS, so the repo root is taken
 * from `__dirname` rather than `import.meta.url`.
 *
 * This module must never write an environment value anywhere — no console line,
 * no error message that interpolates a secret. A variable NAME is safe to
 * mention; a value is not.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const name = match[1];
    const value = match[2].trim().replace(/^"|"$/g, "");
    // Real process env wins, exactly like the app's own loader.
    if (!(name in process.env)) process.env[name] = value;
  }
}

export function loadProjectEnv(): void {
  loadEnvFile(path.join(REPO_ROOT, ".env"));
  loadEnvFile(path.join(REPO_ROOT, ".env.local"));
}

loadProjectEnv();
