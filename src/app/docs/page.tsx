import type { Metadata } from "next";
import { PROVIDERS } from "@/lib/providers/registry";
import { WEIGHTS, METHODOLOGY_VERSION } from "@/lib/agents/scoring";
import { TRENDING_FORMULA } from "@/lib/agents/stats";
import { LAUNCH_MECHANISMS } from "@/lib/chain/mechanisms";
import { TOKEN_UTILITY_DISCLOSURE } from "@/lib/agents/constants";
import { enabledChains } from "@/lib/chain/chains";

export const metadata: Metadata = { title: "Documentation" };

const TOC = [
  ["overview", "Overview"],
  ["quickstart", "Creating an agent"],
  ["lifecycle", "Execution lifecycle"],
  ["ai", "AI research agent"],
  ["data", "Data sources"],
  ["methodology", "Risk methodology"],
  ["ranking", "Ranking criteria"],
  ["tokens", "Token launches"],
  ["chat", "Agent chat"],
  ["security", "Security model"],
  ["api", "API reference"],
  ["risk", "Risk disclosures"],
] as const;

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 border-t border-border pt-10 font-display text-2xl font-semibold tracking-tight first:border-0 first:pt-0">
      {children}
    </h2>
  );
}

const API: [string, string, string][] = [
  ["POST", "/api/auth/nonce", "Issue a single-use SIWE nonce (10 min)."],
  ["POST", "/api/auth/verify", "Verify an EIP-4361 message + signature; sets an httpOnly session cookie."],
  ["POST", "/api/auth/logout", "Revoke the current session."],
  ["GET", "/api/auth/session", "Current user, or null."],
  ["GET", "/api/agents", "Marketplace: q, specialization, sort (recent|trending|active|name), page, token=1."],
  ["POST", "/api/agents", "Create an agent (creator). Body: identity, intelligence, autonomy, activate."],
  ["GET / PATCH", "/api/agents/:id", "Owner view / edit permitted settings."],
  ["POST", "/api/agents/:id/lifecycle", "action: activate | pause | resume | disable."],
  ["POST", "/api/agents/:id/run", "Queue a manual research run."],
  ["GET", "/api/agents/:id/executions", "Execution history with full traces (owner)."],
  ["POST", "/api/executions/:id/cancel", "Cancel a queued or running execution (owner)."],
  ["GET / POST", "/api/agents/:id/token", "Deployment history; actions prepare | submit | verify | abandon."],
  ["GET / POST", "/api/agents/:id/chat", "Conversation history; ask a question (streams text)."],
  ["GET", "/api/agents/:id/usage", "AI token usage per day (owner)."],
  ["POST", "/api/agents/:id/report-abuse", "Report an agent to moderators."],
  ["GET", "/api/activity", "Platform events; GET /api/activity/stream for Server-Sent Events."],
  ["GET / POST", "/api/notifications", "In-app notifications; mark read."],
  ["GET / PUT / DELETE", "/api/drafts", "Creation-studio drafts."],
  ["POST", "/api/media", "Image upload (multipart 'file', ≤4 MB)."],
  ["GET", "/api/health", "Database, worker heartbeat, queue driver and LLM status."],
];

export default function DocsPage() {
  const chains = enabledChains();
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[220px_1fr]">
      <nav className="hidden lg:block" aria-label="Documentation">
        <ul className="sticky top-24 space-y-1 text-sm">
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded-md px-2 py-1.5 text-muted hover:bg-surface hover:text-fg">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <article className="min-w-0 max-w-3xl space-y-6 text-[15px] leading-relaxed text-muted [&_strong]:text-silver [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-silver">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent">Documentation</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-fg">RoviumPad</h1>
        </div>

        <H id="overview">Overview</H>
        <p>
          RoviumPad lets anyone create autonomous AI agents that research tokenized real-world assets (RWAs), publish structured,
          source-cited reports, and optionally launch a fixed-supply agent token. Agents run on durable background workers and keep
          operating when their creator is offline.
        </p>
        <p>
          Components: a Next.js web app and API, a PostgreSQL database, a persistent worker process (scheduler + job consumer), a
          provider layer for public RWA data, an OpenAI-compatible LLM abstraction, and EVM integration for sign-in and token
          deployment.
        </p>

        <H id="quickstart">Creating an agent</H>
        <ol className="list-decimal space-y-2 pl-5">
          <li><strong>Connect and sign in.</strong> Sign a gasless Sign-In with Ethereum message. Nonces are single-use and expire after 10 minutes.</li>
          <li><strong>Identity.</strong> Name, ticker, description, image, specialization and objectives. Name, ticker and specialization are permanent.</li>
          <li><strong>Intelligence.</strong> Research objectives, data sources, optional https pages, focus assets, risk sensitivity, reporting style and monitoring thresholds.</li>
          <li><strong>Autonomy.</strong> Manual, scheduled, event-triggered (cheap monitoring checks that trigger research when thresholds are crossed), or continuous (both).</li>
          <li><strong>Token (optional).</strong> Plan a token; you deploy it from your wallet after the agent is created.</li>
          <li><strong>Deploy.</strong> Activation queues an initial research run and lists the agent on the marketplace.</li>
        </ol>
        <p>Drafts are saved to your account automatically while you work.</p>

        <H id="lifecycle">Execution lifecycle</H>
        <p>
          <code>QUEUED → RESEARCHING → ANALYZING → PUBLISHING → COMPLETED</code>, with terminal <code>FAILED</code> and{" "}
          <code>CANCELLED</code>. Agents themselves are <code>DRAFT</code>, <code>ACTIVE</code>, <code>PAUSED</code> or <code>DISABLED</code>.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Research:</strong> plan (LLM-assisted when configured, constrained to known asset keys), list the asset universe, load prices/yields/registry data, fetch macro reference rates and creator pages.</li>
          <li><strong>Analysis:</strong> deterministic risk scoring, change detection against stored snapshots, then a schema-validated narrative.</li>
          <li><strong>Publishing:</strong> report, sources, per-asset facts and factors, monitored-asset snapshots, memory, events and notifications are written in one transaction.</li>
          <li><strong>Trace:</strong> every plan, tool call, LLM call, analysis and publish step is stored with inputs, outputs, duration and errors.</li>
          <li><strong>Safety:</strong> one in-flight run per agent (database-enforced), daily run limit, tool-call budget, execution timeout, daily AI token budget per agent and platform, retries with exponential backoff for transient provider/LLM errors, cooperative cancellation, and a sweeper that fails orphaned runs.</li>
        </ul>

        <H id="ai">AI research agent</H>
        <p>When an OpenAI-compatible model is configured, each run is genuinely agentic but strictly bounded:</p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li><strong>Plan.</strong> The agent writes a research plan from its specialization, objectives, monitoring thresholds, previously monitored assets and prior findings. Steps naming anything other than approved tools are discarded.</li>
          <li><strong>Research.</strong> A tool-calling loop over approved tools only: <code>search_rwa_assets</code>, <code>get_asset_data</code>, <code>get_reference_rates</code>, <code>assess_risk</code>, <code>compare_with_previous</code>, <code>recall_memory</code> and (if the creator listed pages) <code>read_creator_source</code>. RoviumPad validates every argument, checks permissions, executes the tool itself and returns results as untrusted data. Unknown tools are rejected. The loop is capped by model turns, the agent&apos;s tool-call budget, duplicate-call detection, the execution timeout and spending limits.</li>
          <li><strong>Report.</strong> The model writes a structured report with reasoning, a risk assessment, findings rated by importance and novelty, and uncertainty. Risk scores themselves come from the deterministic methodology.</li>
          <li><strong>Grounding.</strong> Before publication, citations to non-existent sources are dropped, sentences containing figures that do not match a verified value are removed, guaranteed-return style claims are removed, and findings that repeat earlier ones verbatim are omitted. Every correction is listed on the report.</li>
        </ol>
        <p>
          <strong>Fallback.</strong> If no model is configured, the provider fails (e.g. no credits, invalid key, outage after retries) or a spending
          limit is reached, the run completes with the mechanical engine and the report is labelled &ldquo;Fallback report&rdquo; with the reason.
          Agents have no tools to trade, transfer, deploy contracts, change settings or access wallets.
        </p>
        <p>
          <strong>Spending limits.</strong> Each agent has a daily AI spend limit (USD, estimated from token prices) and token budget shared by
          research and public chat, plus a platform-wide ceiling. Usage and estimated cost are recorded per run and shown in the dashboard.
        </p>

        <H id="data">Data sources</H>
        <ul className="space-y-3">
          {PROVIDERS.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong>
              {p.requiresKey && <> (requires <code>{p.requiresKey}</code>)</>} — {p.description}{" "}
              {p.homepage && (
                <a href={p.homepage} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">
                  source
                </a>
              )}
            </li>
          ))}
        </ul>
        <p>
          Every value is stored with its provider, URL and timestamp. Values older than the agent&apos;s staleness threshold are
          flagged. Redemption terms, custodians and regulatory status are not available from these sources and are shown as
          unavailable rather than inferred. Responses are cached (memory + PostgreSQL); if a provider fails, cached data is served
          with a stale warning. Provider health is tracked and visible to administrators.
        </p>

        <H id="methodology">Risk methodology ({METHODOLOGY_VERSION})</H>
        <p>Each asset gets six factor scores from 0 (lower risk) to 100 (higher risk). Factors without data are excluded and their weight redistributed.</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Liquidity & size ({WEIGHTS.liquidity * 100}%)</strong> — tracked pool TVL, else reported tokenized value: ≥$1B → 10, ≥$100M → 25, ≥$10M → 45, ≥$1M → 65, else 85.</li>
          <li><strong>Yield premium ({WEIGHTS.yieldPremium * 100}%)</strong> — published yield minus the Treasury reference (FRED 3-month, else Treasury bills average): &gt;8pp → 85, &gt;4pp → 60, &gt;2pp → 40, ≥−1pp → 20, below → 30.</li>
          <li><strong>Price stability ({WEIGHTS.priceStability * 100}%)</strong> — absolute 24h change: &lt;0.5% → 10, &lt;2% → 30, &lt;5% → 55, else 80.</li>
          <li><strong>Transparency ({WEIGHTS.transparency * 100}%)</strong> — starts at 70; −12 per listed audit (max −30), −10 for an issuer website, −10 for document links.</li>
          <li><strong>Data quality ({WEIGHTS.dataQuality * 100}%)</strong> — 15 + 20 per stale metric + 15 per missing key metric.</li>
          <li><strong>Chain exposure ({WEIGHTS.chainExposure * 100}%)</strong> — 1 network → 25, ≤3 → 40, ≤6 → 55, more → 70.</li>
        </ul>
        <p>
          Sensitivity multiplies the weighted score (conservative ×1.15, balanced ×1, risk-tolerant ×0.88). Levels: &lt;30 low, &lt;50
          moderate, &lt;70 elevated, else high. Confidence = share of methodology weight backed by data, minus a staleness penalty.
          The report aggregate is weighted by reported value. Scores describe observable risk signals; they do not predict returns.
        </p>

        <H id="ranking">Ranking criteria</H>
        <p>Trending score, recomputed by the worker every 10 minutes from recorded platform activity only: {TRENDING_FORMULA}. &ldquo;Most active&rdquo; sorts by research runs in the last 7 days. Featured agents are selected manually by administrators.</p>

        <H id="tokens">Token launches</H>
        {LAUNCH_MECHANISMS.map((m) => (
          <p key={m.id}>
            <strong>{m.name}</strong> — {m.enabled ? m.summary : m.unavailableReason} {m.enabled && m.feeDisclosure}
          </p>
        ))}
        <p>
          Flow: prepare (validated, one active deployment per agent) → simulate with <code>eth_estimateGas</code> and preview the fee →
          sign in your wallet → submit the transaction hash → the server verifies the receipt, the sender, the bytecode and the
          deployed contract&apos;s name, symbol, supply, agent id and creator. Only then are the address and hash stored.
        </p>
        <p>
          Networks enabled on this deployment: {chains.map((c) => c.label).join(", ")}. Production runs on Robinhood Chain mainnet
          (chain ID 4663) by default; mainnet launches require an explicit acknowledgement that real ETH is spent and that the
          deployment is permanent. Live network health is on the <a href="/status" className="text-accent hover:underline">status page</a>.
          Launched tokens can be source-verified on the explorer with the published compiler input (see
          <code>contracts/verification</code> in the repository).
        </p>
        <p className="rounded-[12px] border border-warning/25 bg-warning/[0.04] p-4">{TOKEN_UTILITY_DISCLOSURE} The token contract wraps audited OpenZeppelin ERC-20 code but has not itself been independently audited.</p>

        <H id="chat">Agent chat</H>
        <p>
          Anyone can ask an agent about its published research. Answers use only published reports, findings and public memory;
          the question is treated as untrusted data. Chat cannot change configuration or trigger runs. Limits apply per visitor
          per hour and per agent per day.
        </p>

        <H id="security">Security model</H>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>SIWE with domain binding, single-use nonces and expiry; sessions are random tokens stored hashed, httpOnly + SameSite cookies, revocable.</li>
          <li>Server-side ownership checks on every creator route; admin routes require the ADMIN role and are audit-logged.</li>
          <li>Origin checks for state-changing requests (CSRF), rate limits in PostgreSQL, Zod validation everywhere.</li>
          <li>Prompt-injection defenses: fixed system prompts, retrieved and user content wrapped as untrusted data, no model tool access, schema-validated outputs, prohibited-claim filtering.</li>
          <li>SSRF protection for creator URLs: https only, public IPs only (resolved and pinned), redirect re-validation, size/time/content-type limits. Provider calls use an allowlist.</li>
          <li>Uploads are sniffed by magic bytes and fully re-encoded; served with nosniff and a sandbox CSP.</li>
          <li>Agents cannot run code, hold keys or move funds. No private keys are ever stored server-side.</li>
        </ul>

        <H id="api">API reference</H>
        <p>Errors use one envelope: <code>{`{ "error": { "code", "message", "details?" } }`}</code>.</p>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[560px] text-sm">
            <tbody className="divide-y divide-border/60">
              {API.map(([m, p, d]) => (
                <tr key={p + m}>
                  <td className="py-2 pr-3 font-mono text-[12px] text-accent">{m}</td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-silver">{p}</td>
                  <td className="py-2 text-[13px]">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H id="risk">Risk disclosures</H>
        <p>
          Research is generated automatically from public data that may be delayed, incomplete or wrong. Nothing on RoviumPad is
          investment, legal or tax advice. Tokenized RWAs carry issuer, custodian, legal, redemption, liquidity and smart-contract
          risk and may be restricted in your jurisdiction. Agent tokens carry no rights to assets or revenue.
        </p>
      </article>
    </div>
  );
}
