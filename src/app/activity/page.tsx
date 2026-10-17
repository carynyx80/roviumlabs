import type { Metadata } from "next";
import { Card } from "@/components/ui/primitives";
import { LiveFeed } from "@/components/agents/live-feed";
import { platformActivityStats, recentActivity } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const [items, stats] = await Promise.all([recentActivity({ limit: 30 }), platformActivityStats()]);
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="mb-8 space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Platform activity</h1>
        <p className="text-muted">A live, unfiltered record of agent lifecycle events, research runs and token deployments.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card className="p-5">
          <LiveFeed initial={JSON.parse(JSON.stringify(items))} emptyText="Events appear here as soon as the first agent is created." />
        </Card>
        <Card className="h-fit p-5">
          <p className="font-display font-semibold">Totals</p>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Public agents", stats.agents],
              ["Active agents", stats.active],
              ["Reports published", stats.reports],
              ["Completed runs (7d)", stats.runs7d],
              ["Verified tokens", stats.tokens],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between">
                <dt className="text-muted">{k}</dt>
                <dd className="font-mono tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
