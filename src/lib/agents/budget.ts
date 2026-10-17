import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { estimateCostUsd, type Usage } from "@/lib/llm/client";

/**
 * Spending limits for AI usage. Checked before every model call and updated after it.
 *
 *  - per agent, per UTC day: AgentConfig.dailySpendLimitUsd (USD) and dailyTokenBudget (tokens),
 *    shared by research runs and public chat
 *  - per platform, per UTC day: PLATFORM_DAILY_LLM_SPEND_USD and PLATFORM_DAILY_LLM_TOKEN_BUDGET
 *
 * Exceeding a limit throws BudgetExceededError; the engine then finishes the run with its
 * mechanical fallback and labels the report accordingly. Costs are estimates from configured
 * token prices.
 */

export class BudgetExceededError extends Error {}

export const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export async function spentToday(agentId?: string) {
  const r = await db.usageRecord.aggregate({
    where: { createdAt: { gte: startOfUtcDay() }, kind: { startsWith: "llm" }, ...(agentId ? { agentId } : {}) },
    _sum: { promptTokens: true, completionTokens: true, costUsd: true },
  });
  return {
    tokens: (r._sum.promptTokens ?? 0) + (r._sum.completionTokens ?? 0),
    usd: r._sum.costUsd ?? 0,
  };
}

export interface BudgetLimits {
  agentUsd: number;
  agentTokens: number;
  platformUsd: number;
  platformTokens: number;
}

export class BudgetGuard {
  usage: Usage = { promptTokens: 0, completionTokens: 0 };
  costUsd = 0;
  calls = 0;

  private constructor(
    private limits: BudgetLimits,
    private baseline: { agent: { tokens: number; usd: number }; platform: { tokens: number; usd: number } },
  ) {}

  static async forAgent(agentId: string, config: { dailySpendLimitUsd: number; dailyTokenBudget: number }) {
    const e = env();
    const [agent, platform] = await Promise.all([spentToday(agentId), spentToday()]);
    return new BudgetGuard(
      {
        agentUsd: config.dailySpendLimitUsd,
        agentTokens: config.dailyTokenBudget,
        platformUsd: e.PLATFORM_DAILY_LLM_SPEND_USD,
        platformTokens: e.PLATFORM_DAILY_LLM_TOKEN_BUDGET,
      },
      { agent, platform },
    );
  }

  get tokens() {
    return this.usage.promptTokens + this.usage.completionTokens;
  }

  /** Remaining headroom; negative means a limit was crossed. */
  remaining() {
    const t = this.tokens;
    return {
      agentUsd: this.limits.agentUsd - this.baseline.agent.usd - this.costUsd,
      agentTokens: this.limits.agentTokens - this.baseline.agent.tokens - t,
      platformUsd: this.limits.platformUsd - this.baseline.platform.usd - this.costUsd,
      platformTokens: this.limits.platformTokens - this.baseline.platform.tokens - t,
    };
  }

  /**
   * Throws before a call whose estimated worst-case cost (prompt estimate + max completion)
   * would exceed any remaining limit.
   */
  assertCanSpend(estimatedPromptTokens: number, maxCompletionTokens: number) {
    const r = this.remaining();
    const worstTokens = estimatedPromptTokens + maxCompletionTokens;
    const worstUsd = estimateCostUsd({ promptTokens: estimatedPromptTokens, completionTokens: maxCompletionTokens });
    if (r.agentUsd < worstUsd) throw new BudgetExceededError(`Agent daily AI spend limit reached ($${this.limits.agentUsd.toFixed(2)}/day)`);
    if (r.agentTokens < worstTokens) throw new BudgetExceededError(`Agent daily AI token budget reached (${this.limits.agentTokens.toLocaleString()} tokens/day)`);
    if (r.platformUsd < worstUsd) throw new BudgetExceededError("Platform daily AI spend limit reached");
    if (r.platformTokens < worstTokens) throw new BudgetExceededError("Platform daily AI token budget reached");
  }

  record(u: Usage) {
    this.calls++;
    this.usage.promptTokens += u.promptTokens;
    this.usage.completionTokens += u.completionTokens;
    this.costUsd += estimateCostUsd(u);
  }
}

/** Rough prompt-size estimate (~4 characters per token) used for pre-call budget checks. */
export function estimateTokens(messages: { content?: string | null }[] | string): number {
  const chars = typeof messages === "string" ? messages.length : messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  return Math.ceil(chars / 4) + 50;
}
