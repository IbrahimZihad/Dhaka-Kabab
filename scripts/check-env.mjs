// Reports which environment variables the app needs, without ever printing a
// value. Run before a deploy: `npm run env:check`.
//
// Exits 1 when a variable the server cannot start without is missing.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^"|"$/g, "");
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
  return true;
}

const loaded = [".env.local", ".env"].filter((file) => loadEnvFile(path.join(ROOT, file)));

const value = (name) => {
  const raw = process.env[name];
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
};

const required = [
  { name: "DATABASE_URL", hint: "PostgreSQL connection string used by Prisma." },
  { name: "AUTH_SECRET", hint: "At least 32 characters; `openssl rand -base64 32`.", minLength: 32 },
];

// Everything below is optional but switches a capability off when absent, which
// is exactly what an operator needs to know before going live.
const optional = [
  { name: "NEXT_PUBLIC_APP_URL", hint: "Public base URL. Gateway callbacks and QR codes point here." },
  { name: "SSLCOMMERZ_STORE_ID", hint: "Together with the API key, enables real online payment." },
  { name: "SSLCOMMERZ_API_KEY", hint: "Never exposed to the browser." },
  { name: "SSLCOMMERZ_MODE", hint: "sandbox (default) or live." },
  { name: "SMTP_HOST", hint: "Without it, notification emails stay queued and are never sent." },
  { name: "SMTP_USER", hint: "Login for SMTP." },
  { name: "SMTP_PASS", hint: "Password for SMTP." },
  { name: "MAIL_FROM", hint: "Sender address for receipts and booking confirmations." },
  { name: "AI_API_KEY", hint: "Without it the chatbot answers from the database facts only." },
  { name: "AI_MODEL", hint: "Model name for the AI provider." },
  { name: "UPLOAD_DIR", hint: "Where menu pictures are written; default ./storage/uploads." },
  { name: "SESSION_MAX_AGE_SECONDS", hint: "Staff/customer session lifetime; default 12h." },
  { name: "TEST_DATABASE_URL", hint: "Separate database for integration tests." },
];

let missing = 0;
console.log("Dhaka Kabab environment check");
console.log(`  files read: ${loaded.length ? loaded.join(", ") : "none (.env / .env.local not found)"}`);
console.log("");
console.log("  Required:");
for (const entry of required) {
  const raw = value(entry.name);
  if (!raw) {
    console.log(`    MISSING  ${entry.name} — ${entry.hint}`);
    missing += 1;
  } else if (entry.minLength && raw.length < entry.minLength) {
    console.log(`    WEAK     ${entry.name} — ${raw.length} characters, needs ${entry.minLength}.`);
    missing += 1;
  } else {
    console.log(`    ok       ${entry.name} (${raw.length} characters, value not shown)`);
  }
}
console.log("");
console.log("  Optional (capability is off while unset):");
for (const entry of optional) {
  const raw = value(entry.name);
  console.log(`    ${raw ? "set     " : "unset   "} ${entry.name} — ${entry.hint}`);
}

const appUrl = value("NEXT_PUBLIC_APP_URL");
if (appUrl && /localhost|127\.0\.0\.1/.test(appUrl)) {
  console.log("");
  console.log(`  WARNING  NEXT_PUBLIC_APP_URL points at ${appUrl}; printed QR codes and`);
  console.log("           gateway callbacks will not work from another device.");
}

console.log("");
if (missing > 0) {
  console.log(`  ${missing} required setting(s) need attention.`);
  process.exit(1);
}
console.log("  Environment is sufficient to start.");
