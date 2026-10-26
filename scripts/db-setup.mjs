// Creates the local development and test databases (idempotent).
//
//   node scripts/db-setup.mjs            # ensure dev + test databases exist
//   node scripts/db-setup.mjs --reset    # drop and recreate both

import { Client } from "pg";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PGPORT = process.env.DHAKA_KABAB_PG_PORT ?? "55432";
const ROLE = process.env.DHAKA_KABAB_PG_ROLE ?? "dhaka_kabab";
const DEV_DB = process.env.DHAKA_KABAB_PG_DEV_DB ?? "dhaka_kabab";
const TEST_DB = process.env.DHAKA_KABAB_PG_TEST_DB ?? "dhaka_kabab_test";
const reset = process.argv.includes("--reset");

// Load .env so the script can be run bare with `node` (Next and Prisma both
// read .env from the project root; .env.local overrides it).
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^"|"$/g, "");
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}
loadEnvFile(path.join(ROOT, ".env"));

function writeEnvFile() {
  const envPath = path.join(ROOT, ".env");
  let contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

  const required = [
    ["DATABASE_URL", `postgresql://${ROLE}@127.0.0.1:${PGPORT}/${DEV_DB}?schema=public`],
    ["TEST_DATABASE_URL", `postgresql://${ROLE}@127.0.0.1:${PGPORT}/${TEST_DB}?schema=public`],
    ["NEXT_PUBLIC_APP_URL", "http://localhost:3000"],
    ["NEXT_PUBLIC_REALTIME_POLL_INTERVAL_MS", "2500"],
  ];

  if (!/^[A-Za-z0-9+/=]{32,}/m.test(contents) && !process.env.AUTH_SECRET) {
    // 32-byte random secret for session signing; generated once, never logged.
    required.push(["AUTH_SECRET", crypto.randomBytes(32).toString("base64")]);
  }

  for (const [key, value] of required) {
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(contents)) {
      contents = contents.replace(pattern, `${key}="${value}"`);
    } else {
      contents = `${contents.replace(/\s*$/, "")}\n${key}="${value}"\n`;
    }
  }
  fs.writeFileSync(envPath, contents, "utf8");
  console.log(`.env updated (${required.map(([k]) => k).join(", ")})`);
}

async function main() {
  // initdb creates this role as superuser; locally it is the only role.
  const client = new Client({ connectionString: `postgresql://${ROLE}@127.0.0.1:${PGPORT}/postgres` });
  await client.connect();

  for (const database of [DEV_DB, TEST_DB]) {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (reset && exists.rowCount > 0) {
      await client.query(`DROP DATABASE ${database} WITH (FORCE)`);
      console.log(`dropped ${database}`);
    }
    if ((await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database])).rowCount === 0) {
      await client.query(`CREATE DATABASE ${database} OWNER ${ROLE}`);
      console.log(`created ${database}`);
    } else {
      console.log(`${database} already exists`);
    }
  }
  await client.end();

  writeEnvFile();

  // Apply migrations and generate the client through the project's own CLI.
  const run = (args) => {
    const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  };
  run(["generate"]);
  run(["migrate", "deploy"]);
  console.log("Databases ready.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
