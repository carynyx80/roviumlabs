import Link from "next/link";
import { Bot } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { AgentAvatar, StatusBadge } from "@/components/agents/agent-bits";
import { specializationShort, AUTONOMY_MODES } from "@/lib/agents/constants";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MyAgentsPage() {
  const session = await getSession();
  if (!session) return null; // the dashboard layout renders the sign-in gate
  const agents = await db.agent.findMany({
    where: { ownerId: session.userId },
    orderBy: { createdAt: "desc" },
    include: {
      schedule: true,
      tokenDeployments: { where: { status: { in: ["CONFIRMED", "SUBMITTED"] } }, take: 1 },
      _count: { select: { reports: true, executions: true } },
    },
  });
  if (!agents.length) {
    return (
      <EmptyState
        icon={<Bot />}
        title="No agents yet"
        action={
          <Button asChild variant="primary">
            <Link href="/create">Create an agent</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border scrollbar-thin">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-bg-2 text-left text-[12px] text-subtle">
          <tr>
            <th className="px-4 py-3 font-medium">Agent</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Mode</th>
            <th className="px-4 py-3 font-medium">Runs / reports</th>
            <th className="px-4 py-3 font-medium">Last success</th>
            <th className="px-4 py-3 font-medium">Token</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {agents.map((a) => (
            <tr key={a.id} className="hover:bg-surface/40">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <AgentAvatar name={a.name} imageId={a.imageId} size={34} />
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-[12px] text-subtle">
                      ${a.ticker} · {specializationShort(a.specialization)}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={a.status} adminDisabled={a.adminDisabled} />
              </td>
              <td className="px-4 py-3 text-muted">{AUTONOMY_MODES.find((m) => m.id === a.schedule?.mode)?.label}</td>
              <td className="px-4 py-3 font-mono tabular-nums text-muted">
                {a._count.executions} / {a._count.reports}
              </td>
              <td className="px-4 py-3 text-muted">{timeAgo(a.lastSuccessAt)}</td>
              <td className="px-4 py-3 text-muted">{a.tokenDeployments[0] ? `$${a.tokenDeployments[0].tokenSymbol} (${a.tokenDeployments[0].status.toLowerCase()})` : "—"}</td>
              <td className="px-4 py-3 text-right">
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/dashboard/agents/${a.id}`}>Manage</Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
