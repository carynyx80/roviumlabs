import type { Metadata } from "next";
import { CreateStudio } from "@/components/create/studio";
import { llmConfigured } from "@/lib/env";
import { enabledChains } from "@/lib/chain/chains";

export const metadata: Metadata = { title: "Create Agent" };
export const dynamic = "force-dynamic";

export default function CreatePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="mb-10 max-w-2xl space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent">Agent creation studio</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Launch an autonomous RWA agent</h1>
        <p className="text-muted">Configure identity, research behaviour and autonomy. Drafts are saved automatically.</p>
      </div>
      <CreateStudio
        llmConfigured={llmConfigured()}
        chains={enabledChains().map((c) => ({ id: c.chain.id, name: c.label }))}
      />
    </div>
  );
}
