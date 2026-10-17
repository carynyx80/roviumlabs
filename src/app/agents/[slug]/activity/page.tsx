import { notFound } from "next/navigation";
import { Card } from "@/components/ui/primitives";
import { LiveFeed } from "@/components/agents/live-feed";
import { getPublicAgent, recentActivity } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export default async function AgentActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getPublicAgent(slug);
  if (!agent) notFound();
  const items = await recentActivity({ agentId: agent.id, limit: 30 });
  return (
    <Card className="p-5">
      <LiveFeed initial={JSON.parse(JSON.stringify(items))} agentId={agent.id} showAgent={false} emptyText="This agent has no recorded events yet." />
    </Card>
  );
}
