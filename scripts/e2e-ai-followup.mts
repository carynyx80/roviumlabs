/**
 * Live AI follow-up against RUNNING services (no mocks): signs in as the journey wallet,
 * triggers a second research run on an existing agent (exercising memory + novelty) and asks the
 * agent a question through the public chat API (grounded answer with citations).
 *
 * Usage: AGENT_ID=<id> npx tsx --conditions=react-server scripts/e2e-ai-followup.mts
 * Hardhat test account #0 — valid ONLY on the local dev chain / local sign-in.
 */
import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AGENT_ID = process.env.AGENT_ID;
if (!AGENT_ID) throw new Error("Set AGENT_ID");
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
let cookie = "";

async function call<T>(path: string, init: { method?: string; body?: unknown; anon?: boolean } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { origin: BASE, ...(cookie && !init.anon ? { cookie } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("rp_session=")) cookie = c.split(";")[0]!;
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text) as T; } catch { return undefined as T; } })() };
}

const { json: n } = await call<{ nonce: string }>("/api/auth/nonce", { method: "POST" });
const message = createSiweMessage({ domain: new URL(BASE).host, address: account.address, uri: BASE, version: "1", chainId: 31337, nonce: n.nonce, issuedAt: new Date(), expirationTime: new Date(Date.now() + 600_000) });
await call("/api/auth/verify", { method: "POST", body: { message, signature: await account.signMessage({ message }) } });

if (process.env.RUN !== "0") {
  const run = await call<{ executionId: string }>(`/api/agents/${AGENT_ID}/run`, { method: "POST" });
  if (run.status !== 202) throw new Error(`run failed: ${run.text}`);
  console.log("second run queued:", run.json.executionId);
}

type Exec = { id: string; status: string; mode: string | null; fallbackReason: string | null; costUsd: number; toolCalls: number; steps: { name: string }[]; report: { id: string; title: string } | null };
let exec: Exec | undefined;
for (let i = 0; i < 120; i++) {
  const r = await call<{ items: Exec[] }>(`/api/agents/${AGENT_ID}/executions?limit=1`);
  if (!r.json?.items) {
    await new Promise((res) => setTimeout(res, 4000));
    continue; // transient non-JSON response (e.g. dev server compiling)
  }
  exec = r.json.items[0];
  if (exec && ["COMPLETED", "FAILED", "CANCELLED"].includes(exec.status)) break;
  await new Promise((res) => setTimeout(res, 4000));
}
console.log("second run:", JSON.stringify({ status: exec?.status, mode: exec?.mode, fallbackReason: exec?.fallbackReason, toolCalls: exec?.toolCalls, costUsd: exec?.costUsd, tools: exec?.steps.map((s) => s.name), title: exec?.report?.title }, null, 1));

// Public chat as an anonymous visitor.
const chat = await call<never>(`/api/agents/${AGENT_ID}/chat`, { method: "POST", anon: true, body: { message: "What did your latest research conclude about yields versus Treasury bills, and what changed since your previous run?" } });
console.log(`\nchat (HTTP ${chat.status}):\n${chat.text}`);
