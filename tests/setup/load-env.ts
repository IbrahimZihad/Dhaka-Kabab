import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads the project `.env` before any test file is imported, the same way
 * `scripts/db-setup.mjs` does it, so modules that read configuration at import
 * time see the same values the app sees.
 *
 * This file is the only place that touches `.env` during a test run and it must
 * never write an environment value anywhere: no console output, no error
 * message that interpolates a secret. A variable name is safe to mention, a
 * value is not.
 */

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));

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

loadEnvFile(envFile);
loadEnvFile(fileURLToPath(new URL("../../.env.local", import.meta.url)));
