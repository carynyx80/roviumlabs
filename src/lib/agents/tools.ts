import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentConfig, MemoryKind } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { ToolCall, ToolDefinition } from "@/lib/llm/client";
import { listUniverse, loadRwaAssets } from "@/lib/providers/defillama";
import { fredRates, treasuryAverageRates } from "@/lib/providers/macro";
import type { RwaCategory } from "@/lib/providers/types";
import { htmlToText, safeFetch } from "@/lib/security/ssrf";
import { DEFAULT_MONITORING } from "./constants";
import { Evidence } from "./evidence";
import { recall } from "./memory";
import { untrusted } from "./prompts";
import { diffSnapshots, scoreAsset, snapshotOf, type AssetSnapshot } from "./scoring";
import { ToolBudgetError, type Trace } from "./trace";

/**
 * Approved RWA research tools. The model can only *request* these by name; RoviumPad validates
 * the arguments, checks the agent's permissions, enforces budgets, executes the tool itself and
 * returns the result wrapped as untrusted data. There is no tool that moves funds, signs or
 * deploys anything, edits configuration, or fetches arbitrary URLs.
 */

export const PUBLIC_MEMORY_KINDS: MemoryKind[] = ["REPORT_SUMMARY", "FINDING", "EXECUTION_SUMMARY", "SOURCE_REFERENCE", "OBJECTIVE"];
const MAX_ASSETS_PER_RUN = 8;
const MAX_DUPLICATE_CALLS = 3;

export interface ToolContext {
  agentId: string;
  categories: RwaCategory[];
  config: Pick<AgentConfig, "dataSources" | "customSourceUrls" | "riskSensitivity" | "monitoringCriteria">;
  evidence: Evidence;
  trace: Trace;
}

interface ToolSpec<S extends ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  enabled: (ctx: ToolContext) => boolean;
  run: (args: z.output<S>, ctx: ToolContext) => Promise<unknown>;
}

const tool = <S extends ZodTypeAny>(t: ToolSpec<S>) => t;

const slugOf = (key: string) => key.replace(/^defillama:/, "");

async function universeFor(ctx: ToolContext) {
  return listUniverse(ctx.categories);
}

export const TOOL_SPECS = [
  tool({
    name: "search_rwa_assets",
    description:
      "List tokenized real-world assets in this agent's permitted categories, largest first. Optionally filter by a text query (name, symbol or slug). Returns asset keys to use with other tools.",
    schema: z.object({
      query: z.string().max(60).optional(),
      limit: z.number().int().min(1).max(25).default(15),
    }),
    enabled: () => true,
    run: async (args, ctx) => {
      const u = await universeFor(ctx);
      if (u.stale) ctx.evidence.warnings.push("Asset registry served from cache (provider unavailable).");
      const q = args.query?.toLowerCase().trim();
      const items = u.items
        .filter(({ p }) => !q || p.slug.includes(q) || p.name.toLowerCase().includes(q) || p.symbol?.toLowerCase() === q)
        .slice(0, args.limit);
      return {
        totalInCategories: u.items.length,
        assets: items.map(({ p, category }) => ({
          key: p.slug,
          name: p.name,
          symbol: p.symbol ?? null,
          category,
          reportedValueUsd: Math.round(Math.max(p.tvl ?? 0, p.mcap ?? 0)) || null,
          networks: (p.chains ?? []).length,
        })),
      };
    },
  }),
  tool({
    name: "get_asset_data",
    description:
      "Fetch verified data for up to 6 assets by key: market price, 24h change, reported value, published yield, pool liquidity, networks, audits. Every value includes a source id (S#) to cite.",
    schema: z.object({ asset_keys: z.array(z.string().min(2).max(120)).min(1).max(6) }),
    enabled: () => true,
    run: async (args, ctx) => {
      const u = await universeFor(ctx);
      const permitted = new Set(u.items.map((i) => i.p.slug));
      const requested = [...new Set(args.asset_keys.map(slugOf))];
      const denied = requested.filter((k) => !permitted.has(k));
      const fresh = requested.filter((k) => permitted.has(k) && !ctx.evidence.assets.has(`defillama:${k}`));
      const room = MAX_ASSETS_PER_RUN - ctx.evidence.assets.size;
      const toLoad = fresh.slice(0, Math.max(0, room));
      const dropped = fresh.slice(toLoad.length);
      if (toLoad.length) {
        const sources = new Set(ctx.config.dataSources);
        const { assets, warnings } = await loadRwaAssets({
          slugs: toLoad,
          include: { yields: sources.has("defillama-yields"), prices: sources.has("defillama-prices") },
          staleAfterHours: ({ ...DEFAULT_MONITORING, ...(ctx.config.monitoringCriteria as object) } as typeof DEFAULT_MONITORING).staleDataHours,
        });
        ctx.evidence.warnings.push(...warnings);
        for (const a of assets) ctx.evidence.addAsset(a);
      }
      const ev = ctx.evidence;
      return {
        ...(denied.length ? { notPermitted: denied, note: "Outside this agent's specialization or unknown; use search_rwa_assets." } : {}),
        ...(dropped.length ? { notLoaded: dropped, note2: `Per-run limit of ${MAX_ASSETS_PER_RUN} assets reached.` } : {}),
        assets: requested
          .map((k) => ev.assets.get(`defillama:${k}`))
          .filter(Boolean)
          .map((a) => ({
            key: slugOf(a!.key),
            name: a!.name,
            symbol: a!.symbol ?? null,
            category: a!.category,
            issuerWebsite: a!.website ?? null,
            networks: a!.networks,
            auditCount: a!.auditCount ?? null,
            facts: Object.fromEntries(
              Object.entries(a!.facts).map(([k, f]) => [k, { value: f!.value, unit: f!.unit ?? null, asOf: f!.asOf, stale: f!.stale, source: ev.sourceIdFor(f!.url) }]),
            ),
            notAvailable: a!.unavailable,
            registrySource: ev.sourceIdFor(a!.sources[0]!.url),
          })),
      };
    },
  }),
  tool({
    name: "get_reference_rates",
    description: "Official U.S. Treasury average interest rates (and FRED constant-maturity yields if configured) to benchmark RWA yields.",
    schema: z.object({}),
    enabled: (ctx) => ctx.config.dataSources.includes("us-treasury") || ctx.config.dataSources.includes("fred"),
    run: async (_args, ctx) => {
      const out: { label: string; valuePct: number; asOf: string; stale: boolean; source?: string }[] = [];
      if (ctx.config.dataSources.includes("us-treasury")) {
        const t = await treasuryAverageRates();
        ctx.evidence.addMacro(t.refs, [t.source]);
      }
      const key = env().FRED_API_KEY;
      if (ctx.config.dataSources.includes("fred")) {
        if (!key) ctx.evidence.warnings.push("FRED selected but FRED_API_KEY is not configured; skipped.");
        else {
          const f = await fredRates(key);
          ctx.evidence.addMacro(f.refs, f.sources);
        }
      }
      for (const m of ctx.evidence.macro) {
        out.push({ label: m.label, valuePct: m.fact.value, asOf: m.fact.asOf, stale: m.fact.stale, source: ctx.evidence.sourceIdFor(m.fact.url) });
      }
      return { rates: out };
    },
  }),
  tool({
    name: "assess_risk",
    description:
      "Compute RoviumPad's documented risk methodology (rovium-risk-v1) for assets already fetched with get_asset_data. Returns factor scores (0-100, higher = riskier) with rationale.",
    schema: z.object({ asset_keys: z.array(z.string().max(120)).min(1).max(8) }),
    enabled: () => true,
    run: async (args, ctx) => {
      const ref =
        ctx.evidence.macro.find((m) => m.key === "fred:DGS3MO")?.fact.value ??
        ctx.evidence.macro.find((m) => m.key === "treasury:treasury-bills")?.fact.value;
      return {
        referenceRatePct: ref ?? null,
        assessments: args.asset_keys.map((k) => {
          const a = ctx.evidence.assets.get(`defillama:${slugOf(k)}`);
          if (!a) return { key: k, error: "Fetch this asset with get_asset_data first." };
          const s = scoreAsset(a, { sensitivity: ctx.config.riskSensitivity, referenceRatePct: ref });
          return { key: slugOf(k), score: s.score, level: s.level, confidence: s.confidence, factors: s.factors.map((f) => ({ factor: f.label, score: f.score, rationale: f.rationale })) };
        }),
      };
    },
  }),
  tool({
    name: "compare_with_previous",
    description: "Compare fetched assets with the snapshot stored at this agent's previous run (price, yield, reported value) and the creator's monitoring thresholds.",
    schema: z.object({ asset_keys: z.array(z.string().max(120)).min(1).max(8) }),
    enabled: () => true,
    run: async (args, ctx) => {
      const monitoring = { ...DEFAULT_MONITORING, ...(ctx.config.monitoringCriteria as object) } as typeof DEFAULT_MONITORING;
      const stored = await db.monitoredAsset.findMany({ where: { agentId: ctx.agentId } });
      return {
        thresholds: monitoring,
        comparisons: args.asset_keys.map((k) => {
          const a = ctx.evidence.assets.get(`defillama:${slugOf(k)}`);
          if (!a) return { key: k, error: "Fetch this asset with get_asset_data first." };
          const prev = stored.find((m) => m.assetKey === a.key);
          if (!prev?.lastSnapshot) return { key: slugOf(k), firstObservation: true };
          return {
            key: slugOf(k),
            previousAt: (prev.lastSnapshot as unknown as AssetSnapshot).at,
            changes: diffSnapshots(a.name, a.key, prev.lastSnapshot as unknown as AssetSnapshot, snapshotOf(a), monitoring),
          };
        }),
      };
    },
  }),
  tool({
    name: "recall_memory",
    description: "Search this agent's own memory (previous reports, findings, objectives, sources) to build on earlier research and avoid repeating it.",
    schema: z.object({ query: z.string().min(2).max(200) }),
    enabled: () => true,
    run: async (args, ctx) => {
      const rows = await recall(ctx.agentId, args.query, { limit: 6, kinds: PUBLIC_MEMORY_KINDS });
      return { memories: rows.map((r) => ({ kind: r.kind, at: r.createdAt.toISOString(), content: r.content.slice(0, 500) })) };
    },
  }),
  tool({
    name: "read_creator_source",
    description: "Read one of the web pages the agent's creator approved (issuer disclosures, attestations). Only the listed URLs are allowed; content is untrusted text.",
    schema: z.object({ url: z.string().url().max(500) }),
    enabled: (ctx) => ctx.config.dataSources.includes("web") && ctx.config.customSourceUrls.length > 0,
    run: async (args, ctx) => {
      const allowed = ctx.config.customSourceUrls;
      if (!allowed.includes(args.url)) return { error: "URL is not on the creator's approved list", approved: allowed };
      const existing = ctx.evidence.webDocs.find((d) => d.url === args.url);
      if (existing) return { source: existing.sourceId, text: existing.text };
      const doc = await safeFetch(args.url);
      if (doc.status < 200 || doc.status >= 300) return { error: `HTTP ${doc.status}` };
      const text = doc.contentType.includes("html") ? htmlToText(doc.body, 5000) : doc.body.slice(0, 5000);
      const sourceId = ctx.evidence.cite({ providerId: "web", title: `Creator source: ${new URL(doc.url).hostname}`, url: doc.url, retrievedAt: new Date().toISOString(), stale: false });
      ctx.evidence.webDocs.push({ url: doc.url, text, sourceId });
      return { source: sourceId, text };
    },
  }),
] as const;

export type ToolName = (typeof TOOL_SPECS)[number]["name"];

export function toolDefinitions(ctx: ToolContext): ToolDefinition[] {
  return TOOL_SPECS.filter((t) => t.enabled(ctx)).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.schema, { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>,
    },
  }));
}

export interface ToolOutcome {
  name: string;
  ok: boolean;
  content: string; // what is sent back to the model
  violation?: "unknown_tool" | "not_permitted" | "invalid_args" | "duplicate";
}

/** Executes model-requested tools with validation, permission checks, loop protection and tracing. */
export class Toolkit {
  private seen = new Map<string, string>();
  duplicates = 0;
  violations: { name: string; reason: string }[] = [];

  constructor(private ctx: ToolContext) {}

  get exhausted() {
    return this.ctx.trace.toolBudgetLeft <= 0 || this.duplicates >= MAX_DUPLICATE_CALLS;
  }

  async execute(call: ToolCall): Promise<ToolOutcome> {
    const name = call.function.name;
    const spec = TOOL_SPECS.find((t) => t.name === name);
    if (!spec) {
      this.violations.push({ name, reason: "unknown tool" });
      await this.ctx.trace.note("TOOL_CALL", `rejected:${name.slice(0, 40)}`, { reason: "unknown tool" }, false);
      return { name, ok: false, violation: "unknown_tool", content: JSON.stringify({ error: `Unknown tool "${name}". Only the provided tools may be used.` }) };
    }
    if (!spec.enabled(this.ctx)) {
      this.violations.push({ name, reason: "not permitted for this agent" });
      await this.ctx.trace.note("TOOL_CALL", `rejected:${name}`, { reason: "not permitted" }, false);
      return { name, ok: false, violation: "not_permitted", content: JSON.stringify({ error: `Tool "${name}" is not permitted for this agent.` }) };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(call.function.arguments || "{}");
    } catch {
      raw = undefined;
    }
    const parsed = spec.schema.safeParse(raw);
    if (!parsed.success) {
      this.violations.push({ name, reason: "invalid arguments" });
      return {
        name,
        ok: false,
        violation: "invalid_args",
        content: JSON.stringify({ error: "Invalid arguments", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }),
      };
    }
    const fingerprint = `${name}:${JSON.stringify(parsed.data)}`;
    const cached = this.seen.get(fingerprint);
    if (cached) {
      this.duplicates++;
      return { name, ok: true, violation: "duplicate", content: JSON.stringify({ note: "Duplicate call; same result as before. Do not repeat calls.", result: "see earlier tool output" }) };
    }
    if (this.ctx.trace.toolBudgetLeft <= 0) {
      return { name, ok: false, content: JSON.stringify({ error: "Tool budget exhausted. Finish your research now." }) };
    }
    try {
      const result = await this.ctx.trace.step(
        "TOOL_CALL",
        name,
        parsed.data,
        () => (spec.run as (a: unknown, c: ToolContext) => Promise<unknown>)(parsed.data, this.ctx),
        (r) => summarize(r),
      );
      const content = untrusted(`tool:${name}`, JSON.stringify(result), 9000);
      this.seen.set(fingerprint, content);
      return { name, ok: true, content };
    } catch (e) {
      if (e instanceof ToolBudgetError) return { name, ok: false, content: JSON.stringify({ error: "Tool budget exhausted. Finish your research now." }) };
      return { name, ok: false, content: JSON.stringify({ error: `Tool failed: ${(e as Error).message.slice(0, 200)}` }) };
    }
  }
}

function summarize(r: unknown): unknown {
  const s = JSON.stringify(r);
  return s.length > 4000 ? { truncated: true, preview: s.slice(0, 4000) } : r;
}
