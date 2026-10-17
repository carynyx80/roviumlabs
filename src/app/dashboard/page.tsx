import Link from "next/link";
import { Bot, Coins } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Stat } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { AgentAvatar, ExecutionBadge, StatusBadge } from "@/components/agents/agent-bits";
import { explorerTxUrl } from "@/lib/chain/chains";
import { shortAddress, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const session = await getSession();
  if (!session) return null; // the dashboard layout renders the sign-in gate
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [agents, executions, usage, deployments] = await Promise.all([
    db.agent.findMany({
      where: { ownerId: session.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, slug: true, imageId: true, status: true, adminDisabled: true, lastSuccessAt: true },
    }),
    db.agentExecution.findMany({
      where: { agent: { ownerId: session.userId } },
      orderBy: { queuedAt: "desc" },
      take: 8,
      include: { agent: { select: { name: true, id: true } } },
    }),
    db.usageRecord.aggregate({
      where: { userId: session.userId, createdAt: { gte: since } },
      _sum: { promptTokens: true, completionTokens: true },
    }),
    db.tokenDeployment.findMany({
      where: { creatorId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { agent: { select: { name: true, id: true } } },
    }),
  ]);
  const active = agents.filter((a) => a.status === "ACTIVE").length;
  const tokens = (usage._sum.promptTokens ?? 0) + (usage._sum.completionTokens ?? 0);

  if (!agents.length) {
    return (
      <EmptyState
        icon={<Bot />}
        title="You have not created an agent yet"
        description="Configure an autonomous RWA research agent in a few minutes."
        action={
          <Button asChild variant="primary">
            <Link href="/create">Create your first agent</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card className="grid grid-cols-2 gap-6 p-6 sm:grid-cols-4">
        <Stat label="Agents" value={agents.length} />
        <Stat label="Active" value={active} />
        <Stat label="AI tokens today" value={tokens.toLocaleString()} hint="Across all your agents" />
        <Stat label="Wallet" value={<span className="font-mono text-base">{shortAddress(session.address)}</span>} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Your agents</CardTitle>
            <Link href="/dashboard/agents" className="text-sm text-accent hover:underline">
              Manage
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/60">
              {agents.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link href={`/dashboard/agents/${a.id}`} className="flex items-center gap-3 py-3 hover:opacity-90">
                    <AgentAvatar name={a.name} imageId={a.imageId} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.name}</p>
                      <p className="text-[12px] text-subtle">Last success {timeAgo(a.lastSuccessAt)}</p>
                    </div>
                    <StatusBadge status={a.status} adminDisabled={a.adminDisabled} />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent executions</CardTitle>
          </CardHeader>
          <CardContent>
            {executions.length ? (
              <ul className="divide-y divide-border/60">
                {executions.map((e) => (
                  <li key={e.id}>
                    <Link href={`/dashboard/agents/${e.agent.id}?tab=executions`} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{e.agent.name}</p>
                        <p className="text-[12px] text-subtle">
                          {e.trigger.toLowerCase()} · {timeAgo(e.queuedAt)}
                        </p>
                      </div>
                      <ExecutionBadge status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No executions yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wallet deployment history</CardTitle>
        </CardHeader>
        <CardContent>
          {deployments.length ? (
            <ul className="divide-y divide-border/60 text-sm">
              {deployments.map((d) => {
                const tx = d.txHash ? explorerTxUrl(d.chainId, d.txHash) : undefined;
                return (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="flex items-center gap-2">
                      <Coins className="size-4 text-muted" /> ${d.tokenSymbol} for {d.agent.name}
                    </span>
                    <span className="flex items-center gap-3 text-[12px] text-subtle">
                      {d.status.toLowerCase()} · {timeAgo(d.createdAt)}
                      {tx && (
                        <a href={tx} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                          tx
                        </a>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">No token deployments from this wallet yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
