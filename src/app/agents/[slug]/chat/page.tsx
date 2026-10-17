import { notFound } from "next/navigation";
import { AgentChat } from "@/components/agents/agent-chat";
import { getPublicAgent } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export default async function AgentChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getPublicAgent(slug);
  if (!agent) notFound();
  return <AgentChat agentId={agent.id} agentName={agent.name} hasResearch={agent._count.reports > 0} />;
}
