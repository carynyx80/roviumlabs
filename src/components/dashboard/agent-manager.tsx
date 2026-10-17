"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Pause, Play, Power, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardHeader, CardTitle, Skeleton, Stat } from "@/components/ui/primitives";
import { Dialog, DialogClose, DialogContent, DialogTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { AgentAvatar, StatusBadge } from "@/components/agents/agent-bits";
import { ExecutionsPanel } from "./executions-panel";
import { SettingsPanel, type AgentRecord } from "./settings-panel";
import { TokenPanel } from "./token-panel";
import { UsagePanel } from "./usage-panel";
import { api, errorMessage } from "@/lib/client/api";
import { AUTONOMY_MODES, specializationLabel } from "@/lib/agents/constants";
import { timeAgo } from "@/lib/utils";

export interface ChainOption {
  id: number;
  label: string;
  isTestnet: boolean;
  explorerUrl: string | null;
}

export function AgentManager({ agentId, llmConfigured, chains }: { agentId: string; llmConfigured: boolean; chains: ChainOption[] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const sp = useSearchParams();
  const tab = sp.get("tab") ?? "control";
  const q = useQuery({ queryKey: ["agent", agentId], queryFn: () => api<AgentRecord>(`/api/agents/${agentId}`) });

  const lifecycle = useMutation({
    mutationFn: (action: "activate" | "pause" | "resume" | "disable") =>
      api<{ status: string }>(`/api/agents/${agentId}/lifecycle`, { method: "POST", body: { action } }),
    onSuccess: (r) => {
      toast.success(`Agent is now ${r.status.toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["executions", agentId] });
      router.refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: () => api<{ executionId: string }>(`/api/agents/${agentId}/run`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Research run queued", { description: "The worker will pick it up within seconds." });
      qc.invalidateQueries({ queryKey: ["executions", agentId] });
      router.replace(`?tab=executions`, { scroll: false });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return <Alert tone="danger" title="Could not load this agent">{errorMessage(q.error)}</Alert>;
  }
  const a = q.data;
  const publicAgent = a.status === "ACTIVE" || a.status === "PAUSED";

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <AgentAvatar name={a.name} imageId={a.imageId} size={60} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold">{a.name}</h2>
              <StatusBadge status={a.status} adminDisabled={a.adminDisabled} />
            </div>
            <p className="mt-1 text-sm text-muted">
              ${a.ticker} · {specializationLabel(a.specialization)} · {AUTONOMY_MODES.find((m) => m.id === a.schedule?.mode)?.label}
            </p>
            {publicAgent && !a.adminDisabled && (
              <Link href={`/agents/${a.slug}`} className="mt-1 inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
                Public profile <ExternalLink className="size-3" />
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.status === "DRAFT" && (
            <Button variant="primary" onClick={() => lifecycle.mutate("activate")} loading={lifecycle.isPending}>
              <Power /> Activate
            </Button>
          )}
          {a.status === "ACTIVE" && (
            <>
              <Button variant="primary" onClick={() => run.mutate()} loading={run.isPending}>
                <Zap /> Run now
              </Button>
              <Button variant="secondary" onClick={() => lifecycle.mutate("pause")} loading={lifecycle.isPending}>
                <Pause /> Pause
              </Button>
            </>
          )}
          {a.status === "PAUSED" && (
            <Button variant="primary" onClick={() => lifecycle.mutate("resume")} loading={lifecycle.isPending}>
              <Play /> Resume
            </Button>
          )}
          {a.status !== "DISABLED" && !a.adminDisabled && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="danger">Disable</Button>
              </DialogTrigger>
              <DialogContent title="Disable this agent?" description="Disabling stops all research permanently and removes the agent from the marketplace. Published reports remain in the database. This cannot be undone from the dashboard.">
                <div className="flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="danger" onClick={() => lifecycle.mutate("disable")}>
                      Disable agent
                    </Button>
                  </DialogClose>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </Card>

      {a.adminDisabled && (
        <Alert tone="danger" title="Disabled by an administrator">
          {a.disabledReason ?? "This agent violated platform rules."} Contact support if you believe this is a mistake.
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => router.replace(`?tab=${v}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="control">Overview</TabsTrigger>
          <TabsTrigger value="executions">Executions</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="token">Token</TabsTrigger>
          <TabsTrigger value="usage">AI usage</TabsTrigger>
        </TabsList>

        <TabsContent value="control" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Schedule</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-5">
                <Stat label="Mode" value={<span className="text-base">{AUTONOMY_MODES.find((m) => m.id === a.schedule?.mode)?.label}</span>} />
                <Stat label="Next research" value={<span className="text-base">{a.schedule?.nextRunAt ? timeAgo(a.schedule.nextRunAt) : "—"}</span>} />
                <Stat label="Next monitor check" value={<span className="text-base">{a.schedule?.nextMonitorAt ? timeAgo(a.schedule.nextMonitorAt) : "—"}</span>} />
                <Stat label="Last success" value={<span className="text-base">{timeAgo(a.lastSuccessAt)}</span>} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Guardrails</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-5">
                <Stat label="Runs per day" value={a.config?.dailyRunLimit} />
                <Stat label="Tool calls per run" value={a.config?.maxToolCalls} />
                <Stat label="Daily AI tokens" value={a.config?.dailyTokenBudget.toLocaleString()} />
                <Stat label="AI narrative" value={<span className="text-base">{llmConfigured ? "Enabled" : "Not configured"}</span>} />
              </CardContent>
            </Card>
          </div>
          {!llmConfigured && (
            <Alert tone="warning" className="mt-6" title="No LLM provider configured">
              Research runs collect live data, score risk and publish deterministic reports. Set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL to enable AI planning, narrative and chat.
            </Alert>
          )}
          <div className="mt-6 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => q.refetch()}>
              <RefreshCw /> Refresh
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="executions" className="mt-6">
          <ExecutionsPanel agentId={agentId} />
        </TabsContent>
        <TabsContent value="settings" className="mt-6">
          <SettingsPanel agent={a} onSaved={() => qc.invalidateQueries({ queryKey: ["agent", agentId] })} />
        </TabsContent>
        <TabsContent value="token" className="mt-6">
          <TokenPanel agent={a} chains={chains} />
        </TabsContent>
        <TabsContent value="usage" className="mt-6">
          <UsagePanel agentId={agentId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
