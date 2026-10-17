import type { Agent, AgentConfig, AgentMemory, MonitoredAsset } from "@prisma/client";
import { env } from "@/lib/env";
import { chatJson, chatWithTools, LlmError, type ChatMessage } from "@/lib/llm/client";
import type { RwaCategory } from "@/lib/providers/types";
import { BudgetGuard, estimateTokens } from "./budget";
import { DEFAULT_MONITORING, specializationLabel } from "./constants";
import type { Evidence } from "./evidence";
import { allowedNumbers, dropRepeats, groundCitations, groundText, type GroundingIssue } from "./grounding";
import { ANALYST_SYSTEM, PLANNING_SYSTEM, RESEARCH_AGENT_SYSTEM, untrusted } from "./prompts";
import { aiReportSchema, researchPlanSchema, scrubClaims, SECTION_KEYS, type AiReport, type ResearchPlan } from "./schemas";
import { METHODOLOGY_VERSION, type AssetScore, type SnapshotDiff } from "./scoring";
import { Toolkit, toolDefinitions, type ToolContext } from "./tools";
import type { Trace } from "./trace";

/**
 * The AI research pipeline:
 *   1. plan      — the agent writes a research plan from its specialization, objectives,
 *                  monitoring thresholds, prior findings and stored asset snapshots
 *   2. research  — bounded tool-calling loop over approved tools (turn cap, tool-call budget,
 *                  duplicate-call detection, spending limits, timeout/cancellation)
 *   3. report    — structured report written from the collected evidence and deterministic
 *                  risk scores, then grounded (citations, numbers, repeated findings)
 *
 * Any LLM failure or exhausted budget propagates to the engine, which completes the run with
 * the mechanical pipeline and labels the report as a fallback.
 */

export interface AiContext {
  agent: Pick<Agent, "id" | "name" | "specialization" | "objectives">;
  config: AgentConfig;
  categories: RwaCategory[];
  memories: AgentMemory[];
  monitored: MonitoredAsset[];
  evidence: Evidence;
  trace: Trace;
  guard: BudgetGuard;
  signal?: AbortSignal;
  checkCancelled: () => Promise<void>;
}

const PLAN_MAX_TOKENS = 700;
const TURN_MAX_TOKENS = 900;

function agentBrief(ctx: AiContext) {
  const monitoring = { ...DEFAULT_MONITORING, ...(ctx.config.monitoringCriteria as object) };
  return [
    `AGENT: ${ctx.agent.name}. Specialization: ${specializationLabel(ctx.agent.specialization)}. Risk sensitivity: ${ctx.config.riskSensitivity}. Reporting style: ${ctx.config.reportingStyle}.`,
    `CREATOR OBJECTIVES AND FOCUS:\n${untrusted(
      "creator_config",
      JSON.stringify({ objectives: ctx.agent.objectives, researchObjectives: ctx.config.researchObjectives, focusAssets: ctx.config.focusAssets }),
      2500,
    )}`,
    `MONITORING THRESHOLDS: ${JSON.stringify(monitoring)}`,
    `PREVIOUSLY MONITORED ASSETS: ${ctx.monitored.length ? ctx.monitored.map((m) => `${m.assetKey.replace(/^defillama:/, "")} (${m.name})`).join(", ") : "none — this is the first run"}`,
    `PRIOR FINDINGS AND REPORTS:\n${untrusted("agent_memory", ctx.memories.map((m) => `[${m.kind} ${m.createdAt.toISOString().slice(0, 10)}] ${m.content}`).join("\n") || "none", 4000)}`,
  ].join("\n\n");
}

export async function planResearch(ctx: AiContext, toolNames: string[]): Promise<{ plan: ResearchPlan; model: string }> {
  const messages: ChatMessage[] = [
    { role: "system", content: PLANNING_SYSTEM },
    {
      role: "user",
      content: `${agentBrief(ctx)}\n\nAPPROVED TOOLS: ${toolNames.join(", ")}\nTOOL CALL BUDGET: ${ctx.trace.toolBudgetLeft}\n\nWrite the research plan for this run.`,
    },
  ];
  ctx.guard.assertCanSpend(estimateTokens(messages) + 600, PLAN_MAX_TOKENS);
  const r = await ctx.trace.step(
    "LLM_CALL",
    "agent.plan",
    { tools: toolNames },
    () => chatJson({ schema: researchPlanSchema, schemaName: "research_plan", messages, maxTokens: PLAN_MAX_TOKENS, signal: ctx.signal }),
    (r) => r.data,
  );
  ctx.guard.record(r.usage);
  // Plans may only reference approved tools; anything else is dropped.
  const plan = { ...r.data, steps: r.data.steps.filter((s) => toolNames.includes(s.tool)) };
  if (!plan.steps.length) plan.steps = [{ tool: "search_rwa_assets", purpose: "Identify relevant assets" }];
  return { plan, model: r.model };
}

export interface LoopResult {
  notes: string;
  turns: number;
  toolLog: { name: string; ok: boolean }[];
  violations: { name: string; reason: string }[];
  stopReason: "completed" | "turn_limit" | "tool_budget" | "loop_protection";
  model: string;
}

export async function runResearchLoop(ctx: AiContext, plan: ResearchPlan): Promise<LoopResult> {
  const toolCtx: ToolContext = { agentId: ctx.agent.id, categories: ctx.categories, config: ctx.config, evidence: ctx.evidence, trace: ctx.trace };
  const toolkit = new Toolkit(toolCtx);
  const tools = toolDefinitions(toolCtx);
  const maxTurns = env().AI_MAX_RESEARCH_TURNS;
  const messages: ChatMessage[] = [
    { role: "system", content: RESEARCH_AGENT_SYSTEM },
    {
      role: "user",
      content: `${agentBrief(ctx)}\n\nYOUR RESEARCH PLAN:\n${JSON.stringify(plan)}\n\nTool call budget for this run: ${ctx.trace.toolBudgetLeft}. Begin.`,
    },
  ];
  const toolLog: LoopResult["toolLog"] = [];
  let model = env().LLM_MODEL ?? "";
  let stopReason: LoopResult["stopReason"] = "turn_limit";
  let notes = "";

  for (let turn = 1; turn <= maxTurns; turn++) {
    await ctx.checkCancelled();
    const last = turn === maxTurns || toolkit.exhausted;
    if (toolkit.exhausted) {
      stopReason = toolkit.duplicates >= 3 ? "loop_protection" : "tool_budget";
      messages.push({ role: "user", content: "Your tool budget is exhausted. Do not call tools. Write your research notes now." });
    } else if (turn === maxTurns) {
      messages.push({ role: "user", content: "This is your final turn. Do not call tools. Write your research notes now." });
    }
    ctx.guard.assertCanSpend(estimateTokens(messages), TURN_MAX_TOKENS);
    const res = await ctx.trace.step(
      "LLM_CALL",
      `agent.turn_${turn}`,
      { messages: messages.length, toolChoice: last ? "none" : "auto" },
      () => chatWithTools({ messages, tools, toolChoice: last ? "none" : "auto", maxTokens: TURN_MAX_TOKENS, signal: ctx.signal }),
      (r) => ({ requestedTools: r.toolCalls.map((t) => t.function.name), text: r.content?.slice(0, 500) ?? null, usage: r.usage }),
    );
    ctx.guard.record(res.usage);
    model = res.model;

    if (!res.toolCalls.length || last) {
      notes = res.content ?? "";
      if (!last) stopReason = "completed";
      break;
    }
    messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });
    for (const call of res.toolCalls) {
      const out = await toolkit.execute(call);
      toolLog.push({ name: out.name, ok: out.ok });
      messages.push({ role: "tool", tool_call_id: call.id, content: out.content });
    }
  }

  await ctx.trace.note("ANALYSIS", "agent.research_complete", {
    stopReason,
    toolCalls: toolLog.length,
    violations: toolkit.violations,
    assetsCollected: ctx.evidence.assets.size,
    notes: notes.slice(0, 1500),
  });
  if (!ctx.evidence.assets.size) {
    throw new LlmError("Agent finished research without collecting any asset data", "invalid_output");
  }
  return { notes, turns: toolLog.length, toolLog, violations: toolkit.violations, stopReason, model };
}

export interface GroundedReport {
  report: AiReport;
  issues: GroundingIssue[];
  model: string;
}

export async function writeGroundedReport(
  ctx: AiContext,
  input: {
    plan: ResearchPlan;
    notes: string;
    scores: AssetScore[];
    aggregate: { score: number; level: string; confidence: number };
    diffs: SnapshotDiff[];
  },
): Promise<GroundedReport> {
  const ev = ctx.evidence;
  const assets = ev.assetList;
  const facts = assets.map((a) => ({
    key: a.key.replace(/^defillama:/, ""),
    name: a.name,
    symbol: a.symbol ?? null,
    category: a.category,
    networks: a.networks,
    auditCount: a.auditCount ?? null,
    website: a.website ?? null,
    facts: Object.fromEntries(Object.entries(a.facts).map(([k, f]) => [k, { value: f!.value, unit: f!.unit ?? null, asOf: f!.asOf, stale: f!.stale, source: ev.sourceIdFor(f!.url) }])),
    notAvailable: a.unavailable,
  }));
  const maxTokens = ctx.config.reportingStyle === "CONCISE" ? 3000 : 4500;
  const messages: ChatMessage[] = [
    { role: "system", content: ANALYST_SYSTEM },
    {
      role: "user",
      content: [
        agentBrief(ctx),
        `RESEARCH PLAN: ${JSON.stringify(input.plan)}`,
        `YOUR RESEARCH NOTES:\n${untrusted("agent_notes", input.notes || "(none)", 3000)}`,
        `VERIFIED FACTS:\n${JSON.stringify(facts)}`,
        `REFERENCE RATES: ${JSON.stringify(ev.macro.map((m) => ({ label: m.label, valuePct: m.fact.value, source: ev.sourceIdFor(m.fact.url) })))}`,
        `RISK SCORES (${METHODOLOGY_VERSION}, 0-100, higher = riskier): aggregate ${JSON.stringify(input.aggregate)}; per asset ${JSON.stringify(
          input.scores.map((s) => ({ key: s.assetKey.replace(/^defillama:/, ""), score: s.score, level: s.level, confidence: s.confidence, factors: s.factors.map((f) => ({ factor: f.label, score: f.score })) })),
        )}`,
        `CHANGES SINCE PREVIOUS RUN: ${JSON.stringify(input.diffs.map((d) => ({ asset: d.name, metric: d.metric, previous: d.previous, current: d.current, change: Number(d.change.toFixed(3)), unit: d.unit, thresholdCrossed: d.breached })))}`,
        ...ev.webDocs.map((d) => `CREATOR DOCUMENT ${d.sourceId}:\n${untrusted(d.url, d.text, 3000)}`),
        `SOURCES: ${JSON.stringify(ev.sourceIndex)}`,
        `DATA WARNINGS: ${JSON.stringify(ev.warnings)}`,
        "Write the structured report now.",
      ].join("\n\n"),
    },
  ];
  ctx.guard.assertCanSpend(estimateTokens(messages) + 1500, maxTokens);
  const r = await ctx.trace.step(
    "LLM_CALL",
    "analyst.write_report",
    { assets: assets.length, style: ctx.config.reportingStyle },
    () => chatJson({ schema: aiReportSchema, schemaName: "rwa_research_report", messages, maxTokens, signal: ctx.signal }),
    (r) => ({ title: r.data.title, findings: r.data.keyFindings.length }),
  );
  ctx.guard.record(r.usage);

  // ── Grounding ────────────────────────────────────────────────
  const issues: GroundingIssue[] = [];
  const allowed = allowedNumbers({ assets, macro: ev.macro, scores: input.scores, diffs: input.diffs, aggregate: input.aggregate, extra: [ev.allSources.length] });
  const index = ev.sourceIndex;
  const clean = (text: string, where: string) => {
    const scrubbed = scrubClaims(text);
    if (scrubbed.length < text.length) issues.push({ kind: "prohibited_claim", detail: `${where}: removed a guaranteed-return style claim` });
    return groundText(scrubbed, allowed, where, issues);
  };
  const rep = r.data;
  const grounded: AiReport = {
    ...rep,
    title: clean(rep.title, "title") || `${specializationLabel(ctx.agent.specialization)} research`,
    summary: clean(rep.summary, "summary") || "Summary removed by grounding checks; see findings and verified facts.",
    reasoning: clean(rep.reasoning, "reasoning"),
    riskAssessment: { text: clean(rep.riskAssessment.text, "riskAssessment"), sourceIds: groundCitations(rep.riskAssessment.sourceIds, index, "riskAssessment", issues) },
    sections: Object.fromEntries(
      SECTION_KEYS.map((k) => [k, { text: clean(rep.sections[k].text, k), sourceIds: groundCitations(rep.sections[k].sourceIds, index, k, issues) }]),
    ) as AiReport["sections"],
    keyFindings: rep.keyFindings
      .map((f, i) => ({ ...f, text: clean(f.text, `finding ${i + 1}`), reasoning: clean(f.reasoning, `finding ${i + 1} reasoning`), sourceIds: groundCitations(f.sourceIds, index, `finding ${i + 1}`, issues) }))
      .filter((f) => f.text.length >= 10),
    uncertainties: rep.uncertainties.map((u, i) => clean(u, `uncertainty ${i + 1}`)).filter(Boolean),
  };
  const previous = ctx.memories.filter((m) => m.kind === "FINDING").map((m) => m.content);
  grounded.keyFindings = dropRepeats(
    grounded.keyFindings.length ? grounded.keyFindings : [{ text: `Aggregate risk ${input.aggregate.score}/100 (${input.aggregate.level}).`, reasoning: "", importance: "medium", novelty: "new", sourceIds: [] }],
    previous,
    issues,
  );
  await ctx.trace.note("ANALYSIS", "grounding.check", { issues, findingsKept: grounded.keyFindings.length }, issues.length === 0);
  return { report: grounded, issues, model: r.model };
}
