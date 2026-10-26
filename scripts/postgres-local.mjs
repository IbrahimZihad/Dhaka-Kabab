// Local, project-owned PostgreSQL instance for development and tests.
//
// No system PostgreSQL is required: binaries are unpacked into a user-level
// cache, the data directory stays inside the repository (git-ignored) and the
// server listens on 127.0.0.1 only with trust authentication.
//
//   node scripts/postgres-local.mjs prepare   # fetch/unpack binaries
//   node scripts/postgres-local.mjs init      # initdb the data directory
//   node scripts/postgres-local.mjs start     # start on 127.0.0.1:<port>
//   node scripts/postgres-local.mjs stop
//   node scripts/postgres-local.mjs status

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PGPORT = process.env.DHAKA_KABAB_PG_PORT ?? "55432";
const PGUSER = process.env.DHAKA_KABAB_PG_ROLE ?? "dhaka_kabab";
const DATA_DIR = path.resolve(ROOT, process.env.DHAKA_KABAB_PG_DATA ?? ".pgdata");
const LOG_FILE = path.join(DATA_DIR, "postgres.log");
const CACHE_DIR =
  process.env.DHAKA_KABAB_PG_CACHE ??
  path.join(os.homedir(), ".dhaka-kabab-cache");
const PG_HOME = process.env.DHAKA_KABAB_PG_HOME ?? path.join(CACHE_DIR, "pgsql");
const BIN = path.join(PG_HOME, "bin");
const PG_VERSION = process.env.DHAKA_KABAB_PG_VERSION ?? "16.9";
const PG_ARCHIVE_URL =
  process.env.DHAKA_KABAB_PG_ARCHIVE ??
  `https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-1-windows-x64-binaries.zip`;

const isWindows = process.platform === "win32";
const exe = (name) => path.join(BIN, isWindows ? `${name}.exe` : name);

function hasBinaries() {
  return fs.existsSync(exe("initdb")) && fs.existsSync(exe("pg_ctl"));
}

function requireBinaries() {
  if (!hasBinaries()) {
    throw new Error(
      `PostgreSQL binaries not found in ${BIN}. Run "node scripts/postgres-local.mjs prepare", ` +
        "or point DHAKA_KABAB_PG_HOME at an existing PostgreSQL installation.",
    );
  }
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) from ${url}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  let written = 0;
  let lastReport = 0;
  const stream = fs.createWriteStream(dest);
  for await (const chunk of response.body) {
    written += stream.write(chunk);
    if (total && Date.now() - lastReport > 5000) {
      lastReport = Date.now();
      console.log(`  ${Math.round((written / total) * 100)}% of ${Math.round(total / 1e6)} MB`);
    }
  }
  await new Promise((resolve, reject) => {
    stream.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

function extract(archivePath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (isWindows) {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destination}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } else {
    // The EDB archive is a .zip; unzip is available on most POSIX build images.
    execFileSync("unzip", ["-q", "-o", archivePath, "-d", destination], { stdio: "inherit" });
  }
}

async function prepare() {
  if (hasBinaries()) {
    console.log(`PostgreSQL binaries already present at ${BIN}`);
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const archive = path.join(CACHE_DIR, "postgresql-binaries.zip");
  if (!fs.existsSync(archive)) {
    console.log(`Downloading ${PG_ARCHIVE_URL}`);
    await download(PG_ARCHIVE_URL, archive);
  }
  console.log(`Extracting to ${PG_HOME} (this takes a minute)`);
  extract(archive, PG_HOME);
  fs.rmSync(archive, { force: true });
  if (!hasBinaries()) throw new Error("Extraction finished but binaries are missing.");
  console.log("PostgreSQL binaries ready.");
}

function init() {
  requireBinaries();
  if (fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log(`Data directory already initialised at ${DATA_DIR}`);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  execFileSync(
    exe("initdb"),
    ["-D", DATA_DIR, "-U", PGUSER, "-A", "trust", "-E", "UTF8", "--locale=C"],
    { stdio: "inherit" },
  );
  // Bind to loopback only; the trust auth method above is acceptable solely
  // because the port is not reachable from outside this machine.
  fs.appendFileSync(
    path.join(DATA_DIR, "postgresql.conf"),
    "\nlisten_addresses = '127.0.0.1'\n",
  );
}

function serverRunning() {
  try {
    const out = execFileSync(exe("pg_ctl"), ["-D", DATA_DIR, "status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return /server is running/.test(out);
  } catch {
    return false;
  }
}

function start() {
  requireBinaries();
  init();
  if (serverRunning()) {
    console.log(`PostgreSQL already running on port ${PGPORT}.`);
    return;
  }
  // stdio is deliberately detached: the postmaster inherits the file handles of
  // its parent, so an inherited pipe would never close for callers like `| tail`.
  execFileSync(exe("pg_ctl"), ["-D", DATA_DIR, "-l", LOG_FILE, "-o", `-p ${PGPORT}`, "-w", "start"], {
    stdio: "ignore",
  });
  console.log(`PostgreSQL listening on 127.0.0.1:${PGPORT} (data: ${DATA_DIR})`);
}

function stop() {
  requireBinaries();
  if (!serverRunning()) {
    console.log("PostgreSQL is not running.");
    return;
  }
  execFileSync(exe("pg_ctl"), ["-D", DATA_DIR, "-m", "fast", "stop"], { stdio: "inherit" });
  console.log("PostgreSQL stopped.");
}

export function psql(command, database = "postgres") {
  requireBinaries();
  return execFileSync(exe("psql"), ["-X", "-q", "-h", "127.0.0.1", "-p", PGPORT, "-d", database, "-c", command], {
    encoding: "utf8",
  });
}

export function pgBinariesAvailable() {
  return hasBinaries();
}

const command = process.argv[2];
const handlers = { prepare, init, start, stop };

if (command === "status") {
  console.log(
    JSON.stringify(
      { binaries: hasBinaries(), initialised: fs.existsSync(path.join(DATA_DIR, "PG_VERSION")), running: serverRunning(), port: Number(PGPORT), dataDir: DATA_DIR, pgHome: PG_HOME },
      null,
      2,
    ),
  );
} else if (command && handlers[command]) {
  await handlers[command]();
} else if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  console.error(
    `Usage: node scripts/postgres-local.mjs <${Object.keys(handlers).join("|")}|status>`,
  );
  process.exit(1);
}
