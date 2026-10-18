// One-shot Vercel configuration for RoviumPad (run after `vercel login`):
//
//   node scripts/vercel-setup.mjs [--project roviumlabs] [--rpc <mainnet rpc url>] [--no-redeploy]
//
//  1. links this folder to the Vercel project
//  2. sets NEXT_PUBLIC_CHAINS=robinhood-mainnet,robinhood-testnet (production)
//  3. creates SESSION_SECRET if missing — generated locally and piped straight to Vercel,
//     never printed or written to disk
//  4. sets APP_URL / NEXT_PUBLIC_APP_URL to the production domain if missing
//  5. optionally sets RPC_URL_ROBINHOOD_MAINNET (--rpc)
//  6. reports any other missing required variables
//  7. redeploys the latest production deployment so the new values take effect
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const project = arg("project") ?? "roviumlabs";
const rpc = arg("rpc");
const redeploy = !args.includes("--no-redeploy");
const win = process.platform === "win32";
const npx = win ? "npx.cmd" : "npx";
const log = (s) => console.log(`[vercel-setup] ${s}`);

function vercel(cmdArgs, { input, quiet } = {}) {
  const r = spawnSync(npx, ["-y", "vercel@latest", ...cmdArgs], {
    input,
    encoding: "utf8",
    shell: win,
    stdio: [input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!quiet) process.stdout.write(out.replace(/^.*EBADENGINE.*\n/gm, ""));
  return { ok: r.status === 0, out };
}

const who = vercel(["whoami"], { quiet: true });
if (!who.ok || /logged out/i.test(who.out)) {
  log("Not logged in. Run `npx vercel login` first.");
  process.exit(1);
}
log(`logged in as ${who.out.trim().split("\n").filter((l) => !/warn|>|^\s*$/i.test(l)).pop()}`);

log(`linking to project "${project}"`);
if (!vercel(["link", "--yes", "--project", project]).ok) {
  log(`Could not link project "${project}". Pass the right name with --project <name> (see vercel.com dashboard).`);
  process.exit(1);
}

const ls = vercel(["env", "ls", "production"], { quiet: true }).out;
const has = (name) => new RegExp(`^\\s*${name}\\s`, "m").test(ls);

function setEnv(name, value, { secret = false } = {}) {
  if (has(name)) vercel(["env", "rm", name, "production", "--yes"], { quiet: true });
  const r = vercel(["env", "add", name, "production"], { input: value, quiet: true });
  log(r.ok ? `set ${name}${secret ? " (value hidden)" : `=${value}`}` : `FAILED to set ${name}: ${r.out.split("\n").slice(-3).join(" ")}`);
}

setEnv("NEXT_PUBLIC_CHAINS", "robinhood-mainnet,robinhood-testnet");
if (has("NEXT_PUBLIC_ENABLE_MAINNET")) {
  vercel(["env", "rm", "NEXT_PUBLIC_ENABLE_MAINNET", "production", "--yes"], { quiet: true });
  log("removed NEXT_PUBLIC_ENABLE_MAINNET (mainnet is on unless it is set to false)");
}
if (!has("SESSION_SECRET")) setEnv("SESSION_SECRET", randomBytes(48).toString("base64url"), { secret: true });
else log("SESSION_SECRET already set — kept");
if (rpc) setEnv("RPC_URL_ROBINHOOD_MAINNET", rpc, { secret: true });

// Production domain from the project's latest production deployment.
const deployments = vercel(["ls", "--prod"], { quiet: true }).out;
const latest = deployments.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/i)?.[0];
const inspect = latest ? vercel(["inspect", latest], { quiet: true }).out : "";
const domain = inspect.match(/https:\/\/[a-z0-9-]+\.vercel\.app(?![a-z0-9.-])/gi)?.find((u) => !u.includes("-git-")) ?? latest;
if (domain) {
  if (!has("APP_URL")) setEnv("APP_URL", domain);
  if (!has("NEXT_PUBLIC_APP_URL")) setEnv("NEXT_PUBLIC_APP_URL", domain);
}

const missing = ["DATABASE_URL", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"].filter((k) => !has(k));
if (missing.length) log(`STILL MISSING (add these yourself in Vercel → Settings → Environment Variables): ${missing.join(", ")}`);

if (redeploy && latest) {
  log(`redeploying ${latest} to production so the new values are built in…`);
  vercel(["redeploy", latest, "--target", "production"]);
} else if (!latest) {
  log("No production deployment found to redeploy — push a commit or deploy from the Vercel dashboard.");
}
if (domain) log(`When the deployment finishes, open ${domain}/status`);
try {
  execFileSync("git", ["status", "--porcelain", ".vercel"], { stdio: "ignore" });
} catch {
  /* not a git checkout */
}
