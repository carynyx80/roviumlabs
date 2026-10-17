import "server-only";
import { db } from "@/lib/db";

/** Operational statistics for an agent — research activity, not investment performance. */
export async function agentOperationalStats(agentId: string) {
  const since = new Date(Date.now() - 14 * 86400_000);
  since.setUTCHours(0, 0, 0, 0);
  const [execs, reports, totals] = await Promise.all([
    db.agentExecution.findMany({
      where: { agentId, queuedAt: { gte: since } },
      select: { status: true, queuedAt: true, startedAt: true, finishedAt: true, toolCalls: true },
    }),
    db.researchReport.findMany({
      where: { agentId, hidden: false },
      orderBy: { createdAt: "asc" },
      take: 30,
      select: { createdAt: true, riskScore: true, confidence: true },
    }),
    db.agentExecution.groupBy({ by: ["status"], where: { agentId }, _count: true }),
  ]);
  const days: { day: string; completed: number; failed: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    days.push({
      day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      completed: execs.filter((e) => e.status === "COMPLETED" && e.queuedAt.toISOString().slice(0, 10) === key).length,
      failed: execs.filter((e) => e.status === "FAILED" && e.queuedAt.toISOString().slice(0, 10) === key).length,
    });
  }
  const finished = execs.filter((e) => e.status === "COMPLETED" && e.startedAt && e.finishedAt);
  const avgDurationSec = finished.length
    ? Math.round(finished.reduce((s, e) => s + (e.finishedAt!.getTime() - e.startedAt!.getTime()), 0) / finished.length / 1000)
    : null;
  const count = (s: string) => totals.find((t) => t.status === s)?._count ?? 0;
  const completed = count("COMPLETED");
  const failed = count("FAILED");
  return {
    days,
    risk: reports.map((r) => ({
      at: r.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      score: r.riskScore,
      confidence: r.confidence,
    })),
    completed,
    failed,
    successRate: completed + failed ? Math.round((completed / (completed + failed)) * 100) : null,
    avgDurationSec,
  };
}
