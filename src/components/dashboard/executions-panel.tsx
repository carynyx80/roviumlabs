"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Circle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/primitives";
import { ExecutionBadge } from "@/components/agents/agent-bits";
import { api, errorMessage } from "@/lib/client/api";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";

interface Step {
  id: string;
  index: number;
  kind: string;
  name: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  error: string | null;
  durationMs: number;
}
interface Exec {
  id: string;
  status: string;
  trigger: string;
  triggerReason: string | null;
  attempt: number;
  error: string | null;
  summary: string | null;
  llmModel: string | null;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
  costUsd: number;
  mode: string | null;
  fallbackReason: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: Step[];
  report: { id: string; title: string } | null;
  agentSlug?: string;
}

const LIVE = ["QUEUED", "RESEARCHING", "ANALYZING", "PUBLISHING"];
const LIFECYCLE = ["QUEUED", "RESEARCHING", "ANALYZING", "PUBLISHING", "COMPLETED"];

function Lifecycle({ status }: { status: string }) {
  const idx = LIFECYCLE.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="Lifecycle">
      {LIFECYCLE.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span
            className={cn(
              "rounded-full px-2 py-0.5",
              status === "FAILED" || status === "CANCELLED"
                ? "bg-surface-2 text-subtle"
                : i < idx || status === "COMPLETED"
                  ? "bg-success/10 text-success"
                  : i === idx
                    ? "bg-accent/15 text-accent"
                    : "bg-surface-2 text-subtle",
            )}
          >
            {s.toLowerCase()}
          </span>
          {i < LIFECYCLE.length - 1 && <ChevronRight className="size-3 text-subtle" />}
        </li>
      ))}
    </ol>
  );
}

export function ExecutionsPanel({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["executions", agentId],
    queryFn: () => api<{ items: Exec[] }>(`/api/agents/${agentId}/executions?limit=25`),
    refetchInterval: (query) => (query.state.data?.items.some((e) => LIVE.includes(e.status)) ? 3000 : 20000),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/api/executions/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Cancellation requested");
      qc.invalidateQueries({ queryKey: ["executions", agentId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <Alert tone="danger" title="Could not load executions">{errorMessage(q.error)}</Alert>;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState title="No executions yet" description="Activate the agent or press Run now to start research." />;

  return (
    <div className="space-y-3">
      {items.some((e) => e.status === "QUEUED") && (
        <Alert tone="info">Queued runs are picked up by the background worker. If a run stays queued, check that the worker process is running (`npm run worker`).</Alert>
      )}
      {items.map((e) => (
        <details key={e.id} className="group rounded-[14px] border border-border bg-bg-2" open={LIVE.includes(e.status) || e === items[0]}>
          <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <ExecutionBadge status={e.status} />
                <Badge>{e.trigger.toLowerCase()}</Badge>
                {e.mode === "ai" && <Badge tone="accent">AI research</Badge>}
                {e.mode === "fallback" && <Badge tone="warning">fallback</Badge>}
                {e.attempt > 1 && <Badge tone="warning">attempt {e.attempt}</Badge>}
                <span className="text-[12px] text-subtle">{formatDateTime(e.queuedAt)}</span>
              </div>
              {e.triggerReason && <p className="text-[13px] text-muted">{e.triggerReason}</p>}
            </div>
            <div className="flex items-center gap-3 text-[12px] text-subtle">
              <span>{e.toolCalls} tool calls</span>
              {e.promptTokens + e.completionTokens > 0 && (
                <span>
                  {(e.promptTokens + e.completionTokens).toLocaleString()} tokens · {"$" + e.costUsd.toFixed(4)}
                </span>
              )}
              {e.startedAt && e.finishedAt && <span>{Math.round((new Date(e.finishedAt).getTime() - new Date(e.startedAt).getTime()) / 1000)}s</span>}
              {LIVE.includes(e.status) && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={(ev) => {
                    ev.preventDefault();
                    cancel.mutate(e.id);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </summary>
          <div className="space-y-4 border-t border-border p-4">
            <Lifecycle status={e.status} />
            {e.error && <Alert tone={e.status === "FAILED" ? "danger" : "warning"}>{e.error}</Alert>}
            {e.mode === "fallback" && e.fallbackReason && (
              <Alert tone="warning" title="Fallback: mechanical engine used">
                {e.fallbackReason}
              </Alert>
            )}
            {e.report && (
              <p className="text-sm">
                Published:{" "}
                <Link href={`/dashboard/agents/${agentId}/report/${e.report.id}`} className="text-accent hover:underline">
                  {e.report.title}
                </Link>
              </p>
            )}
            {e.llmModel && <p className="text-[12px] text-subtle">Model: {e.llmModel}</p>}
            <ol className="space-y-2">
              {e.steps.map((s) => (
                <li key={s.id} className="rounded-[10px] border border-border/70 bg-bg p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {s.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}
                    <span className="font-mono text-[12px] text-subtle">{s.kind.toLowerCase()}</span>
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-auto text-[12px] text-subtle">{s.durationMs} ms</span>
                  </div>
                  {s.error && <p className="mt-1.5 text-[13px] text-danger">{s.error}</p>}
                  {(s.input != null || s.output != null) && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[12px] text-accent">Evidence & output</summary>
                      <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-bg-2 p-3 text-[11px] leading-relaxed text-muted scrollbar-thin">
                        {JSON.stringify({ input: s.input ?? undefined, output: s.output ?? undefined }, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
              {LIVE.includes(e.status) && (
                <li className="flex items-center gap-2 px-3 text-[13px] text-muted">
                  <Circle className="size-3 animate-pulse-soft text-accent" /> Working… updated {timeAgo(new Date())}
                </li>
              )}
            </ol>
          </div>
        </details>
      ))}
    </div>
  );
}
