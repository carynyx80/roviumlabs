// Build entry point used by Vercel (`npm run vercel-build`).
//
//  1. prisma generate
//  2. prisma migrate deploy — only if a database is configured. Uses DIRECT_URL when set,
//     because pooled connection strings (PgBouncer / Neon "-pooler" hosts) cannot run migrations.
//     A migration problem is reported loudly but does not fail the build, so the site still
//     deploys and /api/health shows what is wrong.
//  3. next build
//
// It also prints a checklist of required environment variables, so a misconfigured project
// shows exactly what is missing in the Vercel build log.
import { execSync } from "node:child_process";

const run = (cmd, env = process.env) => execSync(cmd, { stdio: "inherit", env });
const line = (s = "") => console.log(`[rovium-build] ${s}`);

const REQUIRED = [
  ["DATABASE_URL", "PostgreSQL connection string (required for the app to work)"],
  ["SESSION_SECRET", "48+ random characters — the app refuses to start in production without it"],
  ["APP_URL", "your public URL, e.g. https://roviumlabs.vercel.app"],
  ["NEXT_PUBLIC_APP_URL", "same as APP_URL"],
  ["NEXT_PUBLIC_CHAINS", "e.g. robinhood-testnet"],
];
const OPTIONAL = [
  ["LLM_API_KEY", "AI research and chat (without it agents use the labelled mechanical fallback)"],
  ["DIRECT_URL", "non-pooled Postgres URL used for migrations (recommended with Neon/Supabase poolers)"],
  ["ADMIN_WALLETS", "your wallet address for the admin console"],
];

line("Environment check:");
const missing = REQUIRED.filter(([k]) => !process.env[k]);
for (const [k, why] of REQUIRED) line(`  ${process.env[k] ? "ok     " : "MISSING"} ${k} — ${why}`);
for (const [k, why] of OPTIONAL) line(`  ${process.env[k] ? "ok     " : "unset  "} ${k} — ${why}`);
if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) line("  WARNING SESSION_SECRET is shorter than 32 characters; the app will refuse to start.");
if ((process.env.NEXT_PUBLIC_CHAINS ?? "").includes("localhost")) line("  WARNING NEXT_PUBLIC_CHAINS includes 'localhost', which does not exist in production.");
if (missing.length) line(`  -> Add the MISSING variables in Vercel → Project → Settings → Environment Variables, then redeploy.`);

line("prisma generate");
run("npx prisma generate");

const migrateUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!migrateUrl) {
  line("Skipping database migrations: no DATABASE_URL configured.");
} else if (process.env.SKIP_MIGRATIONS === "1") {
  line("Skipping database migrations: SKIP_MIGRATIONS=1.");
} else {
  line(`prisma migrate deploy (using ${process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL"})`);
  try {
    run("npx prisma migrate deploy", { ...process.env, DATABASE_URL: migrateUrl });
  } catch {
    line("WARNING: database migrations failed. The site will deploy, but database features will error until this is fixed.");
    line("         Common causes: wrong DATABASE_URL, database not reachable, or a pooled URL — set DIRECT_URL to the non-pooled connection string.");
    line("         Run `npx prisma migrate deploy` against the database manually, or fix the variable and redeploy.");
  }
}

line("next build");
run("npx next build");
