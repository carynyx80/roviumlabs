import { z } from "zod";

/** Structured outputs requested from the LLM. All model output is validated against these. */

const sectionSchema = z.object({
  text: z.string().max(2000),
  sourceIds: z.array(z.string().max(8)).max(10).default([]),
});

export const SECTION_KEYS = [
  "assetOverview",
  "issuerAnalysis",
  "marketConditions",
  "yieldAnalysis",
  "liquidityAssessment",
  "smartContractConsiderations",
  "redemptionRisks",
  "counterpartyRisks",
  "regulatoryConsiderations",
] as const;

export const SECTION_TITLES: Record<(typeof SECTION_KEYS)[number], string> = {
  assetOverview: "Asset overview",
  issuerAnalysis: "Issuer analysis",
  marketConditions: "Market conditions",
  yieldAnalysis: "Yield analysis",
  liquidityAssessment: "Liquidity assessment",
  smartContractConsiderations: "Smart contract considerations",
  redemptionRisks: "Redemption risks",
  counterpartyRisks: "Counterparty risks",
  regulatoryConsiderations: "Regulatory considerations",
};

export const narrativeSchema = z.object({
  title: z.string().min(5).max(140),
  summary: z.string().min(20).max(1200),
  sections: z.object(
    Object.fromEntries(SECTION_KEYS.map((k) => [k, sectionSchema])) as Record<
      (typeof SECTION_KEYS)[number],
      typeof sectionSchema
    >,
  ),
  keyFindings: z
    .array(z.object({ text: z.string().max(400), sourceIds: z.array(z.string().max(8)).max(6).default([]) }))
    .min(1)
    .max(6),
  uncertainties: z.array(z.string().max(300)).max(6).default([]),
});

export type Narrative = z.infer<typeof narrativeSchema>;

export const planSchema = z.object({
  selectedAssetKeys: z.array(z.string().max(120)).min(1).max(6),
  rationale: z.string().max(600),
});

export type Plan = z.infer<typeof planSchema>;

/** Persisted report body (ResearchReport.body). */
export interface ReportBody extends ReportBodyAi {
  sections: { key: string; title: string; text: string; sourceIds: string[]; basis: "interpretation" | "derived" }[];
  keyFindings: {
    text: string;
    sourceIds: string[];
    basis: "interpretation" | "derived";
    reasoning?: string;
    importance?: "high" | "medium" | "low";
    novelty?: "new" | "changed" | "reconfirmed";
  }[];
  uncertainties: string[];
  changes: {
    assetKey: string;
    name: string;
    metric: string;
    previous: number;
    current: number;
    change: number;
    unit: string;
    breached: boolean;
  }[];
  macro: { key: string; label: string; value: number; unit?: string; url: string; asOf: string; stale: boolean }[];
  warnings: string[];
  sourceIndex: Record<string, { title: string; url: string }>;
  narrativeBy: string;
}

const PROHIBITED = /\b(guaranteed?\s+(returns?|profits?|yield|gains?)|risk[-\s]free|can(?:no|')t\s+lose|certain\s+(profit|gain)s?|sure\s+thing)\b/i;

/** Removes sentences making prohibited claims (e.g. guaranteed returns). */
export function scrubClaims(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !PROHIBITED.test(s))
    .join(" ");
}

// ─────────────────────────── AI research (phase 2) ───────────────────────────

export const APPROVED_TOOL_NAMES = [
  "search_rwa_assets",
  "get_asset_data",
  "get_reference_rates",
  "assess_risk",
  "compare_with_previous",
  "recall_memory",
  "read_creator_source",
] as const;

/** Research plan the agent writes before using tools. */
export const researchPlanSchema = z.object({
  goal: z.string().min(10).max(400),
  hypotheses: z.array(z.string().max(240)).max(5).default([]),
  focus: z.array(z.string().max(80)).max(6).default([]),
  steps: z
    .array(z.object({ tool: z.string().max(40), purpose: z.string().max(200) }))
    .min(1)
    .max(10),
  avoidRepeating: z.array(z.string().max(200)).max(5).default([]),
  successCriteria: z.string().max(300),
});
export type ResearchPlan = z.infer<typeof researchPlanSchema>;

const aiFindingSchema = z.object({
  text: z.string().min(10).max(400),
  reasoning: z.string().max(500),
  importance: z.enum(["high", "medium", "low"]),
  novelty: z.enum(["new", "changed", "reconfirmed"]),
  sourceIds: z.array(z.string().max(8)).max(6).default([]),
});

/** Final structured report written by the AI analyst from tool evidence. */
export const aiReportSchema = narrativeSchema.extend({
  reasoning: z.string().min(20).max(1500),
  riskAssessment: z.object({ text: z.string().min(10).max(1200), sourceIds: z.array(z.string().max(8)).max(10).default([]) }),
  keyFindings: z.array(aiFindingSchema).min(1).max(8),
});
export type AiReport = z.infer<typeof aiReportSchema>;

/** Extra fields stored on ResearchReport.body for AI and fallback runs (all optional for older reports). */
export interface ReportBodyAi {
  mode?: "ai" | "fallback";
  fallbackReason?: string;
  plan?: ResearchPlan;
  reasoning?: string;
  riskAssessment?: { text: string; sourceIds: string[] };
  groundingIssues?: { kind: string; detail: string }[];
  toolSummary?: { name: string; ok: boolean }[];
  usage?: { promptTokens: number; completionTokens: number; costUsd: number; modelCalls: number };
}
