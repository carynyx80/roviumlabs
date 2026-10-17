"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { ActivityItem, type ActivityRow } from "./activity-item";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";

export function LiveFeed({
  initial,
  agentId,
  showAgent = true,
  emptyText = "No activity yet.",
}: {
  initial: ActivityRow[];
  agentId?: string;
  showAgent?: boolean;
  emptyText?: string;
}) {
  const [items, setItems] = useState<ActivityRow[]>(initial);
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(initial.length < 30);

  useEffect(() => {
    const es = new EventSource(`/api/activity/stream${agentId ? `?agentId=${agentId}` : ""}`);
    es.onopen = () => setLive("live");
    es.onerror = () => setLive("offline");
    es.addEventListener("activity", (ev) => {
      const row = JSON.parse((ev as MessageEvent).data) as ActivityRow;
      setItems((cur) => (cur.some((c) => c.id === row.id) ? cur : [row, ...cur].slice(0, 300)));
    });
    return () => es.close();
  }, [agentId]);

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const q = new URLSearchParams({ before: new Date(last.createdAt).toISOString(), limit: "30" });
      if (agentId) q.set("agentId", agentId);
      const r = await api<{ items: ActivityRow[] }>(`/api/activity?${q}`);
      setItems((cur) => [...cur, ...r.items.filter((x) => !cur.some((c) => c.id === x.id))]);
      if (r.items.length < 30) setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[12px] text-subtle" aria-live="polite">
        <span className={`size-2 rounded-full ${live === "live" ? "animate-pulse-soft bg-success" : live === "connecting" ? "bg-warning" : "bg-danger"}`} />
        {live === "live" ? "Live — new events appear automatically" : live === "connecting" ? "Connecting…" : "Reconnecting…"}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<Activity />} title="Nothing here yet" description={emptyText} />
      ) : (
        <>
          <ul className="divide-y divide-border/60">
            {items.map((e) => (
              <ActivityItem key={e.id} e={e} showAgent={showAgent} />
            ))}
          </ul>
          {!exhausted && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" size="sm" onClick={loadMore} loading={loadingMore}>
                Load older events
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
