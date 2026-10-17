import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AgentManager } from "@/components/dashboard/agent-manager";
import { enabledChains } from "@/lib/chain/chains";
import { llmConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function ManageAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return null; // the dashboard layout renders the sign-in gate
  const agent = await db.agent.findUnique({ where: { id }, select: { ownerId: true } });
  // Server-side authorization: only the owner (or an admin) can open the manager.
  if (!agent || (agent.ownerId !== session.userId && session.user.role !== "ADMIN")) notFound();
  return (
    <AgentManager
      agentId={id}
      llmConfigured={llmConfigured()}
      chains={enabledChains().map((c) => ({ id: c.chain.id, label: c.label, isTestnet: c.isTestnet, explorerUrl: c.explorerUrl ?? null }))}
    />
  );
}
