/**
 * End-to-end journey against RUNNING services (web app, worker, PostgreSQL and, for the
 * token step, a local Hardhat chain). Nothing is mocked:
 *
 *   1-3   wallet signs a real SIWE message → session cookie
 *   4-7   create + activate an agent through the public API
 *   8-11  the worker picks up the queued run, retrieves live RWA data and publishes a report
 *   12-13 report is visible on the public profile; agent is listed in the marketplace
 *   14-15 creator reads execution history, pauses and resumes the agent
 *   16-17 token deployed from the creator wallet on the local chain, verified on-chain by the API
 *
 * Usage:  npm run e2e:journey            (BASE_URL defaults to http://localhost:3000)
 * The wallet is Hardhat's publicly known test account #0 — valid ONLY on the local dev chain.
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, encodeDeployData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { roviumAgentTokenAbi, roviumAgentTokenBytecode } from "../src/lib/chain/artifacts/RoviumAgentToken";
import { localhost } from "../src/lib/chain/chains";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8545";
// Hardhat default account #0 (public test key, local chain only).
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SKIP_TOKEN = process.env.SKIP_TOKEN === "1";

const account = privateKeyToAccount(TEST_KEY);
let cookie = "";

const log = (step: string, msg: string) => console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
function fail(msg: string): never {
  console.error(`\x1b[31mFAILED:\x1b[0m ${msg}`);
  process.exit(1);
}

async function call<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: T; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const [pair] = c.split(";");
    if (pair?.startsWith("rp_session=")) cookie = pair;
  }
  const text = await res.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = undefined as T;
  }
  return { status: res.status, json, text };
}

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs: number, everyMs = 3000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  fail(`timed out waiting for ${label}`);
}

async function main() {
  const health = await call<{ ok: boolean; workersOnline: number; llmConfigured: boolean }>("/api/health");
  if (!health.json?.ok) fail(`web app not healthy at ${BASE}: ${health.text}`);
  log("0", `web healthy; workers online: ${health.json.workersOnline}; LLM configured: ${health.json.llmConfigured}`);
  if (!health.json.workersOnline) fail("no worker heartbeat — start it with `npm run worker`");

  // 1-3 Sign in with Ethereum
  const { json: n } = await call<{ nonce: string }>("/api/auth/nonce", { method: "POST" });
  const host = new URL(BASE).host;
  const message = createSiweMessage({
    domain: host,
    address: account.address,
    statement: "Sign in to RoviumPad. This request will not trigger a transaction or cost any gas.",
    uri: BASE,
    version: "1",
    chainId: localhost.id,
    nonce: n.nonce,
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + 10 * 60_000),
  });
  const signature = await account.signMessage({ message });
  const v = await call("/api/auth/verify", { method: "POST", body: { message, signature } });
  if (v.status !== 200 || !cookie) fail(`SIWE verify failed: ${v.status} ${v.text}`);
  const replay = await call("/api/auth/verify", { method: "POST", body: { message, signature } });
  if (replay.status !== 401) fail(`nonce replay was not rejected (status ${replay.status})`);
  log("1-3", `signed in as ${account.address}; nonce replay correctly rejected`);

  // 4-7 Create + activate
  const name = `Journey Treasury Monitor ${Date.now().toString(36).slice(-4)}`;
  const created = await call<{ id: string; slug: string; status: string }>("/api/agents", {
    method: "POST",
    body: {
      identity: {
        name,
        ticker: "JTM",
        description: "End-to-end verification agent that reviews tokenized treasury funds against official Treasury rates.",
        specialization: "TREASURIES",
        objectives: ["Compare tokenized T-bill fund yields with official Treasury averages"],
      },
      intelligence: {
        researchObjectives: ["Identify funds whose yield premium over T-bills is unusually high"],
        dataSources: ["defillama-rwa", "defillama-yields", "defillama-prices", "us-treasury"],
        customSourceUrls: [],
        focusAssets: [],
        riskSensitivity: "BALANCED",
        reportingStyle: "CONCISE",
        monitoringCriteria: { priceChangePct: 2, yieldChangeBps: 50, tvlChangePct: 10, staleDataHours: 48 },
      },
      autonomy: { mode: "SCHEDULED", intervalMinutes: 360, monitorMinutes: 30 },
      activate: true,
    },
  });
  if (created.status !== 201) fail(`create failed: ${created.status} ${created.text}`);
  const agentId = created.json.id;
  log("4-7", `agent ${created.json.slug} saved and ${created.json.status}`);

  // 8-11 Worker executes research
  type Exec = { id: string; status: string; error: string | null; mode: string | null; fallbackReason: string | null; llmModel: string | null; costUsd: number; promptTokens: number; completionTokens: number; toolCalls: number; steps: { name: string; ok: boolean }[]; report: { id: string; title: string } | null };
  const exec = await waitFor(
    "research execution",
    async () => {
      const r = await call<{ items: Exec[] }>(`/api/agents/${agentId}/executions`);
      const e = r.json?.items?.[0];
      if (e?.status === "FAILED") fail(`execution failed: ${e.error}`);
      return e?.status === "COMPLETED" ? e : null;
    },
    420_000,
  );
  log("8-11", `execution ${exec.id} COMPLETED with ${exec.steps.length} trace steps: ${exec.steps.map((s) => s.name).join(", ")}`);
  if (!exec.report) fail("no report linked to the execution");
  log(
    "AI",
    exec.mode === "ai"
      ? `AI research by ${exec.llmModel}: ${exec.toolCalls} tool calls, ${exec.promptTokens + exec.completionTokens} tokens, est. $` + exec.costUsd.toFixed(4)
      : `fallback report (${exec.fallbackReason ?? "no reason"})`,
  );
  if (process.env.REQUIRE_AI === "1" && exec.mode !== "ai") fail("REQUIRE_AI=1 but the run used the fallback engine");

  // 12-13 Public profile + marketplace
  const page = await fetch(`${BASE}/agents/${created.json.slug}/research`).then((r) => r.text());
  if (!page.includes(exec.report.title.replace(/&/g, "&amp;").slice(0, 20))) fail("report title not found on public research page");
  const market = await call<{ items: { id: string }[] }>(`/api/agents?q=${encodeURIComponent(name)}`);
  if (!market.json.items.some((a) => a.id === agentId)) fail("agent not found in marketplace search");
  log("12-13", `report “${exec.report.title}” is public; agent appears in marketplace search`);

  // 14-15 History + pause/resume
  const paused = await call<{ status: string }>(`/api/agents/${agentId}/lifecycle`, { method: "POST", body: { action: "pause" } });
  if (paused.json?.status !== "PAUSED") fail(`pause failed: ${paused.text}`);
  const runWhilePaused = await call(`/api/agents/${agentId}/run`, { method: "POST" });
  if (runWhilePaused.status !== 409) fail("manual run was not blocked while paused");
  const resumed = await call<{ status: string }>(`/api/agents/${agentId}/lifecycle`, { method: "POST", body: { action: "resume" } });
  if (resumed.json?.status !== "ACTIVE") fail(`resume failed: ${resumed.text}`);
  log("14-15", "execution history readable; pause blocks runs; resume re-activates");

  // Authorization boundary: an anonymous caller cannot modify the agent.
  const saved = cookie;
  cookie = "";
  const anon = await call(`/api/agents/${agentId}/lifecycle`, { method: "POST", body: { action: "pause" } });
  cookie = saved;
  if (anon.status !== 401) fail(`anonymous lifecycle change not rejected (status ${anon.status})`);
  log("auth", "anonymous modification rejected with 401");

  if (SKIP_TOKEN) {
    log("16-17", "skipped (SKIP_TOKEN=1)");
    return done();
  }

  // 16-17 Token deployment on the local chain
  const pub = createPublicClient({ chain: localhost, transport: http(RPC) });
  try {
    await pub.getChainId();
  } catch {
    fail(`local chain not reachable at ${RPC} — start it with \`npm run chain:dev\` or set SKIP_TOKEN=1`);
  }
  const prep = await call<{ deploymentId: string; constructorArgs: { name: string; symbol: string; totalSupplyWholeTokens: string; creator: `0x${string}`; agentId: string; metadataURI: string } }>(
    `/api/agents/${agentId}/token`,
    { method: "POST", body: { action: "prepare", mechanism: "standard-erc20", chainId: localhost.id, tokenName: "Journey Token", tokenSymbol: "JTM", totalSupply: "1000000", acknowledgeDisclosure: true } },
  );
  if (prep.status !== 200) fail(`prepare failed: ${prep.text}`);
  const a = prep.json.constructorArgs;
  const wallet = createWalletClient({ account, chain: localhost, transport: http(RPC) });
  const args = [a.name, a.symbol, BigInt(a.totalSupplyWholeTokens), a.creator, a.agentId, a.metadataURI] as const;
  // Simulation: eth_estimateGas executes the constructor and surfaces reverts before signing.
  const gas = await pub.estimateGas({ account, data: encodeDeployData({ abi: roviumAgentTokenAbi, bytecode: roviumAgentTokenBytecode, args }) });
  const hash = await wallet.deployContract({
    abi: roviumAgentTokenAbi,
    bytecode: roviumAgentTokenBytecode,
    args,
  });
  const sub = await call(`/api/agents/${agentId}/token`, { method: "POST", body: { action: "submit", deploymentId: prep.json.deploymentId, txHash: hash } });
  if (sub.status !== 200) fail(`submit failed: ${sub.text}`);
  const dup = await call(`/api/agents/${agentId}/token`, { method: "POST", body: { action: "submit", deploymentId: prep.json.deploymentId, txHash: hash } });
  if (dup.status !== 409) fail("duplicate submission was not rejected");
  const confirmed = await waitFor(
    "token verification",
    async () => {
      const r = await call<{ status: string; contractAddress?: string; error?: string }>(`/api/agents/${agentId}/token`, { method: "POST", body: { action: "verify", deploymentId: prep.json.deploymentId } });
      if (r.json?.status === "FAILED") fail(`verification failed: ${r.json.error}`);
      return r.json?.status === "CONFIRMED" ? r.json : null;
    },
    60_000,
    1500,
  );
  log("16-17", `token deployed (est. gas ${gas}), tx ${hash}, verified at ${confirmed.contractAddress}; duplicate submit rejected`);
  done();
}

function done() {
  console.log("\n\x1b[32mJourney passed.\x1b[0m");
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.stack ?? e.message : String(e)));
