import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { requireOwnedAgent } from "@/lib/server/agents";
import { ok, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** AI usage per day (last 14 days) for the creator, split by research and chat. */
export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const agent = await requireOwnedAgent(session, id);
  const since = new Date(Date.now() - 13 * 86400_000);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await db.usageRecord.findMany({
    where: { agentId: id, createdAt: { gte: since } },
    select: { kind: true, promptTokens: true, completionTokens: true, costUsd: true, createdAt: true, model: true },
  });
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(since.getTime() + i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    const sum = (kind: string) =>
      rows
        .filter((r) => r.kind === kind && r.createdAt.toISOString().slice(0, 10) === key)
        .reduce((s, r) => s + r.promptTokens + r.completionTokens, 0);
    const cost = rows.filter((r) => r.createdAt.toISOString().slice(0, 10) === key).reduce((s, r) => s + r.costUsd, 0);
    return { day: key.slice(5), research: sum("llm_research"), chat: sum("llm_chat"), costUsd: Number(cost.toFixed(6)) };
  });
  const today = days[days.length - 1]!;
  return ok({
    days,
    today: today.research + today.chat,
    dailyBudget: agent.config?.dailyTokenBudget ?? 0,
    spentTodayUsd: today.costUsd,
    dailySpendLimitUsd: agent.config?.dailySpendLimitUsd ?? 0,
    models: [...new Set(rows.map((r) => r.model).filter(Boolean))],
  });
});
