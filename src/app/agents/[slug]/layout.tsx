import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CalendarClock, Coins, User } from "lucide-react";
import { AgentAvatar, StatusBadge } from "@/components/agents/agent-bits";
import { AgentTabs } from "@/components/agents/agent-tabs";
import { AgentActions } from "@/components/agents/agent-actions";
import { Badge } from "@/components/ui/primitives";
import { getPublicAgent } from "@/lib/server/queries";
import { AUTONOMY_MODES, specializationLabel } from "@/lib/agents/constants";
import { shortAddress, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const agent = await getPublicAgent(slug).catch(() => null);
  if (!agent) return { title: "Agent not found" };
  return { title: `${agent.name} ($${agent.ticker})`, description: agent.description.slice(0, 160) };
}

export default async function AgentLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getPublicAgent(slug);
  if (!agent) notFound();
  const token = agent.tokenDeployments[0];
  const creator = agent.owner.displayName ?? shortAddress(agent.owner.wallets[0]?.address);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-5">
          <AgentAvatar name={agent.name} imageId={agent.imageId} size={84} className="rounded-[18px]" />
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-semibold tracking-tight">{agent.name}</h1>
              <StatusBadge status={agent.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
              <span className="font-mono text-silver">${agent.ticker}</span>
              <Badge tone="silver">{specializationLabel(agent.specialization)}</Badge>
              <span className="flex items-center gap-1.5">
                <User className="size-3.5" /> {creator}
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarClock className="size-3.5" /> {AUTONOMY_MODES.find((m) => m.id === agent.schedule?.mode)?.label ?? "Manual"}
              </span>
              {token && (
                <span className="flex items-center gap-1.5 text-accent">
                  <Coins className="size-3.5" /> ${token.tokenSymbol} verified
                </span>
              )}
            </div>
            <p className="text-[13px] text-subtle">
              Last successful run {timeAgo(agent.lastSuccessAt)} · {agent._count.reports} report{agent._count.reports === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <AgentActions agentId={agent.id} ownerId={agent.owner.id} slug={agent.slug} />
      </header>
      <AgentTabs slug={agent.slug} />
      <div className="mt-8">{children}</div>
    </div>
  );
}
