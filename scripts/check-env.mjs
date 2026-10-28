// Reports which environment variables the app needs, without ever printing a
// value. Run before a deploy: `npm run env:check`.
//
// Exits 1 when a variable the server cannot start without is missing.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Next reads its dotenv files in a fixed order and keeps the first definition of a
 * key it finds, so a line in a higher-priority file wins over the same line in a
 * lower one — including when it is blank. That order, taken from `@next/env`
 * itself, is: the real process environment, then `.env.<mode>.local`, then
 * `.env.local` (except in test mode), then `.env.<mode>`, then `.env`.
 *
 * `npm run env:check` is a deploy-time command, so with NODE_ENV unset it reports
 * what `next start` would see: production mode.
 */
function mode() {
  if (process.env.NODE_ENV === "test") return "test";
  if (process.env.NODE_ENV === "development") return "development";
  return "production";
}

const FILES = (() => {
  const current = mode();
  return [`.env.${current}.local`, current !== "test" ? ".env.local" : null, `.env.${current}`, ".env"].filter(
    Boolean,
  );
})();

/**
 * A value is read the way `dotenv` reads it: a quoted value keeps everything up to
 * its closing quote, an unquoted one ends at the first `#`. Getting this wrong would
 * report a real secret as blank, which is the one thing this script must not do.
 */
function readValue(afterEquals) {
  const text = afterEquals.trimStart();
  const quote = text[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const closing = text.indexOf(quote, 1);
    return closing === -1 ? text.slice(1) : text.slice(1, closing);
  }
  const comment = text.indexOf("#");
  return (comment === -1 ? text : text.slice(0, comment)).trim();
}

function parseEnvFile(file) {
  const entries = new Map();
  for (const line of fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/i.exec(line);
    if (!match) continue;
    if (entries.has(match[1])) continue;
    entries.set(match[1], readValue(match[2]));
  }
  return entries;
}

/** name -> { file, value }, first definition wins; only files that exist are read. */
const parsed = new Map();
const definitions = new Map();
const present = [];
for (const file of FILES) {
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  present.push(file);
  const entries = parseEnvFile(file);
  parsed.set(file, entries);
  for (const [name, value] of entries) {
    if (!definitions.has(name)) definitions.set(name, { file, value });
  }
}

/**
 * A key's effective value, following the same precedence the server would: a
 * variable already in the shell — even an empty one — outranks every file.
 */
function effective(name) {
  if (name in process.env) {
    const raw = process.env[name] ?? "";
    return { value: raw.trim() === "" ? undefined : raw.trim(), source: "the shell", blank: raw.trim() === "" };
  }
  const entry = definitions.get(name);
  if (!entry) return { value: undefined, source: null, blank: false };
  return { value: entry.value.trim() === "" ? undefined : entry.value.trim(), source: entry.file, blank: entry.value.trim() === "" };
}

/**
 * The trap this exists to catch: `.env` carries a real value, a file that outranks it
 * names the same key with nothing after the `=`, and the capability quietly switches
 * off while the operator is reading a file that looks correct. Only key names and
 * file names are reported, never values.
 */
function shadowed(name) {
  const entry = definitions.get(name);
  if (!entry || entry.value.trim() !== "") return null;
  for (const later of present.slice(present.indexOf(entry.file) + 1)) {
    const value = parsed.get(later)?.get(name);
    if (value !== undefined && value.trim() !== "") return { blankFile: entry.file, filledFile: later };
  }
  return null;
}

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
  { name: "ALLOW_SIMULATED_GATEWAY", hint: "Switches the stand-in gateway on. Must stay unset in production." },
  { name: "TRUSTED_PROXY_HOPS", hint: "Proxies in front of this process. 0 means X-Forwarded-For is ignored." },
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
const shadows = [];
console.log("Dhaka Kabab environment check");
console.log(`  mode: ${mode()} (\`next start\` reads production, \`next dev\` reads development)`);
console.log(`  files read: ${present.length ? present.join(", ") : "none (.env / .env.local not found)"}`);
console.log("");
console.log("  Required:");
for (const entry of required) {
  const shadow = shadowed(entry.name);
  const { value, source, blank } = effective(entry.name);
  if (shadow) {
    console.log(`    SHADOWED ${entry.name} — blank in ${shadow.blankFile} hides the value in ${shadow.filledFile}.`);
    shadows.push(entry.name);
    missing += 1;
  } else if (!value) {
    console.log(`    MISSING  ${entry.name} — ${entry.hint}${blank ? ` (named but blank in ${source})` : ""}`);
    missing += 1;
  } else if (entry.minLength && value.length < entry.minLength) {
    console.log(`    WEAK     ${entry.name} — ${value.length} characters, needs ${entry.minLength}.`);
    missing += 1;
  } else {
    console.log(`    ok       ${entry.name} (${value.length} characters, value not shown)`);
  }
}
console.log("");
console.log("  Optional (capability is off while unset):");
for (const entry of optional) {
  const shadow = shadowed(entry.name);
  if (shadow) {
    console.log(`    SHADOWED ${entry.name} — blank in ${shadow.blankFile} hides the value in ${shadow.filledFile}.`);
    shadows.push(entry.name);
    continue;
  }
  console.log(`    ${effective(entry.name).value ? "set     " : "unset   "} ${entry.name} — ${entry.hint}`);
}

const appUrl = effective("NEXT_PUBLIC_APP_URL").value;
if (appUrl && /localhost|127\.0\.0\.1/.test(appUrl)) {
  console.log("");
  console.log(`  WARNING  NEXT_PUBLIC_APP_URL points at ${appUrl}; printed QR codes and`);
  console.log("           gateway callbacks will not work from another device.");
}

if (shadows.length > 0) {
  console.log("");
  console.log(`  ${shadows.length} key(s) are blanked by a file that outranks the one holding their value:`);
  console.log(`  ${shadows.join(", ")}. Delete the blank line, or fill it in.`);
}

console.log("");
if (missing > 0) {
  console.log(`  ${missing} required setting(s) need attention.`);
  process.exit(1);
}
console.log("  Environment is sufficient to start.");
