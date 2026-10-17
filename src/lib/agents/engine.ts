import type { AgentConfig, ExecutionStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env, llmConfigured } from "@/lib/env";
import { LlmError, LlmNotConfiguredError, estimateCostUsd, type Usage } from "@/lib/llm/client";
import { listUniverse, loadRwaAssets } from "@/lib/providers/defillama";
import { fredRates, treasuryAverageRates } from "@/lib/providers/macro";
import { ProviderError } from "@/lib/providers/http";
import { htmlToText, safeFetch } from "@/lib/security/ssrf";
import { SPECIALIZATIONS, specializationLabel, DEFAULT_MONITORING } from "./constants";
import { aggregate, diffSnapshots, METHODOLOGY_VERSION, scoreAsset, snapshotOf, type AssetSnapshot, type SnapshotDiff } from "./scoring";
import { scrubClaims, SECTION_KEYS, SECTION_TITLES, type AiReport, type Narrative, type ReportBody, type ResearchPlan } from "./schemas";
import { deterministicNarrative } from "./narrative";
import { recall, remember } from "./memory";
import { notify, recordEvent } from "./events";
import { BudgetExceededError, BudgetGuard, spentToday } from "./budget";
import { Evidence } from "./evidence";
import { Trace } from "./trace";
import { PUBLIC_MEMORY_KINDS, toolDefinitions } from "./tools";
import { planResearch, runResearchLoop, writeGroundedReport, type AiContext, type LoopResult } from "./ai-research";
import type { GroundingIssue } from "./grounding";

/**
 * Agent execution lifecycle:
 *   QUEUED → RESEARCHING → ANALYZING → PUBLISHING → COMPLETED
 *   (FAILED / CANCELLED terminal; agent-level PAUSED / DISABLED stop new runs)
 *
 * Research strategies:
 *   - AI (when an LLM is configured and within budget): the agent plans, gathers evidence with
 *     approved tools in a bounded loop, and writes a grounded, structured report.
 *   - Mechanical fallback: fixed data collection + deterministic report. Used when no LLM is
 *     configured, the provider fails, or a spending limit is reached. Reports are labelled.
 *
 * Guarantees:
 *  - Idempotent: terminal executions are never re-run; a crashed run restarts cleanly;
 *    the report is unique per execution.
 *  - Bounded: tool-call budget, model-turn cap, duplicate-call detection, execution timeout,
 *    per-agent and platform daily spend/token limits.
 *  - Traceable: every plan, tool call, LLM call, grounding check and publish is an AgentExecutionStep.
 */

export class RetryableError extends Error {}
class CancelledError extends Error {}

const TERMINAL: ExecutionStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

/** Tokens used today (kept for callers that predate USD budgets). */
export async function tokensUsedToday(agentId?: string) {
  return (await spentToday(agentId)).tokens;
}

async function setStatus(id: string, status: ExecutionStatus, extra: Prisma.AgentExecutionUpdateInput = {}) {
  await db.agentExecution.update({ where: { id }, data: { status, ...extra } });
}

async function checkCancelled(id: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new CancelledError("Execution timed out");
  const e = await db.agentExecution.findUnique({ where: { id }, select: { cancelRequested: true } });
  if (e?.cancelRequested) throw new CancelledError("Cancelled by creator");
}

/** Human-readable reason shown on fallback reports. */
export function describeFallback(err: unknown): string {
  if (err instanceof LlmNotConfiguredError) return "No LLM provider is configured.";
  if (err instanceof BudgetExceededError) return `${err.message}.`;
  if (err instanceof LlmError) {
    switch (err.kind) {
      case "quota":
        return "The LLM provider rejected requests because the account has no remaining credits or quota.";
      case "auth":
        return "The LLM provider rejected the configured API key.";
      case "rate_limit":
        return "The LLM provider was rate limiting requests.";
      case "timeout":
        return "The LLM provider did not respond in time.";
      case "invalid_output":
        return `The AI agent could not complete research reliably (${err.message.slice(0, 160)}).`;
      default:
        return `The LLM provider was unavailable (${err.message.slice(0, 160)}).`;
    }
  }
  return `AI research failed (${(err as Error)?.message?.slice(0, 160) ?? "unknown error"}).`;
}

/** Fixed, non-AI evidence collection (the original research script). */
async function collectMechanically(
  ev: Evidence,
  config: AgentConfig,
  categories: Parameters<typeof listUniverse>[0],
  trace: Trace,
) {
  const sources = new Set(config.dataSources);
  const monitoring = { ...DEFAULT_MONITORING, ...(config.monitoringCriteria as object) } as typeof DEFAULT_MONITORING;
  const maxAssets = config.reportingStyle === "CONCISE" ? 3 : config.reportingStyle === "INSTITUTIONAL" ? 6 : 5;

  const universe = await trace.step("TOOL_CALL", "rwa.list_universe", { categories }, () => listUniverse(categories), (u) => ({
    candidates: u.items.length,
    stale: u.stale,
    top: u.items.slice(0, 10).map((i) => i.p.name),
  }));
  if (!universe.items.length) throw new Error("No assets found for this specialization in the configured sources");
  if (universe.stale) ev.warnings.push("Asset registry served from cache (provider unavailable).");

  const focus = config.focusAssets.map((f) => f.toLowerCase());
  const isFocus = (p: { slug: string; name: string; symbol?: string }) =>
    focus.some((f) => p.slug.includes(f) || p.name.toLowerCase().includes(f) || p.symbol?.toLowerCase() === f);
  const selected = [...universe.items.filter((i) => isFocus(i.p)), ...universe.items.filter((i) => !isFocus(i.p))]
    .slice(0, maxAssets)
    .map((c) => c.p.slug);
  const plan = {
    mode: "fallback",
    objectives: config.researchObjectives,
    selectedAssets: selected,
    rationale: focus.length ? "Focus assets first, then the largest assets in the specialization by reported value." : "Largest assets in the specialization by reported value.",
  };
  await trace.note("PLAN", "plan.finalize", plan);

  const { assets, warnings } = await trace.step(
    "TOOL_CALL",
    "rwa.load_assets",
    { slugs: selected },
    () => loadRwaAssets({ slugs: selected, include: { yields: sources.has("defillama-yields"), prices: sources.has("defillama-prices") }, staleAfterHours: monitoring.staleDataHours }),
    (r) => ({ assets: r.assets.map((a) => ({ key: a.key, name: a.name, metrics: Object.keys(a.facts) })), warnings: r.warnings }),
  );
  ev.warnings.push(...warnings);
  if (!assets.length) throw new RetryableError("No asset data could be retrieved");
  for (const a of assets) ev.addAsset(a);

  if (sources.has("us-treasury")) {
    try {
      const t = await trace.step("TOOL_CALL", "macro.treasury_avg_rates", null, () => treasuryAverageRates(), (r) => ({ refs: r.refs.map((x) => ({ label: x.label, value: x.fact.value })) }));
      ev.addMacro(t.refs, [t.source]);
    } catch (e) {
      ev.warnings.push(`U.S. Treasury data unavailable: ${(e as Error).message}`);
    }
  }
  if (sources.has("fred")) {
    const key = env().FRED_API_KEY;
    if (!key) ev.warnings.push("FRED selected but FRED_API_KEY is not configured; skipped.");
    else {
      try {
        const f = await trace.step("TOOL_CALL", "macro.fred_rates", null, () => fredRates(key), (r) => ({ refs: r.refs.map((x) => ({ label: x.label, value: x.fact.value })) }));
        ev.addMacro(f.refs, f.sources);
      } catch (e) {
        ev.warnings.push(`FRED data unavailable: ${(e as Error).message}`);
      }
    }
  }
  if (sources.has("web")) {
    for (const url of config.customSourceUrls.slice(0, 5)) {
      try {
        const doc = await trace.step("TOOL_CALL", "web.fetch", { url }, () => safeFetch(url), (r) => ({ status: r.status, contentType: r.contentType, bytes: r.body.length }));
        if (doc.status >= 200 && doc.status < 300) {
          const text = doc.contentType.includes("html") ? htmlToText(doc.body, 6000) : doc.body.slice(0, 6000);
          const sourceId = ev.cite({ providerId: "web", title: `Creator source: ${new URL(doc.url).hostname}`, url: doc.url, retrievedAt: new Date().toISOString(), stale: false });
          ev.webDocs.push({ url: doc.url, text, sourceId });
        } else ev.warnings.push(`Source ${url} returned HTTP ${doc.status}`);
      } catch (e) {
        if ((e as Error).message.startsWith("Tool call budget")) throw e;
        ev.warnings.push(`Source ${url} could not be fetched: ${(e as Error).message}`);
      }
    }
  }
}

export async function runExecution(executionId: string, opts: { signal?: AbortSignal; attempt?: number; finalAttempt?: boolean } = {}) {
  const execution = await db.agentExecution.findUnique({
    where: { id: executionId },
    include: { agent: { include: { config: true, schedule: true } }, report: { select: { id: true } } },
  });
  if (!execution) return { skipped: "missing" as const };
  if (TERMINAL.includes(execution.status)) return { skipped: "terminal" as const };
  if (execution.report) {
    await setStatus(executionId, "COMPLETED", { finishedAt: new Date() });
    return { skipped: "already-published" as const };
  }
  const { agent } = execution;
  const config = agent.config;
  if (!config) throw new Error("Agent configuration missing");
  if (agent.adminDisabled || agent.status !== "ACTIVE") {
    await setStatus(executionId, "CANCELLED", { finishedAt: new Date(), error: `Agent is ${agent.adminDisabled ? "disabled by admin" : agent.status.toLowerCase()}` });
    return { skipped: "inactive" as const };
  }

  // Restart cleanly if a previous attempt crashed mid-flight.
  await db.agentExecutionStep.deleteMany({ where: { executionId } });
  await setStatus(executionId, "RESEARCHING", { startedAt: new Date(), attempt: opts.attempt ?? execution.attempt + 1, error: null });
  await db.agent.update({ where: { id: agent.id }, data: { lastRunAt: new Date() } });
  await recordEvent(db, { type: "RESEARCH_STARTED", agentId: agent.id, actor: "worker", message: `${agent.name} started a research run`, data: { executionId, trigger: execution.trigger } });

  const trace = new Trace(executionId, config.maxToolCalls);
  const spec = SPECIALIZATIONS.find((s) => s.id === agent.specialization)!;
  const monitoring = { ...DEFAULT_MONITORING, ...(config.monitoringCriteria as object) } as typeof DEFAULT_MONITORING;
  const cancelCheck = () => checkCancelled(executionId, opts.signal);

  let evidence = new Evidence();
  let guard: BudgetGuard | undefined;
  let mode: "ai" | "fallback" = "fallback";
  let fallbackReason: string | undefined;
  let plan: ResearchPlan | undefined;
  let loop: LoopResult | undefined;
  let model: string | undefined;
  const errorUsage: Usage = { promptTokens: 0, completionTokens: 0 }; // usage consumed by failed calls

  const totals = () => {
    const u = { promptTokens: (guard?.usage.promptTokens ?? 0) + errorUsage.promptTokens, completionTokens: (guard?.usage.completionTokens ?? 0) + errorUsage.completionTokens };
    return { ...u, costUsd: (guard?.costUsd ?? 0) + estimateCostUsd(errorUsage), calls: guard?.calls ?? 0 };
  };
  const switchToFallback = async (err: unknown, stage: string) => {
    if (err instanceof CancelledError) throw err;
    const u = (err as { usage?: Usage }).usage;
    if (u) {
      errorUsage.promptTokens += u.promptTokens;
      errorUsage.completionTokens += u.completionTokens;
    }
    mode = "fallback";
    fallbackReason = describeFallback(err);
    await trace.note("ERROR", `ai.fallback.${stage}`, { reason: fallbackReason, error: (err as Error)?.message?.slice(0, 500) }, false);
  };

  try {
    const memories = await recall(agent.id, `${config.researchObjectives.join(" ")} ${agent.objectives.join(" ")}`, { limit: 10, kinds: PUBLIC_MEMORY_KINDS });
    const monitored = await db.monitoredAsset.findMany({ where: { agentId: agent.id } });

    // ── RESEARCHING (AI) ─────────────────────────────────────────
    if (llmConfigured()) {
      try {
        guard = await BudgetGuard.forAgent(agent.id, config);
        const aiCtx: AiContext = { agent, config, categories: spec.categories, memories, monitored, evidence, trace, guard, signal: opts.signal, checkCancelled: cancelCheck };
        const toolNames = toolDefinitions({ agentId: agent.id, categories: spec.categories, config, evidence, trace }).map((t) => t.function.name);
        const p = await planResearch(aiCtx, toolNames);
        plan = p.plan;
        model = p.model;
        await trace.note("PLAN", "plan.finalize", { mode: "ai", ...plan });
        await db.agentExecution.update({ where: { id: executionId }, data: { plan: { mode: "ai", ...plan } as unknown as Prisma.InputJsonValue } });
        await cancelCheck();
        loop = await runResearchLoop(aiCtx, plan);
        model = loop.model;
        mode = "ai";
      } catch (err) {
        await switchToFallback(err, "research");
      }
    } else {
      fallbackReason = describeFallback(new LlmNotConfiguredError());
    }

    // ── RESEARCHING (mechanical fallback) ────────────────────────
    if (mode === "fallback") {
      evidence = new Evidence(); // never mix partial AI evidence into a fallback report
      await collectMechanically(evidence, config, spec.categories, trace);
      await db.agentExecution.update({ where: { id: executionId }, data: { plan: { mode: "fallback", reason: fallbackReason } } });
    }
    await cancelCheck();

    // ── ANALYZING ────────────────────────────────────────────────
    await setStatus(executionId, "ANALYZING");
    const assets = evidence.assetList;
    const refRate = evidence.macro.find((m) => m.key === "fred:DGS3MO")?.fact.value ?? evidence.macro.find((m) => m.key === "treasury:treasury-bills")?.fact.value;
    const scores = assets.map((a) => scoreAsset(a, { sensitivity: config.riskSensitivity, referenceRatePct: refRate }));
    const agg = aggregate(scores, assets);
    const diffs: SnapshotDiff[] = assets.flatMap((a) =>
      diffSnapshots(a.name, a.key, monitored.find((m) => m.assetKey === a.key)?.lastSnapshot as AssetSnapshot | null, snapshotOf(a), monitoring),
    );
    await trace.note("ANALYSIS", "risk.score", {
      methodology: METHODOLOGY_VERSION,
      referenceRatePct: refRate ?? null,
      aggregate: agg,
      assets: scores.map((s) => ({ key: s.assetKey, score: s.score, level: s.level, confidence: s.confidence })),
      changes: diffs,
    });

    let aiReport: AiReport | undefined;
    let groundingIssues: GroundingIssue[] = [];
    if (mode === "ai" && plan && loop) {
      try {
        const g = await writeGroundedReport(
          { agent, config, categories: spec.categories, memories, monitored, evidence, trace, guard: guard!, signal: opts.signal, checkCancelled: cancelCheck },
          { plan, notes: loop.notes, scores, aggregate: agg, diffs },
        );
        aiReport = g.report;
        groundingIssues = g.issues;
        model = g.model;
      } catch (err) {
        // Evidence is real and already collected; only the narrative falls back.
        await switchToFallback(err, "report");
      }
    }
    const narrative: Narrative =
      aiReport ??
      deterministicNarrative({
        agentName: agent.name,
        specializationLabel: specializationLabel(agent.specialization),
        assets,
        scores,
        aggregate: agg,
        macro: evidence.macro,
        diffs,
        sourceIdFor: (url) => evidence.sourceIdFor(url),
        style: config.reportingStyle,
      });
    if (mode === "fallback") {
      evidence.warnings.unshift(`Fallback report: written by the mechanical engine, not the AI agent. ${fallbackReason ?? ""}`.trim());
    }
    await cancelCheck();

    // ── PUBLISHING ───────────────────────────────────────────────
    await setStatus(executionId, "PUBLISHING");
    const sourceIndex = evidence.sourceIndex;
    const validIds = new Set(Object.keys(sourceIndex));
    const narrativeBy = aiReport ? `llm:${model ?? env().LLM_MODEL}` : "deterministic";
    const basis = aiReport ? ("interpretation" as const) : ("derived" as const);
    const t = totals();
    const body: ReportBody = {
      mode: aiReport ? "ai" : "fallback",
      fallbackReason: aiReport ? undefined : fallbackReason,
      plan,
      reasoning: aiReport?.reasoning,
      riskAssessment: aiReport?.riskAssessment,
      groundingIssues,
      toolSummary: loop?.toolLog,
      usage: { promptTokens: t.promptTokens, completionTokens: t.completionTokens, costUsd: Number(t.costUsd.toFixed(6)), modelCalls: t.calls },
      sections: SECTION_KEYS.map((k) => ({
        key: k,
        title: SECTION_TITLES[k],
        text: scrubClaims(narrative.sections[k].text),
        sourceIds: narrative.sections[k].sourceIds.filter((s) => validIds.has(s)),
        basis,
      })),
      keyFindings: aiReport
        ? aiReport.keyFindings.map((f) => ({ text: f.text, reasoning: f.reasoning, importance: f.importance, novelty: f.novelty, sourceIds: f.sourceIds, basis }))
        : narrative.keyFindings.map((f) => ({ text: scrubClaims(f.text), sourceIds: f.sourceIds.filter((s) => validIds.has(s)), basis })),
      uncertainties: narrative.uncertainties.map(scrubClaims),
      changes: diffs,
      macro: evidence.macro.map((m) => ({ key: m.key, label: m.label, value: m.fact.value, unit: m.fact.unit, url: m.fact.url, asOf: m.fact.asOf, stale: m.fact.stale })),
      warnings: evidence.warnings,
      sourceIndex,
      narrativeBy,
    };
    const allSources = evidence.allSources;

    const report = await trace.step("PUBLISH", "report.publish", { assets: assets.length, sources: allSources.length, mode: body.mode }, () =>
      db.$transaction(async (tx) => {
        const rep = await tx.researchReport.create({
          data: {
            agentId: agent.id,
            executionId,
            title: scrubClaims(narrative.title).slice(0, 140) || "Research report",
            summary: scrubClaims(narrative.summary),
            body: body as unknown as Prisma.InputJsonValue,
            riskScore: agg.score,
            riskLevel: agg.level,
            confidence: agg.confidence,
            methodology: METHODOLOGY_VERSION,
            narrativeBy,
            sources: {
              create: allSources.map((s) => ({
                providerId: s.providerId,
                title: s.title.slice(0, 300),
                url: s.url,
                retrievedAt: new Date(s.retrievedAt),
                dataTimestamp: s.dataTimestamp ? new Date(s.dataTimestamp) : null,
                stale: s.stale,
              })),
            },
            assets: {
              create: assets.map((a) => {
                const s = scores.find((x) => x.assetKey === a.key)!;
                return {
                  assetKey: a.key,
                  name: a.name,
                  category: a.category,
                  facts: { ...a, sources: a.sources } as unknown as Prisma.InputJsonValue,
                  riskScore: s.score,
                  riskLevel: s.level,
                  factors: s.factors as unknown as Prisma.InputJsonValue,
                };
              }),
            },
          },
        });
        for (const a of assets) {
          await tx.monitoredAsset.upsert({
            where: { agentId_assetKey: { agentId: agent.id, assetKey: a.key } },
            create: { agentId: agent.id, assetKey: a.key, name: a.name, category: a.category, lastSnapshot: snapshotOf(a) as unknown as Prisma.InputJsonValue, lastCheckedAt: new Date() },
            update: { name: a.name, lastSnapshot: snapshotOf(a) as unknown as Prisma.InputJsonValue, lastCheckedAt: new Date() },
          });
        }
        await tx.agent.update({ where: { id: agent.id }, data: { lastSuccessAt: new Date() } });
        await tx.agentExecution.update({
          where: { id: executionId },
          data: {
            status: "COMPLETED",
            finishedAt: new Date(),
            summary: narrative.summary.slice(0, 1000),
            llmModel: t.calls ? model : undefined,
            promptTokens: t.promptTokens,
            completionTokens: t.completionTokens,
            costUsd: t.costUsd,
            toolCalls: trace.toolCalls,
            mode: body.mode,
            fallbackReason: body.fallbackReason ?? null,
          },
        });
        if (t.promptTokens || t.completionTokens) {
          await tx.usageRecord.create({
            data: { agentId: agent.id, userId: agent.ownerId, kind: "llm_research", model, promptTokens: t.promptTokens, completionTokens: t.completionTokens, costUsd: t.costUsd },
          });
        }
        await recordEvent(tx, { type: "REPORT_PUBLISHED", agentId: agent.id, actor: "worker", message: `${agent.name} published “${rep.title}”`, data: { reportId: rep.id, riskScore: agg.score, mode: body.mode } });
        await recordEvent(tx, {
          type: "RESEARCH_COMPLETED",
          agentId: agent.id,
          actor: "worker",
          message: `${agent.name} completed ${body.mode === "ai" ? "AI" : "fallback"} research on ${assets.length} asset(s)`,
          data: { executionId },
        });
        await notify(tx, { userId: agent.ownerId, kind: "report", title: `New report from ${agent.name}`, body: rep.title, link: `/agents/${agent.slug}/research#${rep.id}` });
        if (body.mode === "fallback" && llmConfigured()) {
          await notify(tx, { userId: agent.ownerId, kind: "failure", title: `${agent.name}: AI unavailable, fallback report published`, body: fallbackReason ?? "", link: `/dashboard/agents/${agent.id}?tab=executions` });
        }
        const alerts = diffs.filter((d) => d.breached);
        if (alerts.length) {
          await notify(tx, {
            userId: agent.ownerId,
            kind: "alert",
            title: `${agent.name}: monitoring threshold crossed`,
            body: alerts.map((d) => `${d.name} ${d.metric} ${d.unit === "bps" ? `${d.change.toFixed(0)} bps` : `${d.change.toFixed(2)}%`}`).join("; "),
            link: `/agents/${agent.slug}/research#${rep.id}`,
          });
        }
        return rep;
      }),
      (r) => ({ reportId: r.id }),
    );

    await trace
      .step("MEMORY", "memory.store", null, () =>
        remember(agent.id, [
          { kind: "REPORT_SUMMARY", content: `[${report.id}] ${narrative.title}: ${narrative.summary}`, data: { reportId: report.id, mode: body.mode }, importance: 3 },
          ...body.keyFindings.map((f) => ({
            kind: "FINDING" as const,
            content: f.text,
            data: { reportId: report.id, importance: f.importance ?? null, novelty: f.novelty ?? null },
            importance: f.importance === "high" ? 3 : 2,
          })),
          {
            kind: "EXECUTION_SUMMARY",
            content: `Run ${executionId} (${body.mode}): ${assets.length} assets, aggregate risk ${agg.score}/100${plan ? `; goal: ${plan.goal}` : ""}${fallbackReason && body.mode === "fallback" ? `; fallback: ${fallbackReason}` : ""}`,
            data: { executionId },
          },
          ...allSources.slice(0, 10).map((s) => ({ kind: "SOURCE_REFERENCE" as const, content: `${s.title} — ${s.url}`, data: { url: s.url } })),
        ]),
      )
      .catch(() => undefined); // memory failures never fail a published report

    return { reportId: report.id, mode: body.mode };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const t = totals();
    if (err instanceof CancelledError) {
      await setStatus(executionId, "CANCELLED", { finishedAt: new Date(), error: message, toolCalls: trace.toolCalls, promptTokens: t.promptTokens, completionTokens: t.completionTokens, costUsd: t.costUsd });
      if (t.promptTokens || t.completionTokens) {
        await db.usageRecord.create({ data: { agentId: agent.id, userId: agent.ownerId, kind: "llm_research", model, promptTokens: t.promptTokens, completionTokens: t.completionTokens, costUsd: t.costUsd } });
      }
      return { cancelled: true };
    }
    await trace.note("ERROR", "execution.error", { message }, false).catch(() => undefined);
    const retryable = err instanceof RetryableError || err instanceof ProviderError || (err instanceof LlmError && err.transient);
    if (retryable && !opts.finalAttempt) {
      await setStatus(executionId, "QUEUED", { error: `Attempt failed, will retry: ${message}`.slice(0, 1000) });
      if (t.promptTokens || t.completionTokens) {
        await db.usageRecord.create({ data: { agentId: agent.id, userId: agent.ownerId, kind: "llm_research", model, promptTokens: t.promptTokens, completionTokens: t.completionTokens, costUsd: t.costUsd } });
      }
      throw err; // queue applies backoff
    }
    await db.$transaction(async (tx) => {
      await tx.agentExecution.update({
        where: { id: executionId },
        data: { status: "FAILED", finishedAt: new Date(), error: message.slice(0, 1000), toolCalls: trace.toolCalls, promptTokens: t.promptTokens, completionTokens: t.completionTokens, costUsd: t.costUsd },
      });
      if (t.promptTokens || t.completionTokens) {
        await tx.usageRecord.create({ data: { agentId: agent.id, userId: agent.ownerId, kind: "llm_research", model, promptTokens: t.promptTokens, completionTokens: t.completionTokens, costUsd: t.costUsd } });
      }
      await recordEvent(tx, { type: "RESEARCH_FAILED", agentId: agent.id, actor: "worker", message: `${agent.name} research run failed`, data: { executionId, error: message.slice(0, 300) } });
      await notify(tx, { userId: agent.ownerId, kind: "failure", title: `${agent.name}: research run failed`, body: message.slice(0, 300), link: `/dashboard/agents/${agent.id}` });
    });
    return { failed: message };
  }
}

/**
 * Cheap monitoring pass for EVENT_TRIGGERED / CONTINUOUS agents: refreshes snapshots of
 * monitored assets and requests a full research run only if a threshold was crossed.
 */
export async function runMonitor(agentId: string): Promise<{ triggered: boolean; diffs: SnapshotDiff[] }> {
  const agent = await db.agent.findUnique({ where: { id: agentId }, include: { config: true, monitoredAssets: true } });
  if (!agent || agent.status !== "ACTIVE" || agent.adminDisabled || !agent.config) return { triggered: false, diffs: [] };
  if (!agent.monitoredAssets.length) return { triggered: false, diffs: [] };
  const monitoring = { ...DEFAULT_MONITORING, ...(agent.config.monitoringCriteria as object) } as typeof DEFAULT_MONITORING;
  const slugs = agent.monitoredAssets.map((m) => m.assetKey.replace(/^defillama:/, ""));
  const { assets } = await loadRwaAssets({
    slugs,
    include: { yields: agent.config.dataSources.includes("defillama-yields"), prices: agent.config.dataSources.includes("defillama-prices") },
    staleAfterHours: monitoring.staleDataHours,
  });
  const diffs = assets.flatMap((a) =>
    diffSnapshots(a.name, a.key, agent.monitoredAssets.find((m) => m.assetKey === a.key)?.lastSnapshot as AssetSnapshot | null, snapshotOf(a), monitoring),
  );
  await db.monitoredAsset.updateMany({ where: { agentId }, data: { lastCheckedAt: new Date() } });
  const breached = diffs.filter((d) => d.breached);
  if (!breached.length) return { triggered: false, diffs };

  const reason = breached
    .map((d) => `${d.name} ${d.metric} ${d.unit === "bps" ? `${d.change.toFixed(0)} bps` : `${d.change.toFixed(2)}%`}`)
    .join("; ");
  const { requestExecutionDetailed } = await import("./lifecycle");
  // One event-triggered run per hour at most (idempotency key bucket) — prevents trigger storms.
  const bucket = Math.floor(Date.now() / 3600_000);
  const res = await requestExecutionDetailed({ agentId, trigger: "EVENT", reason, idempotencyKey: `event:${agentId}:${bucket}` }).catch(() => null);
  if (!res?.created) return { triggered: false, diffs }; // limit reached, already running, or already triggered this hour
  const exec = res.execution;
  await recordEvent(db, { type: "MONITOR_ALERT", agentId, actor: "worker", message: `${agent.name} detected: ${reason}`.slice(0, 500), data: { diffs: breached, executionId: exec.id } as unknown as Prisma.InputJsonValue });
  return { triggered: true, diffs };
}
