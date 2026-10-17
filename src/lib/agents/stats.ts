import { db } from "@/lib/db";

/**
 * Marketplace ranking (documented in docs/ranking.md). Computed only from recorded platform
 * activity over the trailing 7 days — no external or synthetic signals:
 *
 *   trendingScore = 3 × reports7d + 1 × successfulRuns7d + 0.5 × chatMessages7d
 *                   − 2 × failedRuns7d, floored at 0, then multiplied by a freshness
 *                   factor exp(−hoursSinceLastSuccess / 72).
 */
export const TRENDING_FORMULA =
  "3×reports(7d) + 1×successful runs(7d) + 0.5×chat messages(7d) − 2×failed runs(7d), × exp(−hours since last success / 72)";

export async function recomputeMarketStats() {
  const since = new Date(Date.now() - 7 * 86400_000);
  const agents = await db.agent.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, adminDisabled: false },
    select: { id: true, lastSuccessAt: true },
  });
  for (const a of agents) {
    const [runs, ok, failed, reports, chats] = await Promise.all([
      db.agentExecution.count({ where: { agentId: a.id, queuedAt: { gte: since } } }),
      db.agentExecution.count({ where: { agentId: a.id, queuedAt: { gte: since }, status: "COMPLETED" } }),
      db.agentExecution.count({ where: { agentId: a.id, queuedAt: { gte: since }, status: "FAILED" } }),
      db.researchReport.count({ where: { agentId: a.id, createdAt: { gte: since }, hidden: false } }),
      db.chatMessage.count({ where: { role: "user", createdAt: { gte: since }, conversation: { agentId: a.id } } }),
    ]);
    const hours = a.lastSuccessAt ? (Date.now() - a.lastSuccessAt.getTime()) / 3600_000 : Infinity;
    const base = Math.max(0, 3 * reports + ok + 0.5 * chats - 2 * failed);
    const trendingScore = Number.isFinite(hours) ? base * Math.exp(-hours / 72) : 0;
    await db.agentMarketStats.upsert({
      where: { agentId: a.id },
      create: { agentId: a.id, runs7d: runs, successfulRuns7d: ok, reports7d: reports, chats7d: chats, trendingScore },
      update: { runs7d: runs, successfulRuns7d: ok, reports7d: reports, chats7d: chats, trendingScore },
    });
  }
  return agents.length;
}
