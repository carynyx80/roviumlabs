import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Stat } from "@/components/ui/primitives";
import { RiskBadge } from "@/components/agents/agent-bits";
import { RiskChart, RunsChart } from "@/components/agents/charts";
import { db } from "@/lib/db";
import { getPublicAgent } from "@/lib/server/queries";
import { agentOperationalStats } from "@/lib/server/agent-stats";
import { RISK_SENSITIVITIES, REPORTING_STYLES } from "@/lib/agents/constants";
import { providerName } from "@/lib/providers/registry";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AgentOverview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getPublicAgent(slug);
  if (!agent) notFound();
  const [latest, stats] = await Promise.all([
    db.researchReport.findFirst({ where: { agentId: agent.id, hidden: false }, orderBy: { createdAt: "desc" } }),
    agentOperationalStats(agent.id),
  ]);
  const cfg = agent.config;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-silver">{agent.description}</p>
            <div>
              <p className="text-[12px] uppercase tracking-wider text-subtle">Objectives</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-silver">
                {agent.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
            {cfg && (
              <div>
                <p className="text-[12px] uppercase tracking-wider text-subtle">Research objectives</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-silver">
                  {cfg.researchObjectives.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Latest research</CardTitle>
            {latest && (
              <Link href={`/agents/${agent.slug}/research`} className="flex items-center gap-1 text-sm text-accent hover:underline">
                All reports <ArrowRight className="size-3.5" />
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {latest ? (
              <Link href={`/agents/${agent.slug}/research#${latest.id}`} className="block rounded-[12px] border border-border bg-bg-2 p-4 hover:border-border-strong">
                <div className="flex flex-wrap items-center gap-2">
                  <RiskBadge level={latest.riskLevel} score={latest.riskScore} />
                  <span className="text-[12px] text-subtle">
                    {timeAgo(latest.createdAt)} · confidence {latest.confidence}% · {latest.narrativeBy === "deterministic" ? "deterministic writer" : "AI narrative"}
                  </span>
                </div>
                <p className="mt-3 font-display font-semibold">{latest.title}</p>
                <p className="mt-1.5 line-clamp-3 text-sm text-muted">{latest.summary}</p>
              </Link>
            ) : (
              <EmptyState
                icon={<FileText />}
                title="No research published yet"
                description={agent.status === "ACTIVE" ? "The first research run is queued or in progress." : "The agent is paused."}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operational performance</CardTitle>
            <p className="text-[13px] text-muted">Research activity only. This is not investment performance.</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Completed runs" value={stats.completed} />
              <Stat label="Failed runs" value={stats.failed} />
              <Stat label="Success rate" value={stats.successRate == null ? "—" : `${stats.successRate}%`} />
              <Stat label="Avg. run time" value={stats.avgDurationSec == null ? "—" : `${stats.avgDurationSec}s`} />
            </div>
            <div>
              <p className="mb-2 text-[12px] text-subtle">Runs per day (14 days)</p>
              <RunsChart data={stats.days} />
            </div>
            {stats.risk.length > 1 && (
              <div>
                <p className="mb-2 text-[12px] text-subtle">Aggregate risk score per report</p>
                <RiskChart data={stats.risk} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">Risk sensitivity</dt>
                <dd className="text-silver">{RISK_SENSITIVITIES.find((r) => r.id === cfg?.riskSensitivity)?.label}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">Reporting style</dt>
                <dd className="text-silver">{REPORTING_STYLES.find((r) => r.id === cfg?.reportingStyle)?.label}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-subtle">Next scheduled run</dt>
                <dd className="text-silver">{agent.schedule?.nextRunAt ? timeAgo(agent.schedule.nextRunAt) : "—"}</dd>
              </div>
              <div>
                <dt className="text-subtle">Data sources</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {cfg?.dataSources.map((d) => (
                    <span key={d} className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] text-silver">
                      {providerName(d)}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monitored assets</CardTitle>
          </CardHeader>
          <CardContent>
            {agent.monitoredAssets.length ? (
              <ul className="divide-y divide-border/60">
                {agent.monitoredAssets.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-silver">{m.name}</span>
                    <span className="text-[12px] text-subtle">checked {timeAgo(m.lastCheckedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Assets are added after the first research run.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
