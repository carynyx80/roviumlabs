// Local PostgreSQL for development without Docker.
//
// Uses the PostgreSQL binaries shipped by the `embedded-postgres` package and runs the
// server as a daemon via pg_ctl (logs in .data/postgres.log), so it keeps running
// independently of this script. Data persists in ./.data/postgres.
//
//   npm run db:dev          start (initialises the cluster on first run)
//   npm run db:dev -- stop  stop
//   npm run db:dev -- status
//
// Production must use a managed PostgreSQL instance (see docs/DEPLOYMENT.md).
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".data/postgres");
const logFile = path.resolve(".data/postgres.log");
const port = Number(process.env.DEV_PG_PORT ?? 5433);
const cmd = process.argv[2] ?? "start";

function binDir() {
  const platformPkg = {
    win32: "@embedded-postgres/windows-x64",
    darwin: process.arch === "arm64" ? "@embedded-postgres/darwin-arm64" : "@embedded-postgres/darwin-x64",
    linux: process.arch === "arm64" ? "@embedded-postgres/linux-arm64" : "@embedded-postgres/linux-x64",
  }[process.platform];
  const root = path.resolve("node_modules", platformPkg);
  const bin = path.join(root, "native", "bin");
  if (!existsSync(bin)) throw new Error(`PostgreSQL binaries not found in ${bin}`);
  return bin;
}

const pgCtl = path.join(binDir(), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
const run = (args, opts = {}) => execFileSync(pgCtl, args, { stdio: "inherit", ...opts });

function isRunning() {
  try {
    execFileSync(pgCtl, ["status", "-D", dataDir], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (cmd === "status") {
  console.log(isRunning() ? "[dev-db] running" : "[dev-db] stopped");
  process.exit(0);
}

if (cmd === "stop") {
  if (isRunning()) run(["stop", "-D", dataDir, "-m", "fast"]);
  console.log("[dev-db] stopped");
  process.exit(0);
}

const fresh = !existsSync(path.join(dataDir, "PG_VERSION")) || readdirSync(dataDir).length === 0;
if (fresh) {
  // embedded-postgres handles initdb (user/password/auth) on first run.
  // UTF-8 explicitly: on Windows initdb otherwise inherits the system code page (e.g. WIN1252),
  // which cannot store many characters that AI output and provider data contain.
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "rovium",
    password: "rovium",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("roviumpad");
  await pg.stop();
}

if (isRunning()) {
  console.log(`[dev-db] already running on port ${port}`);
} else {
  // stdio ignored so the daemon does not hold this process's pipes open.
  run(["start", "-D", dataDir, "-l", logFile, "-w", "-o", `-p ${port}`], { stdio: "ignore", windowsHide: true });
}
const enc = (() => {
  try {
    return readFileSync(path.join(dataDir, "postgresql.conf"), "utf8").match(/^lc_ctype = '([^']+)'/m)?.[1] ?? "";
  } catch {
    return "";
  }
})();
if (enc && !/^C$|utf-?8/i.test(enc)) {
  console.warn(`[dev-db] WARNING: cluster locale is ${enc}. Databases must be UTF8; see README ("Database encoding").`);
}
console.log(`[dev-db] PostgreSQL ready: postgresql://rovium:rovium@localhost:${port}/roviumpad (logs: .data/postgres.log)`);
