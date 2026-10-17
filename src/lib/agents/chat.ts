import type { Agent, AgentConfig } from "@prisma/client";
import { db } from "@/lib/db";
import { env, llmConfigured } from "@/lib/env";
import { chatStream, type ChatMessage, type Usage, estimateCostUsd } from "@/lib/llm/client";
import type { NormalizedAsset } from "@/lib/providers/types";
import { BudgetGuard, estimateTokens, startOfUtcDay } from "./budget";
import { specializationLabel } from "./constants";
import { describeFallback } from "./engine";
import { recall } from "./memory";
import { chatSystem, untrusted } from "./prompts";
import { scrubClaims, type ReportBody } from "./schemas";

/**
 * Public Q&A grounded in an agent's published research.
 *  - Context = the 3 latest public reports (summary, findings, verified facts with source ids)
 *    + monitored assets + the most relevant public memories. Hidden reports are excluded.
 *  - The model cites sources as [R1·S2] (report 1, source 2). Citations are validated after the
 *    answer; unknown ones are reported to the reader and never stored as citations.
 *  - Spending limits are shared with research (agent USD/tokens) plus a chat-only token budget.
 *  - If the LLM is unavailable or over budget, the reader gets the most relevant published
 *    findings instead, clearly labelled as not AI-generated.
 */

const PUBLIC_MEMORY = ["REPORT_SUMMARY", "FINDING", "SOURCE_REFERENCE", "EXECUTION_SUMMARY"] as const;
const CHAT_MAX_TOKENS = 700;

export interface ChatCitation {
  marker: string;
  reportId: string;
  reportTitle: string;
  sourceId?: string;
  title?: string;
  url?: string;
}

export interface ChatContext {
  text: string;
  citationIndex: Map<string, ChatCitation>;
  reportCount: number;
  memories: { kind: string; content: string }[];
}

const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Number(n.toFixed(4)).toString());

export async function buildChatContext(agentId: string, question: string): Promise<ChatContext> {
  const [reports, memories, monitored] = await Promise.all([
    db.researchReport.findMany({
      where: { agentId, hidden: false },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { assets: { select: { name: true, riskScore: true, riskLevel: true, facts: true } } },
    }),
    recall(agentId, question, { limit: 6, kinds: [...PUBLIC_MEMORY] }),
    db.monitoredAsset.findMany({ where: { agentId }, select: { name: true, category: true } }),
  ]);
  const citationIndex = new Map<string, ChatCitation>();
  const blocks = reports.map((r, i) => {
    const R = `R${i + 1}`;
    const b = r.body as unknown as ReportBody;
    citationIndex.set(R, { marker: R, reportId: r.id, reportTitle: r.title });
    for (const [sid, s] of Object.entries(b.sourceIndex ?? {})) {
      citationIndex.set(`${R}·${sid}`, { marker: `${R}·${sid}`, reportId: r.id, reportTitle: r.title, sourceId: sid, title: s.title, url: s.url });
    }
    const facts = r.assets.map((a) => {
      const asset = a.facts as unknown as NormalizedAsset;
      const f = Object.entries(asset.facts ?? {})
        .map(([k, v]) => {
          const sid = Object.entries(b.sourceIndex ?? {}).find(([, s]) => s.url === v?.url)?.[0];
          return v ? `${k}=${fmt(v.value)}${v.unit === "%" ? "%" : ""}${sid ? ` [${R}·${sid}]` : ""}${v.stale ? " (stale)" : ""}` : "";
        })
        .filter(Boolean)
        .join(", ");
      return `  - ${a.name}: risk ${a.riskScore}/100 ${a.riskLevel}; ${f || "no metrics"}`;
    });
    return [
      `${R} — "${r.title}" (${r.createdAt.toISOString().slice(0, 10)}, ${b.mode === "fallback" || r.narrativeBy === "deterministic" ? "mechanical report" : "AI report"}), aggregate risk ${r.riskScore}/100 ${r.riskLevel}, confidence ${r.confidence}%`,
      `Summary: ${r.summary}`,
      b.riskAssessment ? `Risk assessment: ${b.riskAssessment.text}` : "",
      `Key findings: ${b.keyFindings.map((f) => `${f.text}${f.sourceIds.length ? ` [${f.sourceIds.map((s) => `${R}·${s}`).join(", ")}]` : ""}`).join(" | ")}`,
      `Verified facts:\n${facts.join("\n")}`,
      `Changes since prior run: ${(b.changes ?? []).map((c) => `${c.name} ${c.metric} ${c.change.toFixed(2)}${c.unit === "bps" ? " bps" : "%"}`).join("; ") || "none recorded"}`,
      `Uncertainties: ${(b.uncertainties ?? []).join(" | ") || "none listed"}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  const text = [
    `MONITORED ASSETS: ${monitored.map((m) => `${m.name} (${m.category})`).join(", ") || "none yet"}`,
    ...blocks,
    `RELEVANT MEMORY: ${memories.map((m) => m.content).join(" | ") || "none"}`,
  ].join("\n\n");
  return { text, citationIndex, reportCount: reports.length, memories: memories.map((m) => ({ kind: m.kind, content: m.content })) };
}

export function validateCitations(answer: string, index: Map<string, ChatCitation>) {
  const markers = [...new Set([...answer.matchAll(/\[(R\d+(?:·S\d+)?(?:,\s*R\d+(?:·S\d+)?)*)\]/g)].flatMap((m) => m[1]!.split(/,\s*/)))];
  const valid = markers.filter((m) => index.has(m)).map((m) => index.get(m)!);
  const invalid = markers.filter((m) => !index.has(m));
  return { valid, invalid };
}

export function retrievalAnswer(ctx: ChatContext, reason: string): string {
  const lines = ctx.memories.filter((m) => m.kind === "FINDING" || m.kind === "REPORT_SUMMARY").slice(0, 5);
  return lines.length
    ? `${reason}\n\n${lines.map((m) => `• ${m.content}`).join("\n")}\n\n(Not AI-generated: these are published findings retrieved verbatim. Research is informational and not investment advice.)`
    : `${reason}\n\nI have not published any research yet.`;
}

export interface ChatResult {
  text: string;
  mode: "ai" | "retrieval";
  citations: ChatCitation[];
  invalidCitations: string[];
  usage?: Usage & { costUsd: number; model: string };
}

export async function* answerQuestion(input: {
  agent: Pick<Agent, "id" | "name" | "specialization" | "ownerId">;
  config: Pick<AgentConfig, "dailySpendLimitUsd" | "dailyTokenBudget"> | null;
  question: string;
  history: { role: string; content: string }[];
  userId: string | null;
  signal?: AbortSignal;
  onComplete: (r: ChatResult) => Promise<void>;
}): AsyncGenerator<string> {
  const ctx = await buildChatContext(input.agent.id, input.question);
  const e = env();

  let fallbackReason: string | null = null;
  let guard: BudgetGuard | null = null;
  if (!llmConfigured()) {
    fallbackReason = "AI chat is not configured on this deployment, so here are my most relevant published findings:";
  } else {
    const chatUsed = await db.usageRecord.aggregate({
      where: { agentId: input.agent.id, kind: "llm_chat", createdAt: { gte: startOfUtcDay() } },
      _sum: { promptTokens: true, completionTokens: true },
    });
    const chatTokens = (chatUsed._sum.promptTokens ?? 0) + (chatUsed._sum.completionTokens ?? 0);
    if (chatTokens >= e.CHAT_DAILY_TOKEN_BUDGET_PER_AGENT) {
      fallbackReason = "This agent's daily AI chat budget is used up, so here are the most relevant published findings:";
    } else {
      guard = await BudgetGuard.forAgent(input.agent.id, input.config ?? { dailySpendLimitUsd: 0.25, dailyTokenBudget: 250000 });
    }
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${chatSystem({ name: input.agent.name, specialization: specializationLabel(input.agent.specialization) })}
6. Cite like [R1] for a report or [R1·S2] for a specific source in a report, using only markers that appear in the RESEARCH CONTEXT.
7. Clearly separate verified facts (with citations) from your interpretation. If research is stale or missing, say so.`,
    },
    { role: "system", content: `RESEARCH CONTEXT:\n${untrusted("published_research", ctx.text, 14000)}` },
    ...input.history.map((m) =>
      m.role === "assistant" ? { role: "assistant" as const, content: m.content } : { role: "user" as const, content: untrusted("user_question", m.content, 1000) },
    ),
    { role: "user", content: untrusted("user_question", input.question, 1000) },
  ];

  if (guard) {
    try {
      guard.assertCanSpend(estimateTokens(messages), CHAT_MAX_TOKENS);
    } catch (err) {
      fallbackReason = `${(err as Error).message}. Here are the most relevant published findings instead:`;
      guard = null;
    }
  }

  if (!guard) {
    const text = retrievalAnswer(ctx, fallbackReason!);
    yield text;
    await input.onComplete({ text, mode: "retrieval", citations: [], invalidCitations: [] });
    return;
  }

  let full = "";
  let usage: (Usage & { costUsd: number; model: string }) | undefined;
  try {
    for await (const delta of chatStream({
      messages,
      maxTokens: CHAT_MAX_TOKENS,
      signal: input.signal,
      onDone: (u, model) => {
        usage = { ...u, costUsd: estimateCostUsd(u), model };
      },
    })) {
      full += delta;
      yield delta;
    }
  } catch (err) {
    if (!full) {
      // Nothing streamed yet: degrade to a labelled retrieval answer.
      const reason = `${describeFallback(err)} Here are the most relevant published findings instead:`;
      const text = retrievalAnswer(ctx, reason);
      yield text;
      await input.onComplete({ text, mode: "retrieval", citations: [], invalidCitations: [] });
      return;
    }
    const msg = "\n\n[The response was interrupted. Please try again.]";
    full += msg;
    yield msg;
  }

  const { valid, invalid } = validateCitations(full, ctx.citationIndex);
  if (invalid.length) {
    const note = `\n\n(Note: ${invalid.length} citation${invalid.length > 1 ? "s" : ""} (${invalid.join(", ")}) did not match published sources and should be disregarded.)`;
    full += note;
    yield note;
  }
  await input.onComplete({ text: scrubClaims(full) || full, mode: "ai", citations: valid, invalidCitations: invalid, usage });
}
